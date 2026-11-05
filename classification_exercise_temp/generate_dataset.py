"""Generate one CSV of expert decisions from random rocket landings."""
import argparse
import csv
from dataclasses import replace
import random

from rocket_calibration import configuration
from rocket_closed_loop import make_observation
from rocket_expert import ExpertController
from rocket_physics import clearance, discrete_command, step
from rocket_scoring import score_contact

COLUMNS = ('run_id', 'step', 'x', 'y', 'vx', 'vy', 'theta', 'omega',
           'fuel_mass', 'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y',
           'air_density', 'action', 'success')


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


def run_expert(initial, parameters, max_time=20.0):
    """Return pre-action observations, actions, and the final touchdown result."""
    if clearance(initial, parameters)[0] <= 0:
        raise ValueError('initial state must be above ground')
    expert = ExpertController()
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


def generate_dataset(runs, seed, output):
    if runs < 1:
        raise ValueError('runs must be positive')
    rng = random.Random(seed)
    with open(output, 'w', newline='', encoding='utf-8') as target:
        writer = csv.writer(target)
        writer.writerow(COLUMNS)
        for run_id in range(runs):
            state, parameters = random_initial_state(rng)
            decisions, result = run_expert(state, parameters)
            for index, (observation, action) in enumerate(decisions):
                writer.writerow((run_id, index, *observation, action, int(result['success'])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, required=True)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error('--runs must be positive')
    generate_dataset(args.runs, args.seed, args.output)


if __name__ == '__main__':
    main()
