"""Prepare trusted local agreement labels and separate private evaluation starts.

The output directory is not a sandbox or a public upload service. Keep it out
of the student distribution and apply the deployment's access controls.
"""
import argparse
import csv
from dataclasses import asdict
import gzip
import hashlib
import json
from pathlib import Path

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES, make_observation, evaluate_closed_loop
from rocket_expert import DiscreteExpert
from rocket_expert_benchmark import feasibility_cases, final_feasibility_cases
from rocket_expert_dataset import _near_duplicate
from rocket_softmax import read_csv


def prepare_private(public_dataset, output, *, agreement_seed, evaluation_seed,
                    agreement_count=4, evaluation_count=6, max_time=20.):
    """Make private agreement trajectories and disjoint closed-loop starts."""
    if type(agreement_seed) is not int or type(evaluation_seed) is not int:
        raise ValueError('seeds must be integers')
    if agreement_seed == evaluation_seed:
        raise ValueError('agreement and evaluation seeds must differ')
    if type(agreement_count) is not int or type(evaluation_count) is not int or min(agreement_count, evaluation_count) < 1:
        raise ValueError('counts must be positive integers')
    public = Path(public_dataset)
    target = Path(output)
    public_path, private_path = public.resolve(), target.resolve()
    if public_path == private_path or public_path in private_path.parents or private_path in public_path.parents:
        raise ValueError('private output must be separate from the student dataset')
    if target.exists():
        raise ValueError('private output directory must not already exist')
    train, _ = read_csv(public / 'train.csv')
    validation, _ = read_csv(public / 'validation.csv')
    visible = train.tolist() + validation.tolist()
    agreement_cases = feasibility_cases(count=agreement_count, seed=agreement_seed)
    evaluation_cases = feasibility_cases(count=evaluation_count, seed=evaluation_seed)
    def observations(cases):
        return [make_observation(case['initial'], 0., configuration(case['scenario'])[0]).tolist() for case in cases]
    agreement_starts, evaluation_starts = observations(agreement_cases), observations(evaluation_cases)
    final_starts = observations(final_feasibility_cases())
    exploratory_starts = observations(feasibility_cases(count=6, seed=42018))
    reserved_starts = final_starts + exploratory_starts
    if (_near_duplicate(visible, agreement_starts) or _near_duplicate(visible, evaluation_starts)
            or _near_duplicate(agreement_starts, evaluation_starts)
            or _near_duplicate(reserved_starts, agreement_starts + evaluation_starts)):
        raise ValueError('private starts overlap visible data or one another')
    expert = DiscreteExpert()
    records, hidden_labels = [], []
    for case in agreement_cases:
        p, _ = configuration(case['scenario'])
        result = evaluate_closed_loop(expert.predict_action, case['initial'], p, case['scenario'], max_time=max_time)
        if result['replay']['terminal']['type'] == 'error':
            raise ValueError(f"agreement policy failed: {result['termination_reason']}")
        records.append(result)
        hidden_labels.extend(d['observation'] for d in result['decisions'])
    if (_near_duplicate(visible, hidden_labels) or _near_duplicate(hidden_labels, evaluation_starts)
            or _near_duplicate(hidden_labels, reserved_starts)):
        raise ValueError('private agreement observations overlap visible data or evaluation starts')
    target.mkdir(parents=True, mode=0o700)
    if target.stat().st_mode & 0o077:
        target.rmdir()
        raise ValueError('filesystem does not support owner-only private directory permissions')
    (target / 'replays').mkdir(mode=0o700)
    for index, result in enumerate(records):
        payload = json.dumps(result['replay'], allow_nan=False, separators=(',', ':')).encode()
        (target / 'replays' / f'{index+1:02}.json.gz').write_bytes(gzip.compress(payload, mtime=0))
    with (target / 'agreement.csv').open('w', newline='', encoding='utf-8') as data, \
         (target / 'agreement_metadata.jsonl').open('w', encoding='utf-8') as metadata:
        writer = csv.writer(data)
        writer.writerow([*OBSERVATION_NAMES, 'action'])
        for index, (case, result) in enumerate(zip(agreement_cases, records)):
            for decision in result['decisions']:
                writer.writerow([*decision['observation'], decision['action']])
                metadata.write(json.dumps(dict(case_id=case['case_id'], scenario=case['scenario'],
                    time=decision['time'], diagnostics=decision['diagnostics'], replay=f'replays/{index+1:02}.json.gz',
                    scoring=result['scoring'], config=result['replay']['config']),
                    allow_nan=False, separators=(',', ':'))+'\n')
    starts = [dict(case_id=case['case_id'], scenario=case['scenario'], initial=asdict(case['initial']))
              for case in evaluation_cases]
    (target / 'evaluation_starts.json').write_text(json.dumps(starts, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    manifest = dict(schema='rocket-private-evaluation-v0.1', agreement_seed=agreement_seed,
                    evaluation_seed=evaluation_seed, agreement_count=agreement_count,
                    evaluation_count=evaluation_count, max_time=max_time,
                    expert_version=expert.version, expert_settings=expert.solver_settings,
                    expert_source_sha256=records[0]['replay']['config']['closed_loop']['policy']['source_sha256'],
                    student_file_sha256={name: hashlib.sha256((public / name).read_bytes()).hexdigest()
                                         for name in ('train.csv', 'validation.csv')},
                    status='trusted local artifacts; deployment access controls required')
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('student_dataset')
    parser.add_argument('private_output')
    parser.add_argument('--agreement-seed', type=int, required=True)
    parser.add_argument('--evaluation-seed', type=int, required=True)
    parser.add_argument('--agreement-count', type=int, default=4)
    parser.add_argument('--evaluation-count', type=int, default=6)
    args = parser.parse_args()
    prepare_private(args.student_dataset, args.private_output, agreement_seed=args.agreement_seed,
                    evaluation_seed=args.evaluation_seed, agreement_count=args.agreement_count,
                    evaluation_count=args.evaluation_count)
    print('Private agreement labels and separate evaluation starts created.')


if __name__ == '__main__':
    main()
