"""Fixed scenario-set evaluation with self-contained deterministic replays."""
from dataclasses import asdict, replace
import json
import sys

from rocket_scoring import CONFIG, aggregate
from rocket_server import offline, scenario

SCENARIO_SET = 'touchdown-scenarios-v1.0'
# Twelve deterministic variations of four calibrated starting conditions.
CASES = tuple((name, dx) for name in ('demo_descent', 'centred_descent',
              'crosswind_diagnostics', 'near_ground_contact') for dx in (-3., 0., 3.))


def evaluate(actions, name='submission'):
    runs = []
    for index, (scenario_name, dx) in enumerate(CASES):
        _, initial = scenario(scenario_name)
        replay = offline(actions, scenario_name, replace(initial, x=initial.x + dx))
        runs.append(dict(case_id=f'{SCENARIO_SET}:{index + 1:02}', scenario=scenario_name,
                         x_offset=dx, result=replay['terminal']['scoring'], replay=replay))
    return dict(name=name, scenario_set=SCENARIO_SET, scoring=asdict(CONFIG),
                metrics=aggregate([r['result'] for r in runs]), runs=runs)


def leaderboard(evaluations, sort_by='success_rate'):
    if sort_by not in ('success_rate', 'mean_successful_quality'):
        raise ValueError('unknown leaderboard metric')
    def key(entry):
        metrics = entry['metrics']
        quality = metrics['mean_successful_quality']
        quality = quality if quality is not None else -1
        primary = (metrics['success_rate'], quality) if sort_by == 'success_rate' else (quality, metrics['success_rate'])
        return (-primary[0], -primary[1], entry['name'])
    return sorted(evaluations, key=key)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    run_parser = commands.add_parser('run', help='evaluate an action sequence and save replays')
    run_parser.add_argument('actions', help='JSON array of discrete actions')
    run_parser.add_argument('output', help='evaluation JSON output path')
    run_parser.add_argument('--name', default='submission')
    rank_parser = commands.add_parser('leaderboard', help='rank saved evaluation files')
    rank_parser.add_argument('files', nargs='+')
    rank_parser.add_argument('--sort', choices=('success_rate', 'mean_successful_quality'), default='success_rate')
    args = parser.parse_args()
    if args.command == 'run':
        with open(args.actions, encoding='utf-8') as source:
            actions = json.load(source)
        if not isinstance(actions, list):
            parser.error('actions must be a JSON array')
        evaluation = evaluate(actions, args.name)
        with open(args.output, 'w', encoding='utf-8') as target:
            json.dump(evaluation, target, allow_nan=False, indent=2)
    else:
        evaluations = []
        for path in args.files:
            with open(path, encoding='utf-8') as source:
                entry = json.load(source)
            if entry['scenario_set'] != SCENARIO_SET or entry['scoring'] != json.loads(json.dumps(asdict(CONFIG))):
                parser.error(f'incompatible evaluation: {path}')
            evaluations.append(entry)
        print('Rank  Name  Success rate  Mean successful quality  Mean score')
        for rank, entry in enumerate(leaderboard(evaluations, args.sort), 1):
            m = entry['metrics']
            quality = 'N/A' if m['mean_successful_quality'] is None else f"{m['mean_successful_quality']:.2f}"
            print(f"{rank}  {entry['name']}  {m['success_rate']:.1%}  {quality}  {m['mean_score']:.2f}")
