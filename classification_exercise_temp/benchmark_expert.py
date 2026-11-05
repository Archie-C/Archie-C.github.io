"""Evaluate the expert on reproducible starts and report touchdown failures."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import replace
import json
import random
import sys
import time

from generate_dataset import random_initial_state, run_expert
from rocket_calibration import configuration
from rocket_expert import EXPERT_VERSION, SOURCE_SHA256


def evaluate(sample):
    index, state, wind = sample
    p, _ = configuration('centred_descent')
    p = replace(p, wind=lambda y, t: wind)
    started = time.perf_counter()
    decisions, result = run_expert(state, p)
    return dict(index=index, success=result['success'], reasons=result['reasons'],
                score=result['score'], vx=result['vx'], vy=result['vy'],
                theta=result['theta'], omega=result['omega'],
                offset=result['midpoint_offset'], decisions=len(decisions),
                initial=list(state.values()), last_observation=decisions[-1][0] if decisions else None,
                seconds=round(time.perf_counter() - started, 2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=30)
    parser.add_argument('--seed', type=int, default=42001)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--indices', help='comma-separated zero-based sample indices')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.runs < 1 or args.workers < 1:
        parser.error('--runs and --workers must be positive')
    try:
        indices = {int(value) for value in args.indices.split(',')} if args.indices else None
    except ValueError:
        parser.error('--indices must be comma-separated integers')
    if indices is not None and (not indices or min(indices) < 0 or max(indices) >= args.runs):
        parser.error('--indices must fall within the sampled run range')
    rng = random.Random(args.seed)
    samples = []
    for i in range(args.runs):
        state, p = random_initial_state(rng)
        if indices is None or i in indices:
            samples.append((i, state, p.wind(0, 0)))
    started = time.perf_counter()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(evaluate, sample) for sample in samples]
        results = []
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(f"Completed {len(results)}/{len(samples)}: run {result['index']}, "
                  f"{'success' if result['success'] else ', '.join(result['reasons'])}",
                  file=sys.stderr, flush=True)
    results.sort(key=lambda result: result['index'])
    failures = Counter(reason for result in results for reason in result['reasons'])
    summary = dict(seed=args.seed, expert_version=EXPERT_VERSION,
                   expert_sha256=SOURCE_SHA256, runs=len(results),
                   successful=sum(r['success'] for r in results),
                   failure_reasons=failures,
                   wall_seconds=round(time.perf_counter() - started, 2))
    print(json.dumps(summary, indent=2))
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(dict(summary=summary, results=results), f, indent=2)


if __name__ == '__main__':
    main()
