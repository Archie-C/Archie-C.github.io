"""Generate one CSV of expert decisions from random rocket landings."""
import argparse
import csv
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from dataclasses import replace
import logging
import json
from pathlib import Path
import os
import random
import time

from rocket_calibration import configuration
from rocket_closed_loop import make_observation, evaluate_closed_loop
from rocket_expert import ExpertController
from rocket_physics import State, clearance, discrete_command, step
from rocket_scoring import CONFIG as score_config, score_contact

COLUMNS = ('run_id', 'step', 'x', 'y', 'vx', 'vy', 'theta', 'omega',
           'fuel_mass', 'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y',
           'air_density', 'action', 'success')
logger = logging.getLogger(__name__)


def random_initial_state(rng):
    """Sample independently within the calibrated vehicle's physical limits."""
    p, initial = configuration('centred_descent')
    # A mixture of the ranges used in the expert's held-out evaluation.
    limits = rng.choice((
        ((-8, 8), (420, 480), (-1, 1), (-51, -45), (-.015, .015), (-.002, .002), (8000, 10000)),
        ((-25, 25), (400, 600), (-4, 4), (-65, -45), (-.06, .06), (-.012, .012), (6000, 12000)),
        ((-55, 55), (350, 700), (-9, 9), (-75, -40), (-.16, .16), (-.04, .04), (2500, 12000)),
    ))
    state = replace(initial, **dict(zip(('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel'),
                                        (rng.uniform(*bounds) for bounds in limits))))
    wind_x, wind_y = rng.uniform(-7, 7), rng.uniform(-2, 2)
    return state, replace(p, wind=lambda y, t: (wind_x, wind_y))


def validation_samples():
    """Fixed, unnamed validation starts with increasing disturbances."""
    # x, y, vx, vy, theta, omega, fuel, wind_x, wind_y (SI units)
    starts = (
        (0, 300, 0, -30, 0, 0, 10000, 0, 0),
        (4, 450, 0, -48, 0, 0, 9000, 0, 0),
        (-4, 450, .5, -48, 0, 0, 9000, 0, 0),
        (5, 450, -.5, -48, 0, 0, 9000, 2, 0),
        (-6, 450, 1, -48, .01, 0, 9000, -2, 0),
        (-15, 450, 2, -48, .03, .004, 9000, -4, .5),
        (18, 450, -2, -48, -.03, -.005, 9000, 5, -.5),
        (-35, 500, 4, -60, .07, .01, 8000, -6, 1),
        (40, 500, -5, -62, -.08, -.012, 7500, 7, -1),
        (0, 35, 0, -100, 0, 4, 9000, 0, 0),
    )
    for x, y, vx, vy, theta, omega, fuel, wx, wy in starts:
        yield State(x, y, vx, vy, theta, omega, fuel, 0, 0), (wx, wy)


def run_expert(initial, parameters, max_time=20.0):
    """Return pre-action observations, actions, and the final touchdown result."""
    if clearance(initial, parameters)[0] <= 0:
        raise ValueError('initial state must be above ground')
    expert = ExpertController(actuator_delay=parameters.actuator_delay)
    state, time, decisions, contact = initial, 0., [], None
    for decision in range(round(max_time / parameters.control_interval)):
        observation = make_observation(state, time, parameters)
        action = expert.predict_action(observation.copy())
        decisions.append((observation.tolist(), action))
        command = discrete_command(action, parameters)
        boundary = (decision + 1) * parameters.control_interval
        while time < boundary - 1e-10:
            h = min(parameters.timestep, boundary - time)
            state, contact = step(time, state, command, parameters, h)
            time = contact.time if contact else time + h
            if contact:
                break
        if contact:
            break
    return decisions, score_contact(contact, parameters)


def _run_sample(sample):
    """Rebuild the constant-wind parameters inside a worker process."""
    state, wind = sample
    parameters, _ = configuration('centred_descent')
    parameters = replace(parameters, wind=lambda y, t: wind)
    return run_expert(state, parameters)


