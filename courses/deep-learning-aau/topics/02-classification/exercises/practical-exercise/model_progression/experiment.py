"""Shared experiment settings, used by example.ipynb, train_models.py and tune_and_evaluate.py.

Keeping the split, the hyperparameter grids and the selection rule in one place means the notebook
and the published results train exactly the same models.
"""
import csv
import importlib.util
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OBSERVATIONS = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass',
                'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y', 'air_density')
SEED = 42

# Gradient-descent stages (01, 02): tune the learning rate and stop early on the validation loss.
LEARNING_RATES = tuple(float(lr) for lr in np.logspace(np.log10(3), np.log10(0.01), 10))
GD_SETTINGS = {'epochs': 10000, 'patience': 20, 'min_delta': 1e-3}

# L-BFGS stages (03 onwards): tune the L2 penalty and run to convergence, so L2 is the only
# regulariser (no early stopping).
L2_PENALTIES = (0.0, 1e-4, 1e-3, 1e-2, 1e-1)
LBFGS_SETTINGS = {'epochs': 1000, 'patience': None}


def stage_paths():
    return sorted(HERE.glob('[0-9][0-9]_*.py'))


def load_stage(stage):
    """Return the Controller class from a stage file, by number (4) or file stem ('04_constant_velocity')."""
    pattern = f'{stage:02d}_*.py' if isinstance(stage, int) else f'{stage}.py'
    path = next(HERE.glob(pattern))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Controller


def load_data(path):
    """Return (run_ids, observations, actions) from a landings-style CSV."""
    with Path(path).open(newline='', encoding='utf-8') as source:
        header = next(csv.reader(source))
        indices = [header.index(name) for name in ('run_id', *OBSERVATIONS, 'action')]
        data = np.loadtxt(source, delimiter=',', usecols=indices, ndmin=2)
    if not np.isfinite(data).all() or not len(data):
        raise ValueError('Dataset must contain finite numeric run IDs, observations and actions.')
    return data[:, 0], data[:, 1:13], data[:, 13].astype(int)


def flight_split(run_ids, seed=SEED):
    """Boolean (train, validation, test) row masks, assigning whole flights ~80/10/10."""
    unique = np.unique(run_ids)
    if len(unique) < 3:
        raise ValueError('At least three flights are needed for train, validation and test.')
    unique = np.random.default_rng(seed).permutation(unique)
    n_test = max(1, int(round(.1*len(unique))))
    n_val = max(1, int(round(.1*len(unique))))
    return (np.isin(run_ids, unique[n_test+n_val:]),
            np.isin(run_ids, unique[n_test:n_test+n_val]),
            np.isin(run_ids, unique[:n_test]))


def metrics(model, X, y):
    """Accuracy and macro F1 of a trained model on (X, y)."""
    pred = model.predict(X)
    labels = np.union1d(y, pred)
    f1 = []
    for label in labels:
        tp = np.sum((pred == label) & (y == label))
        fp = np.sum((pred == label) & (y != label))
        fn = np.sum((pred != label) & (y == label))
        f1.append(float(2*tp/(2*tp+fp+fn)) if 2*tp+fp+fn else 0.)
    return {'accuracy': float(np.mean(pred == y)), 'macro_f1': float(np.mean(f1)), 'rows': int(len(y))}


def search_space(Controller):
    """(hyperparameter name, values to try, fixed settings) for this controller's optimiser."""
    if Controller.optimizer == 'gd':
        return 'learning_rate', LEARNING_RATES, GD_SETTINGS
    return 'l2', L2_PENALTIES, LBFGS_SETTINGS


def grid_search(Controller, X_train, y_train, X_val, y_val, verbose=True):
    """Train one model per hyperparameter value and keep the one with the best validation macro F1.

    Returns a dict with the hyperparameter name, one summary row per candidate, the full fit
    history per candidate, and the selected model and row.
    """
    name, values, fixed = search_space(Controller)
    rows, histories, best_model, best_row = [], {}, None, None
    for value in values:
        model = Controller(**{name: value}, **fixed)
        history = model.fit(X_train, y_train, X_val, y_val)
        histories[value] = history
        epoch, scores = history['best_epoch'], history['validation_metrics']
        row = {name: value, 'best_epoch': epoch, 'epochs_run': len(history['train_loss']) - 1,
               'stop_reason': history['stop_reason'],
               'train_loss': history['train_loss'][epoch], 'val_loss': history['validation_loss'][epoch],
               'val_accuracy': scores['accuracy'], 'val_macro_f1': scores['macro_f1'],
               **{f'f1_class_{c}': f for c, f in scores['per_class_f1'].items()}}
        rows.append(row)
        if verbose:
            print(f"\r{name}={value:.3g}: val macro F1 {row['val_macro_f1']:.3f}, "
                  f"{row['epochs_run']} epochs ({row['stop_reason']})".ljust(100), flush=True)
        if best_row is None or row['val_macro_f1'] > best_row['val_macro_f1']:
            best_model, best_row = model, row
    return {'parameter': name, 'rows': rows, 'histories': histories,
            'best_model': best_model, 'best': best_row}
