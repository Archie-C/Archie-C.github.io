"""Tune and train the standalone controllers on the shared flight-level split (no simulations).

Uses the same split, hyperparameter grids and selection rule as example.ipynb and
tune_and_evaluate.py (see experiment.py), and reports validation and held-out test metrics.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from experiment import HERE, SEED, flight_split, grid_search, load_data, load_stage, metrics, stage_paths

MODELS = stage_paths()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=HERE.parent / 'landings.csv')
    parser.add_argument('--output', type=Path, default=HERE / 'results')
    parser.add_argument('--model', choices=[p.stem for p in MODELS], action='append',
                        help='Select a model; repeat to select several (default: all).')
    parser.add_argument('--seed', type=int, default=SEED)
    args = parser.parse_args()
    ids, X, y = load_data(args.data)
    train, val, test = flight_split(ids, args.seed)
    if not np.isin(y[val], y[train]).all():
        raise ValueError('Validation includes classes absent from training; choose another split seed or add flights.')
    args.output.mkdir(parents=True, exist_ok=True)
    results = {'data': str(args.data.resolve()), 'seed': args.seed,
               'flight_ids': {name: np.unique(ids[mask]).tolist() for name, mask in
                              [('train', train), ('validation', val), ('test', test)]},
               'models': {}}
    for path in MODELS:
        if args.model and path.stem not in args.model:
            continue
        print('\nTraining', path.stem, flush=True)
        search = grid_search(load_stage(path.stem), X[train], y[train], X[val], y[val])
        model = search['best_model']
        model.save(args.output / (path.stem + '.npz'))
        results['models'][path.stem] = {
            'selection': search['best'], 'candidates': search['rows'],
            'validation': metrics(model, X[val], y[val]),
            'test': metrics(model, X[test], y[test])}
        (args.output / 'metrics.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(results['models'][path.stem]['validation'], flush=True)


if __name__ == '__main__':
    main()
