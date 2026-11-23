"""Reproducible tuning and closed-loop validation for the model progression."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

# Avoid oversubscribing BLAS on the relatively narrow design matrices.
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
import numpy as np
from scipy.optimize import minimize

HERE = Path(__file__).resolve().parent
EXERCISE = HERE.parent
sys.path.insert(0, str(EXERCISE))
from train_models import load_data, flight_split, metrics
from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import State
from run_uploaded_controller import read_validation_runs, landing_diagnostics
from rocket_scoring import aggregate, CONFIG

OUTPUT = HERE / 'tuned_results'
SEED = 42
MAXITER = 300
REGULARIZATION = (0.0, 0.001, 0.01)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, result):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    temp.replace(path)


def train_and_tune(model, X, y, tune_X, tune_y):
    model.classes_, labels = np.unique(y, return_inverse=True)
    if not np.isin(tune_y, model.classes_).all():
        raise ValueError('Tuning classes must appear in training.')
    counts = np.bincount(labels)
    stage = int(model.__class__.__module__.split('_')[0])
    class_weights = len(y)/(len(counts)*counts) if stage >= 3 else np.ones(len(counts))
    sample_weights = class_weights[labels]
    train_design = model._create_design_matrix(X, fit_normalization=True)
    tune_design = model._create_design_matrix(tune_X)
    one_hot = np.eye(len(counts))[labels]
    # Stage 1's scaffold does not otherwise need this value for saving.
    model.class_weights_ = class_weights
    model.train_loss_history, model.validation_loss_history = [], []
    results = []
    best = None
    for penalty in REGULARIZATION:
        def objective(flat):
            w = flat.reshape(train_design.shape[1], len(counts))
            scores = train_design @ w
            shifted = scores - scores.max(axis=1, keepdims=True)
            exp_scores = np.exp(shifted)
            probs = exp_scores / exp_scores.sum(axis=1, keepdims=True)
            loss = -np.sum(sample_weights[:, None] * one_hot * np.log(np.maximum(probs, 1e-300))) / sample_weights.sum()
            reg = w.copy()
            reg[0] = 0
            loss += .5*penalty*np.sum(reg*reg)
            grad = train_design.T @ ((probs-one_hot)*sample_weights[:, None])/sample_weights.sum() + penalty*reg
            return loss, grad.ravel()
        result = minimize(objective, np.zeros(train_design.shape[1]*len(counts)), jac=True,
                          method='L-BFGS-B', options={'maxiter': MAXITER, 'ftol': 1e-8})
        model.weights = result.x.reshape(train_design.shape[1], len(counts))
        tune_pred = model.classes_[np.argmax(tune_design @ model.weights, axis=1)]
        labels_eval = np.union1d(tune_y, tune_pred)
        f1 = []
        for action in labels_eval:
            tp = np.sum((tune_pred == action) & (tune_y == action))
            fp = np.sum((tune_pred == action) & (tune_y != action))
            fn = np.sum((tune_pred != action) & (tune_y == action))
            f1.append(float(2*tp/(2*tp+fp+fn)))
        candidate = dict(l2=penalty, tune_macro_f1=float(np.mean(f1)),
                         tune_accuracy=float(np.mean(tune_pred == tune_y)),
                         iterations=int(result.nit), converged=bool(result.success),
                         optimizer_message=str(result.message))
        results.append(candidate)
        print('  ', candidate, flush=True)
        if best is None or candidate['tune_macro_f1'] > best[0]:
            best = candidate['tune_macro_f1'], model.weights.copy(), candidate
    model.weights = best[1]
    return best[2], results


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
    group_train, group_tune, heldout = flight_split(ids, SEED)
    # Match the scaffold's random row-wise 80/10/10 split for stage 1 only.
    indices = np.random.default_rng(SEED).permutation(len(X))
    row_train = np.zeros(len(X), dtype=bool)
    row_tune = np.zeros(len(X), dtype=bool)
    row_train[indices[:int(.8*len(X))]] = True
    row_tune[indices[int(.8*len(X)):int(.9*len(X))]] = True
    results = {'seed': SEED, 'optimizer': 'L-BFGS-B', 'max_iterations': MAXITER,
               'regularization_candidates': REGULARIZATION,
               'selection': 'highest tuning macro F1',
               'training_sha256': digest(EXERCISE / 'landings.csv'),
               'validation_sha256': digest(EXERCISE / 'validation_runs.csv'),
               'validation_flights': sorted(set(val_ids.tolist())),
               'split': {'stage_01': 'random rows, 80% train / 10% tuning',
                         'stages_02_to_07': 'whole flights, 80% train / 10% tuning',
                         'held_out_training_dataset_flight_ids': np.unique(ids[heldout]).tolist(),
                         'group_training_flight_ids': np.unique(ids[group_train]).tolist(),
                         'group_tuning_flight_ids': np.unique(ids[group_tune]).tolist()},
               'models': {}}
    previous = output / 'results.json'
    if args.model and previous.exists():
        old = json.loads(previous.read_text(encoding='utf-8'))
        if old.get('split') != results['split'] or old.get('training_sha256') != results['training_sha256']:
            raise ValueError('Existing results.json used a different split or dataset; rerun all stages.')
        results['models'] = old['models']
    for path in sorted(HERE.glob('[0-9][0-9]_*.py')):
        if args.model and path.stem not in args.model:
            continue
        started = time.perf_counter()
        print('\n', path.stem, flush=True)
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        model = module.Controller()
        stage = int(path.name[:2])
        training, tune = (row_train, row_tune) if stage == 1 else (group_train, group_tune)
        best, candidates = train_and_tune(model, X[training], y[training], X[tune], y[tune])
        model.save(output / (path.stem + '.npz'))
        record = {'source_sha256': digest(path), 'selection': best, 'candidates': candidates,
                  'validation_classification': metrics(model, val_X, val_y)}
        if stage == 1:
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


if __name__ == '__main__':
    main()
