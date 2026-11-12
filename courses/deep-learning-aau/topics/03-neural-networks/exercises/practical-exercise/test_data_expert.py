"""Regression checks for MPC labels on short and perturbed approaches."""
import unittest

import numpy as np

from rocket_closed_loop import evaluate_closed_loop, make_observation
from rocket_data_expert import DatasetExpert
from rocket_sampling import sample_mixed_case


class DataExpertTests(unittest.TestCase):
    def test_unwanted_climb_reopens_engine_off_phase(self):
        p, case = sample_mixed_case(42, 2)
        obs = make_observation(case.initial, 0, p)
        obs[3] = .2
        expert = DatasetExpert()
        expert.burning = True
        expert.plan = np.ones(18)
        self.assertEqual(expert.predict_action(obs), (0., 0.))
        self.assertIsNone(expert.plan)
        self.assertFalse(expert.burning)

    def test_landing_goal_uses_current_state_instead_of_a_hidden_initial_goal(self):
        p, case = sample_mixed_case(42, 2)
        obs = make_observation(case.initial, 0, p)
        obs[3] = .1  # Inspect goal selection without an unnecessary solve.
        expert = DatasetExpert()
        expert.predict_action(obs)
        original = expert.landing_x
        obs[0] += 2.
        expert.predict_action(obs)
        self.assertAlmostEqual(expert.landing_x-original, 2.)
        expert.reset()
        self.assertIsNone(expert.landing_x)

    def test_short_approach_that_previously_climbed_away_lands(self):
        p, case = sample_mixed_case(42, 2)
        expert = DatasetExpert()
        result = evaluate_closed_loop(expert.command, case.initial, p, case.scenario,
                                      max_time=10., control_mode='continuous',
                                      constant_wind=case.constant_wind, wind_profile=case.gusts)
        self.assertTrue(result['scoring']['success'], result['scoring']['reasons'])
        self.assertGreater(result['scoring']['score'], 85.)


if __name__ == '__main__':
    unittest.main()
