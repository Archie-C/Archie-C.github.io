"""Verify frozen expert labels against archived flights and exact teacher code."""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES
from rocket_expert_versions import load_expert
from rocket_observation_scope import envelope_violations


def audit_labels(dataset, report_path):
    """Check every flight label and independently re-query every recovery label."""
    dataset = Path(dataset)
    opener = gzip.open if str(report_path).endswith('.gz') else open
    with opener(report_path, 'rt', encoding='utf-8') as source:
        report = json.load(source)
    runs = {run['case_id']: run for run in report['policies']['discrete_expert']['runs']}
    decisions = {case: {entry['time']: entry for entry in run['replay']['decisions']}
                 for case, run in runs.items()}
    policies, split_groups = {}, []
    counts = {'expert flight': 0, 'perturbed recovery state': 0}
    for split in ('train', 'validation'):
        groups = set()
        with (dataset / f'{split}.csv').open(newline='', encoding='utf-8') as data, \
             (dataset / f'{split}_metadata.jsonl').open(encoding='utf-8') as metadata:
            reader = csv.reader(data)
            if next(reader) != [*OBSERVATION_NAMES, 'action']:
                raise ValueError('unexpected student observation schema')
            for row, line in zip(reader, metadata, strict=True):
                info = json.loads(line)
                obs = np.asarray([float(value) for value in row[:-1]], dtype=np.float64)
                action = int(row[-1])
                if obs.shape != (12,) or not np.all(np.isfinite(obs)) or not 0 <= action <= 9:
                    raise ValueError('invalid observation or action')
                case_id = info['episode_id']
                if case_id not in runs:
                    raise ValueError('episode is absent from archived benchmark')
                run = runs[case_id]
                recorded_policy = run['replay']['config']['closed_loop']['policy']
                initial_bytes = json.dumps(run['initial'], sort_keys=True, separators=(',', ':')).encode()
                expected_group = hashlib.sha256(initial_bytes).hexdigest()
                if (info['group'] != expected_group or info['scenario'] != run['scenario'] or info['policy'] != recorded_policy or
                        info['physics_config'] != run['replay']['config']['physics_config'] or
                        info['scoring'] != run['result']):
                    raise ValueError('episode provenance differs from archived benchmark')
                groups.add(info['group'])
                p, _ = configuration(run['scenario'])
                violations = envelope_violations(obs, info['time'], p)
                if violations:
                    raise ValueError('label outside the calibrated envelope: ' + ', '.join(violations))
                kind = info['provenance']
                if kind == 'expert flight':
                    expected = decisions[case_id][info['time']]
                    if not np.array_equal(obs, expected['observation']) or action != expected['action']:
                        raise ValueError('flight label differs from archived expert decision')
                elif kind == 'perturbed recovery state':
                    key = (recorded_policy['version'], recorded_policy['source_sha256'],
                           recorded_policy['settings']['horizon_steps'])
                    if key not in policies:
                        module = load_expert(key[0], key[1])
                        policies[key] = module.DiscreteExpert(horizon_steps=key[2])
                    if policies[key].predict_action(obs) != action:
                        raise ValueError('recovery label differs from the recorded expert')
                else:
                    raise ValueError('unknown label provenance')
                counts[kind] += 1
        split_groups.append(groups)
    if split_groups[0] & split_groups[1]:
        raise ValueError('an episode group appears in both splits')
    return counts


def audit_private_agreement(path):
    """Recheck the historical agreement labels against their frozen teacher."""
    archive = Path(__file__).resolve().parents[2] / 'versions/expert-prototype-v0.5/rocket_expert.py'
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    expert = load_expert('expert-prototype-v0.5', digest).DiscreteExpert()
    count = fallbacks = 0
    path = Path(path)
    metadata_path = path.with_name(path.stem + '_metadata.jsonl')
    with path.open(newline='', encoding='utf-8') as source, metadata_path.open(encoding='utf-8') as metadata:
        reader = csv.reader(source)
        if next(reader) != [*OBSERVATION_NAMES, 'action']:
            raise ValueError('unexpected private agreement schema')
        for row, line in zip(reader, metadata, strict=True):
            info = json.loads(line)
            obs = np.asarray([float(value) for value in row[:-1]], dtype=np.float64)
            action = int(row[-1])
            if obs.shape != (12,) or not np.all(np.isfinite(obs)) or not 0 <= action <= 9:
                raise ValueError('invalid private agreement observation or action')
            p, _ = configuration(info['scenario'])
            if envelope_violations(obs, info['time'], p):
                raise ValueError('private agreement label is outside the calibrated envelope')
            if expert.predict_action(obs) != action:
                raise ValueError('private agreement label differs from the frozen expert')
            count += 1
            fallbacks += bool(expert.diagnostics.get('fallback'))
    if not count:
        raise ValueError('private agreement set is empty')
    return dict(labels=count, fallbacks=fallbacks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset')
    parser.add_argument('source_report')
    parser.add_argument('--private-agreement', help='optional private agreement CSV to check without printing its rows')
    args = parser.parse_args()
    results = dict(labels=audit_labels(args.dataset, args.source_report))
    if args.private_agreement:
        results['private_agreement'] = audit_private_agreement(args.private_agreement)
    print(json.dumps(results, sort_keys=True))


if __name__ == '__main__':
    main()
