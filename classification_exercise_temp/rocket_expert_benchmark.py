"""Reproducible closed-loop diagnostic and feasibility benchmark.

These are engineering trials, not a certified or hidden evaluation set.
"""
from collections import Counter
from dataclasses import asdict, replace
import argparse
import json
import random

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_evaluation import CASES, SCENARIO_SET
from rocket_expert import ContinuousReference, DiscreteExpert, guidance, simple_discrete_guidance
from rocket_scoring import aggregate

FEASIBILITY_SET = 'expert-feasibility-study-v0.1'
FEASIBILITY_SEED = 42017


def diagnostic_cases():
    return [dict(case_id=f'{SCENARIO_SET}:{i+1:02}', scenario=name,
                 initial=replace(configuration(name)[1], x=configuration(name)[1].x + dx))
            for i, (name, dx) in enumerate(CASES)]


def feasibility_cases(count=12, seed=FEASIBILITY_SEED):
    """Fixed-seed varied starts; a start is not presumed to be recoverable."""
    rng = random.Random(seed)
    cases = []
    for i in range(count):
        name = 'centred_descent' if i % 2 == 0 else 'crosswind_diagnostics'
        _, s = configuration(name)
        # Use the same nominal altitude/velocity range for both wind profiles.
        s = replace(s, x=rng.uniform(-8, 8), y=rng.uniform(420, 480),
                    vx=rng.uniform(-1, 1), vy=rng.uniform(-51, -45),
                    theta=rng.uniform(-.015, .015), omega=rng.uniform(-.002, .002),
                    fuel=rng.uniform(8000, 10000), thrust=0., gimbal=0.)
        cases.append(dict(case_id=f'{FEASIBILITY_SET}:{i+1:02}', scenario=name, initial=s))
    return cases


def all_off(observation):
    return 0


def fixed_burn(observation):
    return 8


def policies():
    expert = DiscreteExpert()
    continuous = ContinuousReference()
    return {'all_off': (all_off, 'discrete'), 'fixed_burn': (fixed_burn, 'discrete'),
            'guidance': (guidance, 'continuous'), 'continuous_reference': (continuous.predict_command, 'continuous'),
            'discrete_guidance': (simple_discrete_guidance, 'discrete'),
            'discrete_expert': (expert.predict_action, 'discrete')}


def benchmark(cases, selected=None, max_time=20.):
    available = policies()
    selected = list(available) if selected is None else selected
    if not cases or not selected or any(name not in available for name in selected):
        raise ValueError('benchmark requires valid cases and policy names')
    reports = {}
    for name in selected:
        policy, mode = available[name]
        runs = []
        elapsed = 0.
        for case in cases:
            p, _ = configuration(case['scenario'])
            result = evaluate_closed_loop(policy, case['initial'], p, case['scenario'],
                                          max_time=max_time, control_mode=mode, measure_time=True)
            elapsed += result['policy_seconds']
            runs.append(dict(case_id=case['case_id'], scenario=case['scenario'],
                             initial=asdict(case['initial']), result=result['scoring'],
                             termination_reason=result['termination_reason'], replay=result['replay']))
        scores = [run['result'] for run in runs]
        reasons = Counter(reason for score in scores for reason in score['reasons'])
        decisions = [decision for run in runs for decision in run['replay']['decisions']]
        fallbacks = sum(bool((decision['diagnostics'] or {}).get('fallback')) for decision in decisions)
        reports[name] = dict(metrics=aggregate(scores), failure_reasons=dict(sorted(reasons.items())),
                             decisions=len(decisions), fallback_count=fallbacks,
                             fallback_frequency=fallbacks / len(decisions) if decisions else 0.,
                             mean_wall_seconds_per_decision=elapsed / len(decisions) if decisions else None,
                             runs=runs)
    comparison = []
    for case in cases:
        statuses = {}
        for name, report in reports.items():
            matching = next(run for run in report['runs'] if run['case_id'] == case['case_id'])
            statuses[name] = matching['result']['success']
        comparison.append(dict(case_id=case['case_id'], continuous_baseline_safe=statuses.get('guidance'),
                               continuous_reference_safe=statuses.get('continuous_reference'),
                               discrete_expert_safe=statuses.get('discrete_expert')))
    return dict(schema='rocket-expert-benchmark-v0.1', cases=comparison,
                diagnostic_scenario_set=SCENARIO_SET, feasibility_set=FEASIBILITY_SET,
                feasibility_seed=FEASIBILITY_SEED, feasibility_target=None,
                max_time=max_time, policies=reports)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    parser.add_argument('--set', choices=('diagnostic', 'feasibility'), default='diagnostic')
    parser.add_argument('--policy', action='append', choices=tuple(policies()))
    parser.add_argument('--max-time', type=float, default=20.)
    args = parser.parse_args()
    cases = diagnostic_cases() if args.set == 'diagnostic' else feasibility_cases()
    report = benchmark(cases, args.policy, args.max_time)
    with open(args.output, 'w', encoding='utf-8') as target:
        json.dump(report, target, allow_nan=False, separators=(',', ':'))
    for name, result in report['policies'].items():
        print(name, result['metrics'], 'fallbacks', result['fallback_count'])


if __name__ == '__main__':
    main()
