"""Verify acceptance evidence and freeze a local student dataset.

This is a trusted local preparation tool, not a publishing or upload service.
"""
import argparse
from collections import Counter
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES, evaluate_closed_loop, make_observation
from rocket_expert_versions import load_expert
from rocket_expert_audit import audit_labels
from rocket_expert_benchmark import FINAL_SET, FINAL_SEED, FINAL_SUCCESS_TARGET, final_feasibility_cases
from rocket_expert_dataset import _near_duplicate
from rocket_physics import Contact, State, discrete_command
from rocket_scoring import aggregate, score_contact
from rocket_server import Run
from rocket_observation_scope import envelope_violations
from rocket_softmax import read_csv

RELEASE_VERSION = 'expert-data-v1.1'


def _hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def freeze_dataset(draft, private, final_report, sanity_report, output, *, source_report=None):
    """Freeze only when documented trajectory, split and sanity gates pass."""
    draft, private, output = Path(draft), Path(private), Path(output)
    if output.exists():
        raise ValueError('release output must not already exist')
    if (private.stat().st_mode & 0o077) != 0:
        raise ValueError('private directory must have owner-only permissions')
    if source_report is None:
        raise ValueError('an archived source report is required for the label audit')
    draft_manifest = json.loads((draft / 'manifest.json').read_text(encoding='utf-8'))
    private_manifest = json.loads((private / 'manifest.json').read_text(encoding='utf-8'))
    with open(final_report, encoding='utf-8') as source:
        final = json.load(source)
    with open(sanity_report, encoding='utf-8') as source:
        sanity = json.load(source)
    hashes = {name: _hash(draft / name) for name in ('train.csv', 'validation.csv')}
    if private_manifest['student_file_sha256'] != hashes:
        raise ValueError('private evaluation does not match the draft dataset')
    teacher = load_expert(private_manifest['expert_version'], private_manifest['expert_source_sha256'])
    if private_manifest['agreement_seed'] == private_manifest['evaluation_seed']:
        raise ValueError('private agreement and evaluation seeds must differ')
    expected = final_feasibility_cases()
    frozen_path = Path(__file__).resolve().parents[2] / 'benchmarks' / 'feasibility-v1.0-manifest.json'
    frozen = json.loads(frozen_path.read_text(encoding='utf-8'))
    frozen_cases = [dict(case_id=case['case_id'], scenario=case['scenario'], initial=asdict(case['initial']))
                    for case in expected]
    if (frozen['cases'] != frozen_cases or frozen['target_success_rate'] != FINAL_SUCCESS_TARGET or
            final['max_time'] != frozen['run_limit_seconds']):
        raise ValueError('final report does not match the frozen feasibility manifest')
    if (final.get('evaluated_set') != 'final' or final.get('final_set') != FINAL_SET or
            final.get('final_seed') != FINAL_SEED or final.get('final_success_target') != FINAL_SUCCESS_TARGET):
        raise ValueError('final report has incompatible feasibility provenance')
    names = ('discrete_expert', 'continuous_reference', 'all_off', 'fixed_burn')
    for name in names:
        if name not in final['policies']:
            raise ValueError(f'final report is missing {name}')
        runs = final['policies'][name]['runs']
        if len(runs) != len(expected):
            raise ValueError('final report does not retain every case')
        for case, run in zip(expected, runs):
            replay = run['replay']
            p, _ = configuration(case['scenario'])
            terminal = replay['terminal']
            contact = (Contact(terminal['time'], State(**terminal['state']), tuple(terminal['point']))
                       if terminal['type'] == 'contact' else None)
            if (run['case_id'] != case['case_id'] or run['scenario'] != case['scenario'] or
                    run['initial'] != asdict(case['initial']) or
                    replay['config']['initial_state'] != asdict(case['initial']) or
                    replay['config']['physics_config'] != Run(case['scenario']).config['physics_config'] or
                    _canonical(run['result']) != _canonical(terminal['scoring']) or
                    _canonical(run['result']) != _canonical(score_contact(contact, p)) or
                    replay['config']['scoring']['version'] != 'touchdown-v1.0'):
                raise ValueError('final case or authoritative scoring does not match')
        if final['policies'][name]['metrics'] != aggregate([run['result'] for run in runs]):
            raise ValueError('final aggregate does not match individual scores')
    expert = final['policies']['discrete_expert']
    metrics = expert['metrics']
    if metrics['success_rate'] < FINAL_SUCCESS_TARGET:
        raise ValueError('discrete expert did not reach the frozen success target')
    if not final['policies']['continuous_reference']['metrics']['successful_runs']:
        raise ValueError('no safe continuous-reference touchdown')
    if any(metrics['success_rate'] <= final['policies'][name]['metrics']['success_rate']
           for name in ('all_off', 'fixed_burn')):
        raise ValueError('discrete expert did not improve on both fixed baselines')
    for run in expert['runs']:
        provenance = run['replay']['config']['closed_loop']['policy']
        if provenance['version'] != teacher.DiscreteExpert.version or provenance['source_sha256'] != teacher.SOURCE_SHA256:
            raise ValueError('final expert provenance does not match the release expert')
        p, _ = configuration(run['scenario'])
        decisions = run['replay']['decisions']
        commands = run['replay']['commands']
        if len(decisions) != len(commands):
            raise ValueError('final expert decisions and commands do not match')
        for index, (decision, command) in enumerate(zip(decisions, commands)):
            action = decision['action']
            expected_command = discrete_command(action, p)
            if (abs(decision['time'] - index*p.control_interval) > 1e-8 or
                    abs(command['effective_time'] - decision['time']) > 1e-8 or
                    command['action'] != action or command['throttle'] != expected_command.throttle or
                    command['gimbal'] != expected_command.gimbal):
                raise ValueError('final expert action mapping or timing is invalid')
    train, labels = read_csv(draft / 'train.csv')
    validation, valid_labels = read_csv(draft / 'validation.csv')
    agreement, agreement_labels = read_csv(private / 'agreement.csv')
    for observations, actions in ((train, labels), (validation, valid_labels), (agreement, agreement_labels)):
        if not np.all(np.isfinite(observations)) or np.any((actions < 0) | (actions > 9)):
            raise ValueError('nonfinite observation or invalid action in dataset')
    private_rows = [json.loads(line) for line in (private / 'agreement_metadata.jsonl').read_text(encoding='utf-8').splitlines()]
    if len(private_rows) != len(agreement):
        raise ValueError('private agreement metadata does not match its data')
    private_configs = {}
    for observation, row in zip(agreement, private_rows):
        if row['scenario'] not in private_configs:
            p, _ = configuration(row['scenario'])
            private_configs[row['scenario']] = (p, Run(row['scenario']).config['physics_config'])
        p, config_id = private_configs[row['scenario']]
        provenance = row['config']['closed_loop']['policy']
        if (provenance['version'] != teacher.EXPERT_VERSION or
                provenance['source_sha256'] != teacher.SOURCE_SHA256 or
                row['config']['physics_config'] != config_id or
                envelope_violations(observation, row['time'], p)):
            raise ValueError('private agreement is outside scope or has incompatible provenance')
    if set(labels.tolist()) != set(range(10)):
        raise ValueError('training labels do not include every action')
    if _near_duplicate(train.tolist(), validation.tolist()):
        raise ValueError('training and validation observations overlap')
    visible = train.tolist() + validation.tolist()
    if _near_duplicate(visible, agreement.tolist()):
        raise ValueError('private agreement overlaps student observations')
    starts = json.loads((private / 'evaluation_starts.json').read_text(encoding='utf-8'))
    private_starts = [make_observation(State(**case['initial']), 0., configuration(case['scenario'])[0]).tolist()
                      for case in starts]
    final_starts = [make_observation(case['initial'], 0., configuration(case['scenario'])[0]).tolist()
                    for case in expected]
    if (_near_duplicate(visible, private_starts + final_starts) or
            _near_duplicate(agreement.tolist(), private_starts + final_starts)):
        raise ValueError('evaluation starts overlap training or agreement observations')
    for case, observation in zip(starts, private_starts):
        p, _ = configuration(case['scenario'])
        if envelope_violations(observation, 0., p):
            raise ValueError('private evaluation start is outside the calibration envelope')
    if len(starts) != private_manifest['evaluation_count']:
        raise ValueError('private evaluation start count does not match its manifest')
    metadata_groups = []
    provenances = set()
    for split, samples in (('train', train), ('validation', validation)):
        rows = [json.loads(line) for line in (draft / f'{split}_metadata.jsonl').read_text(encoding='utf-8').splitlines()]
        if len(rows) != len(samples):
            raise ValueError('metadata and observations have different row counts')
        metadata_groups.append({row['group'] for row in rows})
        provenances.update(row['provenance'] for row in rows)
        if any(not row['scoring']['success'] for row in rows):
            raise ValueError('dataset contains an uncertified parent trajectory')
        actual_counts = Counter((labels if split == 'train' else valid_labels).tolist())
        if any(draft_manifest['class_counts'][split][str(i)] != actual_counts[i] for i in range(10)):
            raise ValueError('dataset class counts do not match manifest')
        if any(row['policy']['version'] != teacher.DiscreteExpert.version or row['policy']['source_sha256'] != teacher.SOURCE_SHA256 for row in rows):
            raise ValueError('dataset labels use a different expert')
    if not {'expert flight', 'perturbed recovery state'} <= provenances:
        raise ValueError('ordinary and recovery samples are both required')
    if metadata_groups[0] & metadata_groups[1]:
        raise ValueError('an initial condition occurs in both splits')
    for name in ('raw', 'engineered'):
        if sanity[name]['dataset_sha256'] != hashes or 'closed_loop' not in sanity[name]:
            raise ValueError('classifier report is missing or refers to different data')
    if sanity['engineered']['held_out_agreement'] <= sanity['raw']['held_out_agreement']:
        raise ValueError('engineered features do not improve held-out agreement')
    label_audit = audit_labels(draft, source_report)
    # Verify exact action, first-contact, score and complete replay determinism on
    # a recorded final case, using the same fixed version and solver settings.
    recorded = expert['runs'][0]
    p, _ = configuration(recorded['scenario'])
    policy = teacher.DiscreteExpert(**{'horizon_steps': recorded['replay']['config']['closed_loop']['policy']['settings']['horizon_steps']})
    replay = evaluate_closed_loop(policy.predict_action, State(**recorded['initial']), p,
                                  recorded['scenario'], max_time=final['max_time'])['replay']
    if _canonical(replay) != _canonical(recorded['replay']):
        raise ValueError('final expert replay is not reproducible')
    output.mkdir(parents=True)
    for name in ('train.csv', 'validation.csv', 'train_metadata.jsonl', 'validation_metadata.jsonl'):
        shutil.copyfile(draft / name, output / name)
    public_sanity = {name: {key: sanity[name][key] for key in
                            ('basis', 'held_out_agreement', 'confusion', 'train_class_counts',
                             'validation_class_counts')}
                     for name in ('raw', 'engineered')}
    for name in public_sanity:
        public_sanity[name]['closed_loop_metrics'] = sanity[name]['closed_loop']['metrics']
    manifest = dict(draft_manifest, dataset_version=RELEASE_VERSION,
                    status='frozen local student dataset', train_validation_sha256=hashes,
                    teacher=dict(version=teacher.EXPERT_VERSION, source_sha256=teacher.SOURCE_SHA256,
                                 settings=private_manifest['expert_settings']),
                    final_set=FINAL_SET, final_target=FINAL_SUCCESS_TARGET,
                    final_expert_metrics=metrics, deterministic_replay_verified=True,
                    final_manifest_sha256=_hash(frozen_path), final_report_sha256=_hash(final_report),
                    sanity_report_sha256=_hash(sanity_report),
                    private_evaluation='separate trusted-local directory; deployment access controls required',
                    release_checks_version='expert-release-checks-v1.2', classifier_sanity=public_sanity,
                    label_audit=label_audit, source_archive_sha256=_hash(source_report))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('draft'); parser.add_argument('private'); parser.add_argument('final_report')
    parser.add_argument('sanity_report'); parser.add_argument('source_report'); parser.add_argument('output')
    args = parser.parse_args()
    manifest = freeze_dataset(args.draft, args.private, args.final_report, args.sanity_report, args.output,
                              source_report=args.source_report)
    print('Frozen:', manifest['dataset_version'], 'at', args.output)


if __name__ == '__main__':
    main()
