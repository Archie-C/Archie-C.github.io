"""Focused checks for low-altitude attitude recovery guidance."""
from dataclasses import replace
import random
import unittest

from generate_dataset import random_initial_state, run_expert
from rocket_calibration import configuration
from rocket_closed_loop import make_observation
from rocket_expert import guidance


class GuidanceTests(unittest.TestCase):
    def test_engine_enables_attitude_control_near_ground(self):
        p, state = configuration('centred_descent')
        state = replace(state, y=60., vy=0., theta=.15, omega=0.)
        command = guidance(make_observation(state, 0., p))
        self.assertEqual(command.throttle, p.throttle_levels[0])
        self.assertGreater(command.gimbal, 0.)

    def test_engine_stays_off_if_no_attitude_correction_is_needed(self):
        p, state = configuration('centred_descent')
        state = replace(state, y=60., vy=0.)
        self.assertEqual(guidance(make_observation(state, 0., p)).throttle, 0.)

    def test_recovery_does_not_command_thrust_without_fuel(self):
        p, state = configuration('centred_descent')
        state = replace(state, y=60., vy=0., theta=.15, fuel=0.)
        self.assertEqual(guidance(make_observation(state, 0., p)).throttle, 0.)

    def test_recovers_lateral_motion_on_challenging_starts(self):
        rng = random.Random(42001)
        for index in range(22):
            state, p = random_initial_state(rng)
            if index in (0, 21):
                with self.subTest(index=index):
                    _, result = run_expert(state, p)
                    self.assertTrue(result['success'], result['reasons'])


if __name__ == '__main__':
    unittest.main()
