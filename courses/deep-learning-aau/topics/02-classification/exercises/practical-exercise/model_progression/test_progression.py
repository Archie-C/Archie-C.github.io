"""Behavioral checks for the standalone progression and its training split."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

import numpy as np
import train_models

HERE = Path(__file__).resolve().parent


def load(stage):
    path = next(HERE.glob(f'{stage:02d}_*.py'))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Controller


class ProgressionTests(unittest.TestCase):
    @staticmethod
    def data():
        rng = np.random.default_rng(123)
        X = np.zeros((120, 12))
        X[:, 0] = rng.normal(0, 10, len(X))
        X[:, 1] = rng.uniform(200, 400, len(X))
        X[:, 2:4] = rng.uniform(-10, 0, (len(X), 2))
        X[:, 4:6] = rng.uniform(-.05, .05, (len(X), 2))
        X[:, 6] = 5000
        X[:, 7] = 500000
        X[:, 8] = .05
        X[:, 11] = 1.2
        y = np.tile([0, 0, 0, 1, 2], 24)
        return X, y, np.repeat(np.arange(12), 10)

    def test_split_keeps_flights_disjoint(self):
        _, _, ids = self.data()
        masks = train_models.flight_split(ids)
        groups = [set(ids[mask]) for mask in masks]
        self.assertEqual(sum(map(len, groups)), len(set(ids)))
        self.assertTrue(all(not groups[i] & groups[j] for i in range(3) for j in range(i)))
        self.assertTrue(np.all(sum(mask.astype(int) for mask in masks) == 1))

    def test_fit_save_predict_and_normalization_all_stages(self):
        X, y, ids = self.data()
        train, val, _ = train_models.flight_split(ids)
        with tempfile.TemporaryDirectory() as directory:
            for stage in range(1, 8):
                with self.subTest(stage=stage), contextlib.redirect_stdout(io.StringIO()):
                    model = load(stage)(epochs=3)
                    model.fit(X[train], y[train], X[val], y[val])
                    mean, std = model.X_mean_.copy(), model.X_std_.copy()
                    batch = model.predict_proba(X[val])
                    single = np.vstack([model.predict_proba(row[None, :]) for row in X[val]])
                    np.testing.assert_allclose(batch, single, atol=1e-12)
                    np.testing.assert_array_equal(model.X_mean_, mean)
                    np.testing.assert_array_equal(model.X_std_, std)
                    path = Path(directory) / f'{stage}.npz'
                    model.save(path)
                    restored = load(stage)().load(path)
                    np.testing.assert_allclose(restored.predict_proba(X[val]), batch)
                    self.assertEqual(restored.predict_action(X[val][0]), int(restored.predict(X[val][:1])[0]))
                    if stage > 1:
                        with self.assertRaises(ValueError):
                            load(stage-1)().load(path)

    def test_split_variant_and_weighted_loss(self):
        X, y, ids = self.data()
        model = load(2)(epochs=1).fit(X, y, run_ids=ids)
        self.assertFalse(set(model.training_run_ids_) & set(model.validation_run_ids_))
        self.assertEqual(len(model.validation_loss_history), 1)
        weighted = load(3)(epochs=1).fit(X, y)
        self.assertGreater(weighted.class_weights_[1], weighted.class_weights_[0])
        np.testing.assert_allclose(weighted.class_weights_ * np.bincount(y), len(y)/3)

    def test_trajectory_progression(self):
        X = np.zeros((1, 12))
        X[0, 1] = 1000
        X[0, 3] = -10
        X[0, 4] = .02
        X[0, 5] = .01
        X[0, 6] = 5000
        X[0, 7] = 500000
        X[0, 8] = .05
        X[0, 11] = 1.2
        base = load(4)()._basis(X)[0]
        gravity = load(5)()._basis(X)[0]
        drag = load(6)()._basis(X)[0]
        thrust = load(7)()._basis(X)[0]
        np.testing.assert_allclose(base[12:16], [990, -10, .03, .01], atol=1e-12)
        np.testing.assert_allclose(gravity[12:16], [990-9.80665/2, -10-9.80665, .03, .01], atol=1e-12)
        self.assertGreater(drag[12], gravity[12])
        self.assertGreater(thrust[12], drag[12])
        self.assertLess(thrust[14], drag[14])
        empty = X.copy()
        empty[0, 6] = 0
        np.testing.assert_allclose(load(7)()._basis(empty), load(6)()._basis(empty))


if __name__ == '__main__':
    unittest.main()
