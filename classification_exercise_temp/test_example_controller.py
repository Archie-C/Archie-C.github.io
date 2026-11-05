import unittest
import csv
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import tempfile

import numpy as np

from example_controller import Controller
from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from generate_dataset import COLUMNS
from rocket_closed_loop import make_observation
from run_uploaded_controller import classification_metrics, landing_diagnostics, read_test_runs


class ControllerTests(unittest.TestCase):
    def test_reads_generated_test_run_initial_states(self):
        parameters, state = configuration('centred_descent')
        observation = make_observation(state, 0, parameters).tolist()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test_runs.csv'
            with path.open('w', newline='') as target:
                writer = csv.writer(target)
                writer.writerow(COLUMNS)
                for run_id in range(10):
                    writer.writerow((run_id, 0, *observation, 0, 1))
                    writer.writerow((run_id, 1, *observation, 0, 1))
            cases = read_test_runs(path)
        self.assertEqual([case['run_id'] for case in cases], list(map(str, range(10))))
        for case in cases:
            self.assertEqual(case['scenario'], 'centred_descent')
            self.assertEqual({key: float(case[key]) for key in asdict(state)}, asdict(state))

    def test_reads_saved_test_run_initial_states_and_rejects_duplicates(self):
        _, state = configuration('centred_descent')
        cases = [dict(run_id=str(i), scenario='centred_descent', **asdict(state),
                      wind_x=4.5, wind_y=-1.2) for i in range(10)]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test_runs.csv'
            for duplicate in (False, True):
                if duplicate:
                    cases[-1]['run_id'] = '0'
                with path.open('w', newline='') as target:
                    writer = csv.DictWriter(target, fieldnames=list(cases[0]))
                    writer.writeheader()
                    writer.writerows(cases)
                if duplicate:
                    with self.assertRaisesRegex(ValueError, '10 distinct initial runs'):
                        read_test_runs(path)
                else:
                    loaded = read_test_runs(path)
                    self.assertEqual(len(loaded), 10)
                    self.assertEqual(float(loaded[0]['wind_x']), 4.5)

    def test_generated_test_runs_require_initial_row_for_every_run(self):
        parameters, state = configuration('centred_descent')
        observation = make_observation(state, 0, parameters).tolist()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test_runs.csv'
            with path.open('w', newline='') as target:
                writer = csv.writer(target)
                writer.writerow(COLUMNS)
                for run_id in range(10):
                    writer.writerow((run_id, 1 if run_id == 9 else 0, *observation, 0, 1))
            with self.assertRaisesRegex(ValueError, 'step=0 row for every run'):
                read_test_runs(path)

    def test_classification_metrics_and_training_overlap(self):
        class Policy:
            def predict_action(self, observation):
                return int(observation[0])

        X_test = np.array([[0.], [1.], [1.]])
        metrics = classification_metrics(Policy(), X_test, np.array([0, 0, 1]), np.array([[0.]]))
        self.assertAlmostEqual(metrics['accuracy'], 2 / 3)
        self.assertAlmostEqual(metrics['macro_f1'], 2 / 3)
        self.assertEqual(metrics['overlapping_observations'], 1)
        self.assertEqual(metrics['sample_count'], 3)

    def test_fits_scaled_data_and_preserves_action_labels(self):
        X = np.array([[-10000, 1], [-5000, 1], [5000, 1], [10000, 1]])
        y = np.array([2, 2, 7, 7])
        model = Controller(learning_rate=0.2, epochs=200).fit(X, y)
        np.testing.assert_array_equal(model.predict(X), y)
        self.assertLess(model.loss_history[-1], model.loss_history[0])
        np.testing.assert_allclose(model.predict_proba(X).sum(axis=1), 1)

    def test_bias_learns_class_frequency(self):
        model = Controller(learning_rate=0.2, epochs=200).fit(
            np.zeros((4, 12)), np.array([0, 3, 3, 3]))
        self.assertEqual(model.predict_action(np.zeros(12)), 3)

    def test_nonlinear_interaction_learns_xor(self):
        X = np.array([[-1., -1.], [-1., 1.], [1., -1.], [1., 1.]])
        y = np.array([0, 1, 1, 0])
        model = Controller(learning_rate=0.2, epochs=200).fit(X, y)
        np.testing.assert_array_equal(model.predict(X), y)

    def test_history_features_and_reset_at_flight_boundaries(self):
        X = np.zeros((4, 12))
        X[:, 1] = 400
        X[:, 6] = 9000
        X[:, 3] = [-40, -41, -70, -71]
        model = Controller(epochs=2).fit(X, np.array([0, 1, 0, 1]),
                                         run_ids=[0, 0, 1, 1], steps=[0, 1, 0, 1])
        previous = np.vstack((X[0], X[0], X[2], X[2]))
        basis = model._basis_functions(X, previous)
        np.testing.assert_allclose(basis[:, -4], [0, -10, 0, -10])
        np.testing.assert_allclose(model.basis_mean_, basis.mean(axis=0))
        model.predict_action(X[0])
        model.predict_action(X[1])
        self.assertEqual(len(model.history), 2)
        model.reset()
        self.assertEqual(len(model.history), 0)
        model.predict_action(X[2])
        np.testing.assert_array_equal(model.history[0], X[2])

    def test_classification_resets_policy_between_runs(self):
        class Policy:
            def __init__(self): self.count = 0
            def reset(self): self.count = 0
            def predict_action(self, observation):
                self.count += 1
                return self.count - 1

        X = np.zeros((4, 12))
        metrics = classification_metrics(Policy(), X, np.array([0, 1, 0, 1]), X,
                                         run_ids=[0, 0, 1, 1], steps=[0, 1, 0, 1])
        self.assertEqual(metrics['accuracy'], 1)

    def test_closed_loop_accepts_policy(self):
        model = Controller(epochs=1).fit(np.zeros((1, 12)), np.array([0]))
        parameters, state = configuration('centred_descent')
        result = evaluate_closed_loop(model.predict_action, state, parameters,
                                      'centred_descent', max_time=0.1)
        self.assertEqual(result['decisions'][0]['action'], 0)
        self.assertEqual(result['termination_reason'], 'run time limit')

    def test_closed_loop_uses_and_records_test_wind(self):
        model = Controller(epochs=1).fit(np.zeros((1, 12)), np.array([0]))
        parameters, state = configuration('centred_descent')
        result = evaluate_closed_loop(model.predict_action, state, parameters,
                                      'centred_descent', max_time=0.1,
                                      constant_wind=(4.5, -1.2))
        self.assertEqual(result['decisions'][0]['observation'][9:11], [4.5, -1.2])
        self.assertEqual(result['replay']['config']['environment']['wind'], [4.5, -1.2])
        self.assertEqual(result['replay']['snapshots'][0]['diagnostics']['wind'], (4.5, -1.2))

    def test_diagnostic_score_distinguishes_bad_contacts_and_excludes_timeout(self):
        model = Controller(epochs=1).fit(np.zeros((1, 12)), np.array([0]))
        parameters, state = configuration('centred_descent')
        result = evaluate_closed_loop(model.predict_action, state, parameters,
                                      'centred_descent', max_time=0.1)
        self.assertIsNone(landing_diagnostics(result, parameters)['diagnostic_score'])
        result['replay']['status'] = 'contact'
        result['scoring']['errors'] = {}
        slow = deepcopy(result)
        slow['replay']['snapshots'][-1]['state'].update(vy=-4, vx=0, theta=0, omega=0)
        fast = deepcopy(slow)
        fast['replay']['snapshots'][-1]['state']['vy'] = -8
        slow_score = landing_diagnostics(slow, parameters)['diagnostic_score']
        fast_score = landing_diagnostics(fast, parameters)['diagnostic_score']
        self.assertGreater(slow_score, fast_score)
        self.assertGreater(fast_score, 0)


if __name__ == '__main__':
    unittest.main()