def generate_dataset(runs, seed, output, workers=1, replay_dir=None, fixed_validation=False):
    if runs < 1:
        raise ValueError('runs must be positive')
    if fixed_validation and runs != 10:
        raise ValueError('fixed validation requires exactly 10 runs')
    if workers < 1:
        raise ValueError('workers must be positive')
    if replay_dir is not None:
        replay_dir = Path(replay_dir)
        replay_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    worker_count = min(workers, runs, 61 if os.name == 'nt' else workers)
    start = last_log = time.monotonic()
    completed_count = success_count = row_count = 0
    logger.info('Starting %d runs (seed=%s, workers=%d, output=%s)', runs, seed, worker_count, output)

    def report_completed(result_pair):
        nonlocal completed_count, success_count, last_log
        completed_count += 1
        success_count += int(result_pair[1]['success'])
        now = time.monotonic()
        if completed_count == 1 or completed_count == runs or now - last_log >= 5:
            logger.info('Completed %d/%d runs (%.1f%%), %d successful, elapsed %.1fs',
                        completed_count, runs, 100 * completed_count / runs, success_count, now - start)
            last_log = now

    with open(output, 'w', newline='', encoding='utf-8') as target:
        writer = csv.writer(target)
        writer.writerow(COLUMNS)

        def samples():
            if fixed_validation:
                yield from validation_samples()
                return
            for _ in range(runs):
                state, parameters = random_initial_state(rng)
                yield state, parameters.wind(0, 0)

        def write_run(run_id, result_pair):
            nonlocal row_count
            decisions, result = result_pair
            for index, (observation, action) in enumerate(decisions):
                writer.writerow((run_id, index, *observation, action, int(result['success'])))
            row_count += len(decisions)
            if replay_dir is not None:
                obs = decisions[0][0]
                state = State(x=obs[0] + (score_config.pad_left + score_config.pad_right) / 2,
                              y=obs[1] + score_config.pad_height, vx=obs[2], vy=obs[3],
                              theta=obs[4], omega=obs[5], fuel=obs[6], thrust=obs[7], gimbal=obs[8])
                parameters, _ = configuration('centred_descent')
                actions = iter(action for _, action in decisions)
                replay_result = evaluate_closed_loop(lambda observation: next(actions), state, parameters,
                    'centred_descent', max_time=len(decisions) * parameters.control_interval,
                    constant_wind=(obs[9], obs[10]))
                if replay_result['replay']['status'] == 'error':
                    raise ValueError(f"Could not reconstruct expert run {run_id}: {replay_result['termination_reason']}")
                (replay_dir / f'run_{run_id}.json').write_text(
                    json.dumps(replay_result['replay'], allow_nan=False), encoding='utf-8')

        if workers == 1:
            for run_id, sample in enumerate(samples()):
                result = _run_sample(sample)
                report_completed(result)
                write_run(run_id, result)
        else:
            # Keep a bounded window of work in flight while writing in run order.
            sample_iter = samples()
            with ProcessPoolExecutor(max_workers=worker_count) as pool:
                pending, completed = {}, {}
                next_submit = next_write = 0
                while next_write < runs:
                    while next_submit < runs and next_submit - next_write < 2 * worker_count:
                        future = pool.submit(_run_sample, next(sample_iter))
                        pending[future] = next_submit
                        next_submit += 1
                    done, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        result = future.result()
                        completed[pending.pop(future)] = result
                        report_completed(result)
                    while next_write in completed:
                        write_run(next_write, completed.pop(next_write))
                        next_write += 1
    logger.info('Wrote %d rows to %s in %.1fs', row_count, output, time.monotonic() - start)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, help='number of random runs (fixed validation always has 10)')
    parser.add_argument('--fixed-validation', action='store_true', help='use the ten predefined validation starts')
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--output', required=True)
    parser.add_argument('--workers', type=int, default=min(os.cpu_count() or 1, 61 if os.name == 'nt' else (os.cpu_count() or 1)),
                        help='worker processes (default: available CPU count; use 1 for serial execution)')
    parser.add_argument('--replay-dir', help='save expert replay JSON files in this directory')
    args = parser.parse_args()
    if args.fixed_validation:
        if args.runs not in (None, 10):
            parser.error('--fixed-validation requires 10 runs')
        args.runs = 10
    elif args.runs is None or args.runs < 1:
        parser.error('--runs must be positive')
    if args.workers < 1:
        parser.error('--workers must be positive')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', datefmt='%H:%M:%S')
    generate_dataset(args.runs, args.seed, args.output, workers=args.workers, replay_dir=args.replay_dir, fixed_validation=args.fixed_validation)


if __name__ == '__main__':
    main()
