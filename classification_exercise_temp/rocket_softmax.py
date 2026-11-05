"""NumPy-only deterministic multinomial logistic-regression sanity baseline."""
import argparse
import csv
import json

import numpy as np

from rocket_closed_loop import OBSERVATION_NAMES, evaluate_closed_loop
from rocket_calibration import configuration
from rocket_expert_benchmark import feasibility_cases
from rocket_scoring import aggregate

MODEL_VERSION = 'rocket-softmax-v0.1'


def basis(observations, engineered=False):
    x = np.asarray(observations, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(1, -1)
    if x.ndim != 2 or x.shape[1] != 12 or not np.all(np.isfinite(x)):
        raise ValueError('expected finite observations with 12 columns')
    if not engineered:
        return x
    position, height, vx, vy, theta, omega, fuel, thrust, gimbal, wx, wy, rho = x.T
    # Fixed, interpretable interactions; feature scaling is fitted on train only.
    with np.errstate(over='ignore', invalid='ignore'):
        features = np.column_stack((x, position * vx, vx * theta, theta * omega,
                                    vy * np.abs(vy), height * vy, thrust * theta,
                                    thrust * gimbal, (vx-wx)**2, (vy-wy)**2,
                                    fuel * theta, rho * (vy-wy)**2))
    if not np.all(np.isfinite(features)):
        raise ValueError('basis functions produced nonfinite values')
    return features


class SoftmaxPolicy:
    version = MODEL_VERSION

    def __init__(self, engineered=False):
        self.engineered = engineered
        self.mean = self.scale = self.weights = None

    def fit(self, observations, actions, *, iterations=800, learning_rate=.15, l2=.001):
        x = basis(observations, self.engineered)
        y = np.asarray(actions)
        if len(x) == 0 or y.shape != (len(x),) or not np.issubdtype(y.dtype, np.integer) or np.any((y < 0) | (y > 9)):
            raise ValueError('actions must be integers 0–9, one per observation')
        if type(iterations) is not int or iterations < 1 or not np.isfinite(learning_rate) or learning_rate <= 0 or not np.isfinite(l2) or l2 < 0:
            raise ValueError('invalid optimizer settings')
        self.mean = x.mean(axis=0)
        self.scale = x.std(axis=0)
        self.scale[self.scale < 1e-12] = 1.
        x = np.column_stack(((x - self.mean) / self.scale, np.ones(len(x))))
        self.weights = np.zeros((x.shape[1], 10), dtype=np.float64)
        target = np.eye(10)[y]
        for _ in range(iterations):
            logits = x @ self.weights
            logits -= logits.max(axis=1, keepdims=True)
            probabilities = np.exp(logits)
            probabilities /= probabilities.sum(axis=1, keepdims=True)
            gradient = x.T @ (probabilities - target) / len(x)
            gradient[:-1] += l2 * self.weights[:-1]
            self.weights -= learning_rate * gradient
        if not np.all(np.isfinite(self.weights)):
            raise ValueError('nonfinite model weights')
        return self

    def predict_proba(self, observation):
        if self.weights is None:
            raise ValueError('model is not fitted')
        x = (basis(observation, self.engineered) - self.mean) / self.scale
        logits = np.column_stack((x, np.ones(len(x)))) @ self.weights
        if not np.all(np.isfinite(logits)):
            raise ValueError('nonfinite model output')
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        return probabilities[0] if np.asarray(observation).ndim == 1 else probabilities

    def predict_action(self, observation):
        probabilities = self.predict_proba(observation)
        if probabilities.shape != (10,):
            raise ValueError('predict_action requires one observation')
        return int(np.argmax(probabilities))

    @property
    def solver_settings(self):
        return dict(engineered=self.engineered, mean=self.mean.tolist(), scale=self.scale.tolist(),
                    weights=self.weights.tolist()) if self.weights is not None else None


def read_csv(path):
    with open(path, newline='', encoding='utf-8') as source:
        reader = csv.reader(source)
        if next(reader) != [*OBSERVATION_NAMES, 'action']:
            raise ValueError('invalid dataset schema')
        rows = list(reader)
    if not rows:
        raise ValueError('empty dataset')
    return np.array([[float(value) for value in row[:-1]] for row in rows]), np.array([int(row[-1]) for row in rows])


def sanity_check(directory, engineered=False, *, iterations=800, closed_loop=True):
    x, y = read_csv(f'{directory}/train.csv')
    valid_x, valid_y = read_csv(f'{directory}/validation.csv')
    model = SoftmaxPolicy(engineered).fit(x, y, iterations=iterations)
    predictions = np.argmax(model.predict_proba(valid_x), axis=1)
    confusion = np.zeros((10, 10), dtype=int)
    np.add.at(confusion, (valid_y, predictions), 1)
    result = dict(model_version=MODEL_VERSION, basis='engineered' if engineered else 'raw',
                  held_out_agreement=float(np.mean(predictions == valid_y)),
                  confusion=confusion.tolist(), train_class_counts=np.bincount(y, minlength=10).tolist(),
                  validation_class_counts=np.bincount(valid_y, minlength=10).tolist(),
                  model=model.solver_settings)
    if closed_loop:
        runs = []
        # Separate exploratory starts, not a hidden or certified test set.
        for case in feasibility_cases(count=6, seed=42018):
            parameters, _ = configuration(case['scenario'])
            run = evaluate_closed_loop(model.predict_action, case['initial'], parameters, case['scenario'], max_time=20.)
            runs.append(dict(case_id=case['case_id'], scoring=run['scoring'], replay=run['replay']))
        result['closed_loop'] = dict(case_seed=42018, metrics=aggregate([run['scoring'] for run in runs]), runs=runs)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset_directory')
    parser.add_argument('output')
    parser.add_argument('--iterations', type=int, default=800)
    parser.add_argument('--no-closed-loop', action='store_true')
    args = parser.parse_args()
    result = {kind: sanity_check(args.dataset_directory, engineered=(kind == 'engineered'),
                                 iterations=args.iterations, closed_loop=not args.no_closed_loop)
              for kind in ('raw', 'engineered')}
    with open(args.output, 'w', encoding='utf-8') as target:
        json.dump(result, target, allow_nan=False, separators=(',', ':'))
    for kind, data in result.items():
        print(kind, 'held-out agreement:', data['held_out_agreement'],
              'closed-loop:', data.get('closed_loop', {}).get('metrics'))


if __name__ == '__main__':
    main()
