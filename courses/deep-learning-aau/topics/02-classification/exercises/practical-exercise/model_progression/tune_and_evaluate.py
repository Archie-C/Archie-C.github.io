"""Reproducible tuning and closed-loop validation for the model progression.

Each stage is tuned exactly as in example.ipynb (see experiment.py): gradient-descent stages search
the learning rate with early stopping, L-BFGS stages search the L2 penalty, and the candidate with
the best macro F1 on the tuning flights is kept. The selected model is then evaluated on the
separate validation dataset, both as a classifier and in closed-loop landing simulations.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

from experiment import (GD_SETTINGS, HERE, L2_PENALTIES, LBFGS_SETTINGS, LEARNING_RATES, SEED,
                        flight_split, grid_search, load_data, load_stage, metrics, stage_paths)

EXERCISE = HERE.parent
sys.path.insert(0, str(EXERCISE))
from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import State
from run_uploaded_controller import read_validation_runs, landing_diagnostics
from rocket_scoring import aggregate

OUTPUT = HERE / 'tuned_results'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, result):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    temp.replace(path)


class BrokenNormalization:
    """Original scaffold's single-observation normalization: all inputs become zero."""
    def __init__(self, model):
        self.action = int(model.classes_[np.argmax(model.weights[0])])
    def predict_action(self, observation):
        return self.action
    def predict(self, X):
        return np.full(len(X), self.action)


def simulations(model, cases, label):
    runs, scores = [], []
    for case in cases:
        scenario = case['scenario']
        parameters, _ = configuration(scenario)
        initial = State(**{key: float(case[key]) for key in State.__dataclass_fields__})
        outcome = evaluate_closed_loop(model.predict_action, initial, parameters, scenario,
            max_time=None, constant_wind=(float(case['wind_x']), float(case['wind_y'])))
        if outcome['replay']['status'] == 'error':
            raise RuntimeError(f"{label}, run {case['run_id']}: {outcome['termination_reason']}")
        scoring = outcome['scoring']
        diagnostic = landing_diagnostics(outcome, parameters)
        runs.append({'run_id': case['run_id'], 'status': outcome['replay']['status'],
                     'reason': outcome['termination_reason'], 'scoring': scoring,
                     'diagnostic': diagnostic,
                     'duration': outcome['replay']['terminal']['time']})
        scores.append(scoring)
        print('  flight', case['run_id'], outcome['termination_reason'], flush=True)
    summary = aggregate(scores)
    diagnostic_scores = [x['diagnostic']['diagnostic_score'] for x in runs if x['diagnostic']['diagnostic_score'] is not None]
    summary['mean_diagnostic_score'] = float(np.mean(diagnostic_scores)) if diagnostic_scores else None
    return {'summary': summary, 'runs': runs}


