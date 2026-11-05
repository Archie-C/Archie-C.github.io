"""Train and run a user-selected controller in a separate local process."""
import importlib.util
import csv
import copy
import json
import math
from pathlib import Path
import sys

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import State, mass_properties, relative_point
from rocket_scoring import CONFIG, aggregate

OBSERVATION_COLUMNS = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass', 'actual_thrust',
                       'actual_gimbal', 'wind_x', 'wind_y', 'air_density')


def read_observations(path):
    data = np.genfromtxt(path, delimiter=',', names=True, dtype=None, encoding='utf-8')
    X = np.column_stack([np.atleast_1d(data[name]) for name in OBSERVATION_COLUMNS])
    y = np.atleast_1d(data['action']).astype(int)
    if not len(y):
        raise ValueError(f'{path.name} must contain observations')
    return X, y


def classification_metrics(controller, X_test, y_test, X_train):
    """Accuracy and macro F1 over labels present in predictions or targets."""
    policy = copy.deepcopy(controller)
    if hasattr(policy, 'reset'):
        policy.reset()
    predictions = []
    for observation in X_test:
        action = policy.predict_action(observation.copy())
        if isinstance(action, (bool, np.bool_)) or not isinstance(action, (int, np.integer)) or not 0 <= action <= 9:
            raise ValueError('predict_action must return an integer action from 0 to 9')
        predictions.append(int(action))
    predictions = np.asarray(predictions)
    f1_scores = []
    for label in np.union1d(y_test, predictions):
        tp = np.sum((predictions == label) & (y_test == label))
        fp = np.sum((predictions == label) & (y_test != label))
        fn = np.sum((predictions != label) & (y_test == label))
        f1_scores.append(float(2 * tp / (2 * tp + fp + fn)))
    train_observations = {tuple(row) for row in X_train}
    overlap = sum(tuple(row) in train_observations for row in X_test)
    return dict(accuracy=float(np.mean(predictions == y_test)), macro_f1=float(np.mean(f1_scores)),
                sample_count=len(y_test), overlapping_observations=overlap)


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


def main(source_path):
    spec = importlib.util.spec_from_file_location('uploaded_controller', source_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    controller = module.Controller()
    X, y = read_observations(Path(__file__).with_name('landings.csv'))
    controller.fit(X, y)
    X_test, y_test = read_observations(Path(__file__).with_name('test_landings.csv'))
    classification = classification_metrics(controller, X_test, y_test, X)
    with Path(__file__).with_name('test_runs.csv').open(newline='', encoding='utf-8') as f:
        cases = list(csv.DictReader(f))
    if len(cases) != 10 or len({case['run_id'] for case in cases}) != 10:
        raise ValueError('test_runs.csv must contain 10 distinct runs')
    runs, replays = [], []
    for case in cases:
        scenario = case['scenario']
        parameters, _ = configuration(scenario)
        initial = State(**{key: float(case[key]) for key in State.__dataclass_fields__})
        run_controller = copy.deepcopy(controller)
        result = evaluate_closed_loop(run_controller.predict_action, initial, parameters, scenario,
                                      max_time=20.0, constant_wind=(float(case['wind_x']), float(case['wind_y'])))
        if result['replay']['status'] == 'error':
            raise ValueError(f"Run {case['run_id']}: {result['termination_reason']}")
        runs.append({'run_id': case['run_id'], 'scoring': result['scoring'],
                     **landing_diagnostics(result, parameters),
                     'termination_reason': result['termination_reason'],
                     'duration': result['replay']['terminal']['time']})
        if len(replays) < 2:
            replays.append(result['replay'])
    summary = aggregate([run['scoring'] for run in runs])
    diagnostic_scores = [run['diagnostic_score'] for run in runs if run['diagnostic_score'] is not None]
    summary['mean_diagnostic_score'] = sum(diagnostic_scores) / len(diagnostic_scores) if diagnostic_scores else None
    summary['scored_contacts'] = len(diagnostic_scores)
    return {'runs': runs, 'summary': summary, 'classification': classification, 'replays': replays,
            'limits': dict(vy=CONFIG.max_descent, vx=CONFIG.max_horizontal_speed,
                           theta=math.degrees(CONFIG.max_tilt), omega=math.degrees(CONFIG.max_angular_rate),
                           midpoint_offset=CONFIG.d_ref)}


if __name__ == '__main__':
    try:
        result = main(sys.argv[1])
    except Exception as exc:
        result = {'error': f'{type(exc).__name__}: {exc}'}
    Path(sys.argv[2]).write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
