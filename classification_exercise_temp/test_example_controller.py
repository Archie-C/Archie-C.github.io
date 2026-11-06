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
from run_uploaded_controller import classification_metrics, landing_diagnostics, read_validation_runs


class ControllerTests(unittest.TestCase):
    def test_validation_runs_are_distinct_and_above_ground(self):
        from rocket_physics import clearance
        from rocket_physics import State
        cases = read_validation_runs(Path(__file__).with_name('validation_runs.csv'))
        self.assertEqual(len(cases), 10)
        starts = set()
        for case in cases:
            parameters, _ = configuration(case['scenario'])
            state = State(**{name: float(case[name]) for name in State.__dataclass_fields__})
            self.assertGreater(clearance(state, parameters)[0], 0)
            starts.add((*asdict(state).values(), float(case['wind_x']), float(case['wind_y'])))
        self.assertEqual(len(starts), 10)

    def test_reads_generated_test_run_initial_states(self):
        parameters, state = configuration('centred_descent')
        observation = make_observation(state, 0, parameters).tolist()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'validation_runs.csv'
            with path.open('w', newline='') as target:
                writer = csv.writer(target)
                writer.writerow(COLUMNS)
                for run_id in range(10):
                    writer.writerow((run_id, 0, *observation, 0, 1))
                    writer.writerow((run_id, 1, *observation, 0, 1))
            cases = read_validation_runs(path)
        self.assertEqual([case['run_id'] for case in cases], list(map(str, range(10))))
        for case in cases:
            self.assertEqual(case['scenario'], 'centred_descent')
            self.assertEqual({key: float(case[key]) for key in asdict(state)}, asdict(state))

    def test_reads_saved_test_run_initial_states_and_rejects_duplicates(self):
        _, state = configuration('centred_descent')
        cases = [dict(run_id=str(i), scenario='centred_descent', **asdict(state),
                      wind_x=4.5, wind_y=-1.2) for i in range(10)]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'validation_runs.csv'
            for duplicate in (False, True):
                if duplicate:
                    cases[-1]['run_id'] = '0'
                with path.open('w', newline='') as target:
                    writer = csv.DictWriter(target, fieldnames=list(cases[0]))
                    writer.writeheader()
                    writer.writerows(cases)
                if duplicate:
                    with self.assertRaisesRegex(ValueError, '10 distinct initial runs'):
                        read_validation_runs(path)
                else:
                    loaded = read_validation_runs(path)
                    self.assertEqual(len(loaded), 10)
                    self.assertEqual(float(loaded[0]['wind_x']), 4.5)

    def test_generated_test_runs_require_initial_row_for_every_run(self):
        parameters, state = configuration('centred_descent')
        observation = make_observation(state, 0, parameters).tolist()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'validation_runs.csv'
            with path.open('w', newline='') as target:
                writer = csv.writer(target)
                writer.writerow(COLUMNS)
                for run_id in range(10):
                    writer.writerow((run_id, 1 if run_id == 9 else 0, *observation, 0, 1))
            with self.assertRaisesRegex(ValueError, 'step=0 row for every run'):
                read_validation_runs(path)

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

    def test_saved_model_restores_predictions_and_clears_history(self):
        X = np.zeros((4, 12))
        X[:, 1] = [100, 110, 120, 130]
        X[:, 3] = [-10, -11, -12, -13]
        model = Controller(learning_rate=0.2, epochs=4).fit(X, np.array([2, 7, 2, 7]))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'weights.npz'
            model.save(path)
            restored = Controller()
            restored.history.append(X[0])
            restored.load(path)
        self.assertEqual(len(restored.history), 0)
        np.testing.assert_allclose(restored.predict_proba(X), model.predict_proba(X))
        self.assertEqual(restored.loss_history, model.loss_history)
        self.assertEqual(restored.learning_rate, model.learning_rate)
        self.assertEqual(restored.epochs, model.epochs)
        for observation in X:
            self.assertEqual(restored.predict_action(observation), model.predict_action(observation))

    def test_uploaded_weights_skip_training(self):
        from rocket_server import run_controller
        source = """
class Controller:
    def fit(self, X, y):
        raise AssertionError('fit must not be called')
    def load(self, path):
        with open(path, 'rb') as saved:
            assert saved.read() == b'\\x00model\\xff'
    def predict_action(self, observation):
        return 0
"""
        result = run_controller(source, b'\x00model\xff', 'model.bin')
        self.assertEqual(len(result['runs']), 10)
        self.assertIsNone(result['classification']['overlapping_observations'])

    def test_saved_model_overlap_is_unknown(self):
        class Policy:
            def predict_action(self, observation): return 0
        metrics = classification_metrics(Policy(), np.zeros((1, 12)), np.array([0]), None)
        self.assertIsNone(metrics['overlapping_observations'])

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

    def test_braking_lookahead_uses_current_thrust(self):
        X = np.zeros((2, 12))
        X[:, 1] = 400
        X[:, 3] = -40
        X[:, 6] = 9000
        X[1, 7] = 845000
        model = Controller(epochs=1).fit(X, np.array([0, 1]))
        features = model._basis_functions(X, X)
        # Nine look-ahead columns precede the immediate-response and history features.
        acceleration, delayed_margin = features[:, -28], features[:, -27]
        self.assertGreater(acceleration[1], acceleration[0])
        self.assertLess(delayed_margin[1], delayed_margin[0])

    def test_immediate_thrust_features_follow_fuel_and_throttle(self):
        X = np.zeros((2, 12))
        X[:, 1] = 400
        X[:, 3] = -40
        X[0, 6] = 9000
        model = Controller(epochs=1).fit(X, np.array([0, 1]))
        features = model._basis_functions(X, X)
        accelerations = features[:, -19:-15]
        np.testing.assert_allclose(accelerations[0],
            np.array([0, 482000 + .12 * 363000, 482000 + .55 * 363000, 845000]) / 37000 - 9.80665)
        np.testing.assert_allclose(accelerations[1], -9.80665)
        self.assertGreater(features[0, -11], 0)
        self.assertLess(features[0, -9], 0)

    def test_old_weights_are_rejected_with_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'old.npz'
            np.savez(path, weights=np.zeros((1, 1)))
            with self.assertRaisesRegex(ValueError, 'incompatible feature version'):
                Controller().load(path)

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

    def test_closed_loop_without_time_limit_reaches_late_contact(self):
        parameters, state = configuration('centred_descent')
        result = evaluate_closed_loop(lambda observation: 8, state, parameters,
                                      'centred_descent', max_time=None)
        self.assertEqual(result['replay']['status'], 'contact')
        self.assertGreater(result['replay']['terminal']['time'], 20)
        self.assertEqual(result['termination_reason'], 'first ground contact')
        self.assertIsNone(result['replay']['config']['closed_loop']['max_time'])

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