def write_summary(results, path):
    pct = lambda value: f'{100*value:.1f}%'
    models = results['models']
    lines = ['# Tuned progression: validation results', '',
             'Every stage was trained on the same flight-level split of landings.csv and tuned on its '
             'tuning flights, exactly as in example.ipynb: stages 01-02 use gradient descent with a '
             'learning-rate search and early stopping; stages 03 onwards use L-BFGS with an L2-penalty '
             'search. The candidate with the highest tuning macro F1 was kept and then evaluated on the '
             'separate validation dataset: 1,095 labelled observations from 10 flights, plus closed-loop '
             'landings from the same 10 starting states (failed flights score zero). See results.json for '
             'every candidate and flight.', '',
             '| Model | Optimiser | Selected | Epochs | Tuning macro F1 | Accuracy | Macro F1 | Successful flights | Mean score |',
             '|---|---|---|---:|---:|---:|---:|---:|---:|']
    first = models.get('01_flight_split', {})
    rows = []
    if 'original_single_observation_scaffold' in first:
        rows.append(('Original scaffold prediction', first['original_single_observation_scaffold'], None))
    rows += [(name, record, record['selection']) for name, record in sorted(models.items())]
    for name, record, selection in rows:
        classification = record['validation_classification']
        simulation = record['validation_simulations']['summary']
        if selection is None:
            optimiser = chosen = epochs = tuning = '–'
        else:
            optimiser = 'GD' if 'learning_rate' in selection else 'L-BFGS'
            chosen = (f"lr = {selection['learning_rate']:.3g}" if 'learning_rate' in selection
                      else f"L2 = {selection['l2']:g}")
            epochs = f"{selection['epochs_run']} ({selection['stop_reason'].replace('_', ' ')})"
            tuning = pct(selection['val_macro_f1'])
        lines.append(f"| {name} | {optimiser} | {chosen} | {epochs} | {tuning} | "
                     f"{pct(classification['accuracy'])} | {pct(classification['macro_f1'])} | "
                     f"{simulation['successful_runs']}/10 | {simulation['mean_score']:.1f}/100 |")
    lines += ['', 'These results describe this small validation set, not a guarantee of future landing '
              'performance.', '']
    path.write_text('\n'.join(lines), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', action='append',
                        help='Only tune this stage (file stem); repeat for several. Other stages already in '
                             'results.json are kept.')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    ids, X, y = load_data(EXERCISE / 'landings.csv')
    val_ids, val_X, val_y = load_data(EXERCISE / 'validation_runs.csv')
    cases = read_validation_runs(EXERCISE / 'validation_runs.csv')
    if {tuple(row) for row in X}.intersection(tuple(row) for row in val_X):
        raise ValueError('Training and validation datasets share observations.')
    train, tune, heldout = flight_split(ids, SEED)
    results = {'seed': SEED,
               'search': {'gradient_descent': {'learning_rates': LEARNING_RATES, **GD_SETTINGS},
                          'lbfgs': {'l2_penalties': L2_PENALTIES, **LBFGS_SETTINGS}},
               'selection': 'highest tuning macro F1',
               'training_sha256': digest(EXERCISE / 'landings.csv'),
               'validation_sha256': digest(EXERCISE / 'validation_runs.csv'),
               'validation_flights': sorted(set(val_ids.tolist())),
               'split': {'all_stages': 'whole flights, 80% train / 10% tuning / 10% held out',
                         'held_out_training_dataset_flight_ids': np.unique(ids[heldout]).tolist(),
                         'training_flight_ids': np.unique(ids[train]).tolist(),
                         'tuning_flight_ids': np.unique(ids[tune]).tolist()},
               'models': {}}
    previous = output / 'results.json'
    if args.model and previous.exists():
        old = json.loads(previous.read_text(encoding='utf-8'))
        # Compare via JSON so tuples in the settings match the lists read back from the file.
        if any(old.get(key) != json.loads(json.dumps(results[key]))
               for key in ('split', 'search', 'training_sha256')):
            raise ValueError('Existing results.json used a different split, search or dataset; rerun all stages.')
        results['models'] = old['models']
    for path in stage_paths():
        if args.model and path.stem not in args.model:
            continue
        started = time.perf_counter()
        print('\n', path.stem, flush=True)
        search = grid_search(load_stage(path.stem), X[train], y[train], X[tune], y[tune])
        model = search['best_model']
        model.save(output / (path.stem + '.npz'))
        record = {'source_sha256': digest(path), 'selection': search['best'], 'candidates': search['rows'],
                  'validation_classification': metrics(model, val_X, val_y)}
        if path.stem == '01_flight_split':
            broken = BrokenNormalization(model)
            record['original_single_observation_scaffold'] = {
                'action': broken.action, 'validation_classification': metrics(broken, val_X, val_y),
                'validation_simulations': simulations(broken, cases, 'original scaffold')}
        record['validation_simulations'] = simulations(model, cases, path.stem)
        record['elapsed_seconds'] = time.perf_counter()-started
        results['models'][path.stem] = record
        write_json(output / 'results.json', results)
        print('  finished', path.stem, record['validation_classification'],
              record['validation_simulations']['summary'], flush=True)
    write_summary(results, output / 'summary.md')


if __name__ == '__main__':
    main()
