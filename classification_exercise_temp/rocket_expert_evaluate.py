"""Evaluate the single expert on reproducible random starts or frozen regressions."""
import argparse
from concurrent.futures import ProcessPoolExecutor
from collections import Counter
from dataclasses import asdict, replace
import json
import math
from pathlib import Path
import random
import time

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_evaluation import CASES
from rocket_expert import ExpertController
from rocket_physics import clearance
from rocket_scoring import aggregate
from rocket_server import Run, state_packet

# Declared before evaluation; deliberately independent of the historical seeds.
HELD_OUT_SEED = 964731
TIERS = {
    # x, y, vx, vy, theta, omega, fuel; angles in radians, all others SI.
    'nominal': ((-8, 8), (420, 480), (-1, 1), (-51, -45), (-.015, .015), (-.002, .002), (8000, 10000)),
    'challenging': ((-25, 25), (400, 600), (-4, 4), (-65, -45), (-.06, .06), (-.012, .012), (6000, 12000)),
    'extreme': ((-55, 55), (350, 700), (-9, 9), (-75, -40), (-.16, .16), (-.04, .04), (2500, 12000)),
}


def sample_cases(seed=HELD_OUT_SEED, per_tier=100):
    if per_tier < 1:
        raise ValueError('per_tier must be positive')
    rng = random.Random(seed)
    cases = []
    for tier, limits in TIERS.items():
        for index in range(per_tier):
            scenario = 'crosswind_diagnostics' if index % 2 else 'centred_descent'
            p, initial = configuration(scenario)
            values = [rng.uniform(*bounds) for bounds in limits]
            state = replace(initial, **dict(zip(('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel'), values)))
            # These declared ranges are chosen to stay inside the model envelope.
            # Reject an invalid draw explicitly; never condition on controller success.
            run = Run(scenario)
            packet = state_packet(run, 0, state, run.command, 0)
            if clearance(state, p)[0] <= 0 or packet['diagnostics']['envelope_violations']:
                raise ValueError(f'invalid sampled start: {tier} {index}')
            cases.append(dict(case_id=f'{tier}-{index:03}', tier=tier, scenario=scenario, initial=state))
    return cases


def regression_cases():
    cases = [dict(case_id=f'diagnostic-{i:02}', tier='diagnostic', scenario=name,
                  initial=replace(configuration(name)[1], x=configuration(name)[1].x + dx))
             for i, (name, dx) in enumerate(CASES, 1)]
    # Historical final feasibility seed and distribution, without its historic target.
    rng = random.Random(73013)
    for i in range(12):
        name = 'centred_descent' if i % 2 == 0 else 'crosswind_diagnostics'
        _, state = configuration(name)
        state = replace(state, x=rng.uniform(-8, 8), y=rng.uniform(420, 480),
                        vx=rng.uniform(-1, 1), vy=rng.uniform(-51, -45),
                        theta=rng.uniform(-.015, .015), omega=rng.uniform(-.002, .002),
                        fuel=rng.uniform(8000, 10000), thrust=0., gimbal=0.)
        cases.append(dict(case_id=f'frozen-feasibility-{i+1:02}', tier='regression', scenario=name, initial=state))
    return cases


