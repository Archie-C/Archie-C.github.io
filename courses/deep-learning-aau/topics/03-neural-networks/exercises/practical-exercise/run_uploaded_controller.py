"""Evaluate a continuous controller on validation flights."""
import importlib.util
import copy
import json
import math
from pathlib import Path
import sys

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import Command, State, mass_properties, relative_point
from rocket_scoring import CONFIG, aggregate

OBSERVATION_COLUMNS = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass', 'actual_thrust',
                       'actual_gimbal', 'wind_x', 'wind_y', 'air_density')


def landing_diagnostics(result, parameters):
    """Score first-contact motion continuously; timeouts have measurements but no score."""
    replay = result['replay']
    state = State(**replay['snapshots'][-1]['state'])
    _, centre, _ = mass_properties(state.fuel, parameters)
    midpoint = sum(state.x + relative_point(foot, centre, state.theta)[0]
                   for foot in parameters.feet) / 2 - (CONFIG.pad_left + CONFIG.pad_right) / 2
    metrics = dict(vy=state.vy, vx=state.vx, theta=state.theta,
                   omega=state.omega, midpoint_offset=midpoint,
                   clearance=replay['snapshots'][-1]['diagnostics']['clearance'])
    diagnostic_score = None
    if replay['status'] == 'contact' and result['scoring']['errors'] is not None:
        ratios = (abs(state.vy) / CONFIG.max_descent, abs(state.vx) / CONFIG.max_horizontal_speed,
                  abs(state.theta) / CONFIG.max_tilt, abs(state.omega) / CONFIG.max_angular_rate,
                  abs(midpoint) / CONFIG.d_ref)
        diagnostic_score = 100 * sum(weight / (1 + ratio)
                                     for weight, ratio in zip(CONFIG.weights, ratios))
    return dict(metrics=metrics, diagnostic_score=diagnostic_score)


def controller_command(controller, observation):
    """Validate normalized thrust and gimbal commands from the controller."""
    output = np.asarray(controller.predict_action(observation), dtype=float)
    if output.shape != (2,) or not np.all(np.isfinite(output)):
        raise ValueError('predict_action must return two finite values: thrust and gimbal')
    thrust, gimbal = output
    if not (0 <= thrust <= 1 and -1 <= gimbal <= 1):
        raise ValueError('thrust must be in [0, 1] and gimbal in [-1, 1]')
    return Command(float(thrust), float(gimbal))


def evaluate_flights(controller):
    """Evaluate fresh flights from the simulator's predefined initial states."""
    runs, replays, scores, diagnostic_scores = [], [], [], []
    for scenario in ('centred_descent', 'demo_descent', 'crosswind_diagnostics', 'near_ground_contact'):
        parameters, initial = configuration(scenario)
        policy = copy.deepcopy(controller)
        if callable(getattr(policy, 'reset', None)):
            policy.reset()
        result = evaluate_closed_loop(lambda obs: controller_command(policy, obs), initial,
                                      parameters, scenario, max_time=60.0, control_mode='continuous')
        if result['replay']['status'] == 'error':
            raise ValueError(f"{scenario}: {result['termination_reason']}")
        diagnostic = landing_diagnostics(result, parameters)
        scores.append(result['scoring'])
        if diagnostic['diagnostic_score'] is not None:
            diagnostic_scores.append(diagnostic['diagnostic_score'])
        runs.append({'run_id': scenario, 'scoring': result['scoring'], **diagnostic,
                     'termination_reason': result['termination_reason'],
                     'duration': result['replay']['terminal']['time']})
        replays.append(result['replay'])
    summary = aggregate(scores)
    summary['mean_diagnostic_score'] = sum(diagnostic_scores) / len(diagnostic_scores) if diagnostic_scores else None
    summary['scored_contacts'] = len(diagnostic_scores)
    return {'runs': runs, 'summary': summary, 'replays': replays}


def main(source_path, weights_path=None):
    spec = importlib.util.spec_from_file_location('uploaded_controller', source_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    controller = module.Controller()
    if not callable(getattr(controller, 'predict_action', None)):
        raise ValueError('Controller must implement predict_action(observation)')
    if weights_path is not None:
        if not callable(getattr(controller, 'load', None)):
            raise ValueError('Controller must implement load(path) to use saved weights')
        controller.load(weights_path)
    return {'validation': evaluate_flights(controller),
            'limits': dict(vy=CONFIG.max_descent, vx=CONFIG.max_horizontal_speed,
                           theta=math.degrees(CONFIG.max_tilt), omega=math.degrees(CONFIG.max_angular_rate),
                           midpoint_offset=CONFIG.d_ref)}


if __name__ == '__main__':
    try:
        result = main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 else None)
    except Exception as exc:
        result = {'error': f'{type(exc).__name__}: {exc}'}
    Path(sys.argv[2]).write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
