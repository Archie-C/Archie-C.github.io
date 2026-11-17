"""Classifier checks using instantaneous physics and offline observations only."""
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from dataclasses import replace

import numpy as np

from mymodel import Controller, MIRROR_ACTIONS
from rocket_calibration import configuration
from rocket_physics import Command, State, derivative


class ClassifierTests(unittest.TestCase):
    @staticmethod
    def observations(n=80):
        rng = np.random.default_rng(7)
        X = np.zeros((n, 12))
        X[:, 0] = rng.uniform(-40, 40, n)
        X[:, 1] = rng.uniform(20, 600, n)
        X[:, 2] = rng.uniform(-8, 8, n)
        X[:, 3] = rng.uniform(-80, 2, n)
        X[:, 4:6] = rng.uniform(-.1, .1, (n, 2))
        X[:, 6] = rng.uniform(1000, 12000, n)
        X[:, 7] = rng.uniform(0, 845000, n)
        X[:, 8] = rng.uniform(-.08, .08, n)
        X[:, 9:11] = rng.uniform(-5, 5, (n, 2))
        X[:, 11] = 1.225 * np.exp(-X[:, 1] / 8500)
        return X

    def test_accelerations_match_calibrated_derivative(self):
        p, _ = configuration()
        X = self.observations(12)
        calculated = np.column_stack(Controller._accelerations(X))
        expected = []
        for row in X:
            params = replace(p, wind=lambda y, t, row=row: tuple(row[9:11]))
            result = derivative(0, State(*row[:9]), Command(0, 0), params)
            expected.append([result.vx, result.vy, result.omega])
        np.testing.assert_allclose(calculated, expected, rtol=1e-12, atol=1e-12)

    def test_geometry_and_edge_features(self):
        X = np.zeros((4, 12))
        X[:, 1] = 25
        X[:, 4] = [0, np.pi, np.pi / 2, 0]
        c = Controller()
        features, descriptor, names = c._physics_features(X)
        self.assertTrue(np.isfinite(features).all())
        self.assertTrue(np.isfinite(descriptor).all())
        self.assertEqual(features.shape[1], len(names))
        self.assertAlmostEqual(c.ground_clearance(X)[0], 2)

    def test_training_symmetry_batch_and_round_trip(self):
        X = self.observations()
        # All demonstrations are selected from these training observations.
        y = np.where(X[:, 3] < -40, 8, 2)
        sample_weight = np.where(X[:, 3] < -60, 2., 1.)
        c = Controller(epochs=20, n_centres=20, patience=5)
        with contextlib.redirect_stdout(io.StringIO()):
            c.fit(X[:60], y[:60], X[60:], y[60:], sample_weight=sample_weight[:60])
        self.assertLess(c.train_loss_history[-1], c.train_loss_history[0])
        np.testing.assert_array_equal(c.predict(X), [c.predict_action(row) for row in X])
        np.testing.assert_allclose(c.predict_proba(X), c.predict_proba(c.mirror_observations(X))[:, MIRROR_ACTIONS], atol=1e-6)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.npz"
            c.save(path)
            restored = Controller().load(path)
            np.testing.assert_allclose(c.predict_proba(X), restored.predict_proba(X))
            self.assertEqual(restored.feature_names_, c.feature_names_)
        fuel_empty = X[:1].copy()
        fuel_empty[:, 6] = 0
        self.assertEqual(c.predict_action(fuel_empty[0]), 0)

    def test_training_statistics_are_unchanged_by_prediction(self):
        X = self.observations()
        c = Controller(epochs=2, basis="physics")
        with contextlib.redirect_stdout(io.StringIO()):
            c.fit(X, np.arange(len(X)) % 10)
        mean, std = c.X_mean_.copy(), c.X_std_.copy()
        c.predict_proba(X[:1] * 2)
        np.testing.assert_array_equal(c.X_mean_, mean)
        np.testing.assert_array_equal(c.X_std_, std)

    def test_invalid_inputs_and_weights(self):
        X = self.observations()
        for bad in (np.zeros(len(X)), np.full(len(X), np.nan), np.ones(len(X)-1)):
            with self.assertRaises(ValueError):
                Controller().fit(X, np.arange(len(X)) % 10, sample_weight=bad)
        with self.assertRaises(ValueError):
            Controller().fit(X, np.full(len(X), 10))
        with self.assertRaises(ValueError):
            Controller._observations(np.zeros((1, 11)))


if __name__ == "__main__":
    unittest.main()
