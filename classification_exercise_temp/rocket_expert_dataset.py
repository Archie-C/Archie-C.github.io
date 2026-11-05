"""Build an EXPERIMENTAL episode-split dataset from recorded expert decisions.

This tool does not certify or publish a dataset. Acceptance gates, hidden sets,
off-trajectory recovery samples, and classifier sanity checks remain separate.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
import math
from pathlib import Path
import random

import numpy as np

from rocket_closed_loop import OBSERVATION_NAMES, OBSERVATION_VERSION, make_observation
from rocket_calibration import configuration
from rocket_physics import State, clearance
from rocket_expert_benchmark import FINAL_SET, final_feasibility_cases

DATASET_VERSION = 'expert-draft-v0.2'
# Componentwise near-duplicate tolerances in observation units.
LEAKAGE_TOLERANCES = np.array([.01, .01, .01, .01, .0001, .0001, .1, 1., .0001, .01, .01, .0001])


def _near_duplicate(left, right):
    """Whether observations across two splits are componentwise near-equal."""
    if not left or not right:
        return False
    a, b = np.asarray(left), np.asarray(right)
    # Bound temporary memory for long recordings.
    for start in range(0, len(a), 128):
        for other in range(0, len(b), 512):
            if np.any(np.all(np.abs(a[start:start+128, None, :] - b[None, other:other+512, :])
                             <= LEAKAGE_TOLERANCES, axis=2)):
                return True
    return False


def _recovery_rows(run, count, seed):
    """Query the matching expert on deterministic, in-envelope perturbations."""
    from rocket_expert import DiscreteExpert, SOURCE_SHA256
    from rocket_server import Run
    policy = run['replay']['config']['closed_loop']['policy']
    settings = policy.get('settings') or {}
    expert = DiscreteExpert(horizon_steps=settings.get('horizon_steps', 5))
    if policy.get('version') != expert.version or policy.get('source_sha256') != SOURCE_SHA256:
        raise ValueError('recovery sampling requires the exact recorded expert version and source')
    current = Run(run['scenario'])
    if current.config['physics_config'] != run['replay']['config']['physics_config']:
        raise ValueError('recovery sampling requires the recorded physics configuration')
    p, _ = configuration(run['scenario'])
    decisions = run['replay']['decisions']
    generator = random.Random(seed)
    rows = []
    for _ in range(count):
        for attempt in range(100):
            decision = generator.choice(decisions)
            obs = decision['observation']
            state = State(obs[0] + generator.uniform(-1., 1.), obs[1] + generator.uniform(-1., 1.),
                          obs[2] + generator.uniform(-.2, .2), obs[3] + generator.uniform(-.2, .2),
                          obs[4] + generator.uniform(-.002, .002), obs[5] + generator.uniform(-.001, .001),
                          *obs[6:9])
            time = decision['time']
            wind = p.wind(state.y, time)
            air = (state.vx-wind[0], state.vy-wind[1])
            speed = math.hypot(*air)
            tail = (math.sin(state.theta), -math.cos(state.theta))
            alpha = math.atan2(tail[0]*air[1] - tail[1]*air[0], tail[0]*air[0] + tail[1]*air[1]) if speed else 0.
            if 0 <= state.y <= 1000 and speed <= 130 and abs(alpha) <= math.radians(35) and clearance(state, p)[0] > .1:
                observation = make_observation(state, time, p)
                action = expert.predict_action(observation)
                rows.append(dict(observation=observation.tolist(), action=action, time=time,
                                 diagnostics=expert.diagnostics.copy(), provenance='perturbed recovery state'))
                break
        else:
            raise ValueError('unable to sample a valid recovery state in 100 attempts')
    return rows


def export_draft(report, output, *, seed=20261105, validation_fraction=.25, recovery_per_episode=0,
                 private_output=None, private_fraction=.15):
    """Write a draft only; reject ambiguous provenance and cross-split leakage."""
    if type(recovery_per_episode) is not int or recovery_per_episode < 0:
        raise ValueError('recovery_per_episode must be a nonnegative integer')
    if not 0 < validation_fraction < 1:
        raise ValueError('validation_fraction must be between zero and one')
    if private_output is not None and not 0 < private_fraction < 1:
        raise ValueError('private_fraction must be between zero and one')
    runs = report['policies']['discrete_expert']['runs']
    if any(run['case_id'].startswith(FINAL_SET + ':') for run in runs):
        raise ValueError('final evaluation cases cannot be exported as training data')
    episodes = []
    seen = set()
    for run in runs:
        replay = run['replay']
        config = replay['config']
        policy = config['closed_loop']['policy']
        if (config['observation_version'] != OBSERVATION_VERSION or
                config['closed_loop']['control_mode'] != 'discrete' or
                not str(policy.get('version', '')).startswith('expert-') or not policy.get('source_sha256')):
            raise ValueError('expected versioned recorded discrete expert decisions')
        initial = json.dumps(run['initial'], sort_keys=True, separators=(',', ':'))
        # Repeated initial conditions belong to the same episode group.
        group = hashlib.sha256(initial.encode()).hexdigest()
        episode_id = run['case_id']
        if episode_id in seen:
            raise ValueError('duplicate episode identifier')
        seen.add(episode_id)
        rows = []
        for decision in replay['decisions']:
            obs = np.asarray(decision['observation'], dtype=np.float64)
            action = decision['action']
            if obs.shape != (12,) or not np.all(np.isfinite(obs)) or type(action) is not int or not 0 <= action <= 9:
                raise ValueError('invalid expert decision')
            rows.append(dict(observation=obs.tolist(), action=action, time=decision['time'],
                             diagnostics=decision.get('diagnostics'), provenance='expert flight'))
        if rows and recovery_per_episode:
            sample_seed = int(hashlib.sha256(f'{seed}:{episode_id}'.encode()).hexdigest(), 16)
            rows.extend(_recovery_rows(run, recovery_per_episode, sample_seed))
        if rows:
            episodes.append(dict(episode_id=episode_id, group=group, scenario=run['scenario'],
                                 scoring=run['result'], physics_config=config['physics_config'],
                                 policy=policy, replay_run_id=config['run_id'], rows=rows))
    groups = sorted({episode['group'] for episode in episodes})
    minimum = 3 if private_output is not None else 2
    if len(groups) < minimum:
        raise ValueError(f'at least {minimum} distinct initial conditions are required')
    random.Random(seed).shuffle(groups)
    private_count = max(1, min(len(groups)-2, round(len(groups)*private_fraction))) if private_output is not None else 0
    private_groups = set(groups[:private_count])
    remaining = groups[private_count:]
    validation_count = max(1, min(len(remaining)-1, round(len(remaining)*validation_fraction)))
    validation_groups = set(remaining[:validation_count])
    def split_name(episode):
        if episode['group'] in private_groups:
            return 'agreement'
        return 'validation' if episode['group'] in validation_groups else 'train'
    names = ('train', 'validation', 'agreement') if private_output is not None else ('train', 'validation')
    splits = {name: [episode for episode in episodes if split_name(episode) == name] for name in names}
    observations = {name: [row['observation'] for episode in subset for row in episode['rows']]
                    for name, subset in splits.items()}
    final_starts = [make_observation(case['initial'], 0., configuration(case['scenario'])[0]).tolist()
                    for case in final_feasibility_cases()]
    if any(_near_duplicate(values, final_starts) for values in observations.values()):
        raise ValueError('dataset observations overlap a final evaluation start')
    for i, name in enumerate(names):
        for other in names[i+1:]:
            if _near_duplicate(observations[name], observations[other]):
                raise ValueError('near-duplicate observations across episode splits; change grouping or sampling')
    path = Path(output)
    private_path = Path(private_output) if private_output is not None else None
    if private_path is not None:
        public_resolved, private_resolved = path.resolve(), private_path.resolve()
        if public_resolved == private_resolved or public_resolved in private_resolved.parents or private_resolved in public_resolved.parents:
            raise ValueError('private output must be separate from the public output directory')
        if private_path.exists():
            raise ValueError('private output directory must not already exist')
    if path.exists() and any(path.iterdir()):
        raise ValueError('output directory must be empty')
    path.mkdir(parents=True, exist_ok=True)
    if private_path is not None:
        private_path.mkdir(parents=True, mode=0o700)
        if private_path.stat().st_mode & 0o077:
            private_path.rmdir()
            raise ValueError('filesystem does not support owner-only private directory permissions')
    counts = {}
    for name, subset in splits.items():
        counts[name] = Counter()
        destination = private_path if name == 'agreement' else path
        with (destination / f'{name}.csv').open('w', newline='', encoding='utf-8') as data, \
             (destination / f'{name}_metadata.jsonl').open('w', encoding='utf-8') as metadata:
            writer = csv.writer(data)
            writer.writerow([*OBSERVATION_NAMES, 'action'])
            for episode in subset:
                for row in episode['rows']:
                    writer.writerow([*row['observation'], row['action']])
                    counts[name][row['action']] += 1
                    record = {key: episode[key] for key in ('episode_id', 'group', 'scenario', 'scoring',
                                                            'physics_config', 'policy', 'replay_run_id')}
                    record.update(time=row['time'], diagnostics=row['diagnostics'], provenance=row['provenance'])
                    metadata.write(json.dumps(record, allow_nan=False, separators=(',', ':')) + '\n')
    manifest = dict(dataset_version=DATASET_VERSION, status='experimental; not approved for release',
                    observation_version=OBSERVATION_VERSION, observation_names=OBSERVATION_NAMES,
                    units=['m', 'm', 'm/s', 'm/s', 'rad', 'rad/s', 'kg', 'N', 'rad', 'm/s', 'm/s', 'kg/m^3'],
                    action='integer 0–9', split_seed=seed, validation_fraction=validation_fraction,
                    private_agreement_reserved=private_output is not None,
                    private_fraction=private_fraction if private_output is not None else None,
                    recovery_per_episode=recovery_per_episode, recovery_seed=seed,
                    recovery_scope=dict(position_m=1., velocity_m_per_s=.2, theta_rad=.002, omega_rad_per_s=.001,
                                        altitude_m=[0, 1000], airspeed_m_per_s=130, angle_of_attack_degrees=35,
                                        min_clearance_m=.1),
                    grouping='identical initial state', leakage_tolerances=LEAKAGE_TOLERANCES.tolist(),
                    source_schema=report['schema'],
                    scenario_sets=sorted({name for name in (report['diagnostic_scenario_set'], report['feasibility_set'])
                                          if any(episode['episode_id'].startswith(name + ':') for episode in episodes)}),
                    feasibility_seed=(report['feasibility_seed'] if any(episode['episode_id'].startswith(report['feasibility_set'] + ':') for episode in episodes) else None),
                    class_counts={name: {str(i): counter[i] for i in range(10)} for name, counter in counts.items()},
                    episode_counts={name: len(subset) for name, subset in splits.items()})
    (path / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('benchmark_json')
    parser.add_argument('output_directory')
    parser.add_argument('--seed', type=int, default=20261105)
    parser.add_argument('--recovery-per-episode', type=int, default=0)
    parser.add_argument('--private-agreement-output', help='separate new directory, not part of the student files')
    args = parser.parse_args()
    with open(args.benchmark_json, encoding='utf-8') as source:
        report = json.load(source)
    print(json.dumps(export_draft(report, args.output_directory, seed=args.seed, recovery_per_episode=args.recovery_per_episode, private_output=args.private_agreement_output), indent=2))


if __name__ == '__main__':
    main()
