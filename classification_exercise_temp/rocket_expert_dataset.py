"""Build an EXPERIMENTAL episode-split dataset from recorded expert decisions.

This tool does not certify or publish a dataset. Acceptance gates, hidden sets,
off-trajectory recovery samples, and classifier sanity checks remain separate.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import random

import numpy as np

from rocket_closed_loop import OBSERVATION_NAMES, OBSERVATION_VERSION

DATASET_VERSION = 'expert-draft-v0.1'
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


def export_draft(report, output, *, seed=20261105, validation_fraction=.25):
    """Write a draft only; reject ambiguous provenance and cross-split leakage."""
    if not 0 < validation_fraction < 1:
        raise ValueError('validation_fraction must be between zero and one')
    runs = report['policies']['discrete_expert']['runs']
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
                             diagnostics=decision.get('diagnostics')))
        if rows:
            episodes.append(dict(episode_id=episode_id, group=group, scenario=run['scenario'],
                                 scoring=run['result'], physics_config=config['physics_config'],
                                 policy=policy, replay_run_id=config['run_id'], rows=rows))
    groups = sorted({episode['group'] for episode in episodes})
    if len(groups) < 2:
        raise ValueError('at least two distinct initial conditions are required')
    random.Random(seed).shuffle(groups)
    validation_groups = set(groups[:max(1, min(len(groups)-1, round(len(groups)*validation_fraction)))])
    splits = {name: [episode for episode in episodes if (episode['group'] in validation_groups) == (name == 'validation')]
              for name in ('train', 'validation')}
    observations = {name: [row['observation'] for episode in subset for row in episode['rows']]
                    for name, subset in splits.items()}
    if _near_duplicate(observations['train'], observations['validation']):
        raise ValueError('near-duplicate observations across episode splits; change grouping or sampling')
    path = Path(output)
    path.mkdir(parents=True, exist_ok=True)
    if any(path.iterdir()):
        raise ValueError('output directory must be empty')
    counts = {}
    for name, subset in splits.items():
        counts[name] = Counter()
        with (path / f'{name}.csv').open('w', newline='', encoding='utf-8') as data, \
             (path / f'{name}_metadata.jsonl').open('w', encoding='utf-8') as metadata:
            writer = csv.writer(data)
            writer.writerow([*OBSERVATION_NAMES, 'action'])
            for episode in subset:
                for row in episode['rows']:
                    writer.writerow([*row['observation'], row['action']])
                    counts[name][row['action']] += 1
                    record = {key: episode[key] for key in ('episode_id', 'group', 'scenario', 'scoring',
                                                            'physics_config', 'policy', 'replay_run_id')}
                    record.update(time=row['time'], diagnostics=row['diagnostics'], provenance='expert flight')
                    metadata.write(json.dumps(record, allow_nan=False, separators=(',', ':')) + '\n')
    manifest = dict(dataset_version=DATASET_VERSION, status='experimental; not approved for release',
                    observation_version=OBSERVATION_VERSION, observation_names=OBSERVATION_NAMES,
                    units=['m', 'm', 'm/s', 'm/s', 'rad', 'rad/s', 'kg', 'N', 'rad', 'm/s', 'm/s', 'kg/m^3'],
                    action='integer 0–9', split_seed=seed, validation_fraction=validation_fraction,
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
    args = parser.parse_args()
    with open(args.benchmark_json, encoding='utf-8') as source:
        report = json.load(source)
    print(json.dumps(export_draft(report, args.output_directory, seed=args.seed), indent=2))


if __name__ == '__main__':
    main()
