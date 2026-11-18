"""Train and compare the standalone controllers on a shared flight-level split."""
import argparse
import csv
import importlib.util
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OBSERVATIONS = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass',
                'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y', 'air_density')
MODELS = sorted(HERE.glob('[0-9][0-9]_*.py'))


def load_data(path):
    with Path(path).open(newline='', encoding='utf-8') as source:
        header = next(csv.reader(source))
        indices = [header.index(name) for name in ('run_id', *OBSERVATIONS, 'action')]
        data = np.loadtxt(source, delimiter=',', usecols=indices, ndmin=2)
    if not np.isfinite(data).all() or not len(data):
        raise ValueError('Dataset must contain finite numeric run IDs, observations and actions.')
    return data[:, 0], data[:, 1:13], data[:, 13].astype(int)


def flight_split(run_ids, seed=42):
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
    pred = model.predict(X)
    labels = np.union1d(y, pred)
    f1 = []
    for label in labels:
        tp = np.sum((pred == label) & (y == label))
        fp = np.sum((pred == label) & (y != label))
        fn = np.sum((pred != label) & (y == label))
        f1.append(float(2*tp/(2*tp+fp+fn)) if 2*tp+fp+fn else 0.)
    return {'accuracy': float(np.mean(pred == y)), 'macro_f1': float(np.mean(f1)),
            'rows': int(len(y))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=HERE.parent / 'landings.csv')
    parser.add_argument('--output', type=Path, default=HERE / 'results')
    parser.add_argument('--model', choices=[p.stem for p in MODELS], action='append',
                        help='Select a model; repeat to select several (default: all).')
    parser.add_argument('--epochs', type=int, default=2000)
    parser.add_argument('--learning-rate', type=float, default=.01)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.epochs < 1 or args.learning_rate <= 0:
        parser.error('epochs and learning rate must be positive')
    ids, X, y = load_data(args.data)
    train, val, test = flight_split(ids, args.seed)
    if not np.isin(y[val], y[train]).all():
        raise ValueError('Validation includes classes absent from training; choose another split seed or add flights.')
    args.output.mkdir(parents=True, exist_ok=True)
    results = {'data': str(args.data.resolve()), 'seed': args.seed, 'epochs': args.epochs,
               'learning_rate': args.learning_rate,
               'flight_ids': {name: np.unique(ids[mask]).tolist() for name, mask in
                              [('train', train), ('validation', val), ('test', test)]},
               'models': {}}
    for path in MODELS:
        if args.model and path.stem not in args.model:
            continue
        print('\nTraining', path.stem, flush=True)
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        model = module.Controller(learning_rate=args.learning_rate, epochs=args.epochs)
        model.fit(X[train], y[train], X[val], y[val])
        model.save(args.output / (path.stem + '.npz'))
        results['models'][path.stem] = {
            'validation': metrics(model, X[val], y[val]),
            'test': metrics(model, X[test], y[test]),
            'final_training_loss': float(model.train_loss_history[-1]),
            'final_validation_loss': float(model.validation_loss_history[-1])}
        (args.output / 'metrics.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        print('\n', results['models'][path.stem], flush=True)


if __name__ == '__main__':
    main()
