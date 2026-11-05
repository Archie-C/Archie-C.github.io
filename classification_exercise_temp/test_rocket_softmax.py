import unittest
import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop, make_observation
from rocket_softmax import SoftmaxPolicy


class SoftmaxTests(unittest.TestCase):
    def test_raw_and_engineered_predictions_and_runner(self):
        p, s = configuration('near_ground_contact')
        centre = make_observation(s, 0, p)
        observations = np.tile(centre, (40, 1))
        observations[:20, 0] = -10
        observations[20:, 0] = 10
        actions = np.array([0] * 20 + [8] * 20)
        for engineered in (False, True):
            with self.subTest(engineered=engineered):
                model = SoftmaxPolicy(engineered).fit(observations, actions, iterations=200)
                probabilities = model.predict_proba(observations)
                self.assertTrue(np.all(np.isfinite(probabilities)))
                np.testing.assert_allclose(probabilities.sum(axis=1), 1)
                self.assertTrue(np.array_equal(np.argmax(probabilities, axis=1), actions))
                self.assertEqual(model.predict_action(observations[0]), 0)
                result = evaluate_closed_loop(model.predict_action, s, p, 'near_ground_contact', max_time=.2)
                self.assertEqual(len(result['decisions']), 2)
                self.assertIn(result['decisions'][0]['action'], range(10))

    def test_invalid_labels_are_rejected(self):
        with self.assertRaises(ValueError):
            SoftmaxPolicy().fit(np.zeros((1, 12)), np.array([10]))


if __name__ == '__main__':
    unittest.main()