def _run_case(item):
    case, interval, output, max_time = item
    p, _ = configuration(case['scenario'])
    p = replace(p, control_interval=interval)
    expert = ExpertController(control_interval=interval)
    start = time.perf_counter()
    result = evaluate_closed_loop(expert.predict_action, case['initial'], p, case['scenario'], max_time=max_time, measure_time=True)
    wall = time.perf_counter() - start
    decisions = result['decisions']
    switches = sum(a['action'] != b['action'] for a, b in zip(decisions, decisions[1:]))
    fallback = sum(bool((d['diagnostics'] or {}).get('fallback')) for d in decisions)
    replay_path = f"{interval:.2f}-{case['case_id']}.json"
    with open(Path(output) / replay_path, 'w', encoding='utf-8') as target:
        json.dump(result['replay'], target, allow_nan=False, separators=(',', ':'))
    terminal = result['replay']['snapshots'][-1]
    reasons = list(result['scoring']['reasons'])
    if terminal['state']['fuel'] <= 0: reasons.append('fuel exhaustion')
    if terminal['diagnostics']['envelope_left']: reasons.append('out of envelope')
    if result['replay']['status'] == 'error': reasons.append('controller or physics error')
    return dict(case_id=case['case_id'], tier=case['tier'], scenario=case['scenario'],
                initial=asdict(case['initial']), outcome='candidate-safe touchdown' if result['scoring']['success'] else 'failed attempt',
                feasibility='not established', score=result['scoring'], failure_reasons=reasons,
                decisions=len(decisions), switches=switches, fallbacks=fallback,
                policy_seconds=result['policy_seconds'], wall_seconds=wall, replay=replay_path)


def evaluate(cases, intervals, output, max_time=20., workers=1, metadata=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if workers < 1:
        raise ValueError('workers must be positive')
    reports = []
    for interval in intervals:
        rows = []
        items = [(case, interval, str(output), max_time) for case in cases]
        # Ordered output makes the summaries and replay names reproducible.
        if workers == 1:
            completed = map(_run_case, items)
            pool = None
        else:
            pool = ProcessPoolExecutor(max_workers=workers)
            completed = pool.map(_run_case, items)
        def summary(group):
            total_decisions = sum(r['decisions'] for r in group)
            transitions = sum(max(0, r['decisions'] - 1) for r in group)
            counts = Counter(reason for r in group if not r['score']['success'] for reason in r['failure_reasons'])
            fallbacks = sum(r['fallbacks'] for r in group)
            return dict(**aggregate([r['score'] for r in group]), failure_reasons=dict(counts),
                        decisions=total_decisions, switches=sum(r['switches'] for r in group),
                        switching_rate=sum(r['switches'] for r in group) / transitions if transitions else 0.,
                        policy_seconds=sum(r['policy_seconds'] for r in group), wall_seconds=sum(r['wall_seconds'] for r in group),
                        optimisation_failures=fallbacks, timeout_count=0, fallbacks=fallbacks,
                        fallback_frequency=fallbacks / total_decisions if total_decisions else 0.)
        report = dict(control_interval=interval, overall=None, tiers={}, runs=rows, complete=False)
        reports.append(report)
        try:
            for row in completed:
                rows.append(row)
                report['overall'] = summary(rows)
                report['tiers'] = {tier: summary([r for r in rows if r['tier'] == tier]) for tier in sorted({r['tier'] for r in rows})}
                report['complete'] = len(rows) == len(cases)
                temporary = output / 'summary.json.tmp'
                with open(temporary, 'w', encoding='utf-8') as target:
                    json.dump(dict(schema='expert-evaluation-v1', expected_cases=len(cases), metadata=metadata or {}, reports=reports), target, indent=2, allow_nan=False)
                temporary.replace(output / 'summary.json')
        finally:
            if pool is not None:
                pool.shutdown(wait=True)
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    parser.add_argument('--set', choices=('held-out', 'regression'), default='held-out')
    parser.add_argument('--seed', type=int, default=HELD_OUT_SEED)
    parser.add_argument('--per-tier', type=int, default=100)
    parser.add_argument('--interval', type=float, choices=(.1, .05, .02), action='append')
    parser.add_argument('--max-time', type=float, default=20.)
    parser.add_argument('--workers', type=int, default=1)
    args = parser.parse_args()
    cases = sample_cases(args.seed, args.per_tier) if args.set == 'held-out' else regression_cases()
    evaluate(cases, args.interval or [.1, .05, .02], args.output, args.max_time, args.workers,
             metadata=dict(scenario_set=args.set, seed=args.seed if args.set == 'held-out' else None,
                           per_tier=args.per_tier if args.set == 'held-out' else None, max_time=args.max_time))


if __name__ == '__main__':
    main()
