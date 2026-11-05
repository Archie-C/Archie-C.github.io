from dataclasses import replace
import unittest

from rocket_calibration import configuration
from rocket_closed_loop import make_observation
from rocket_observation_scope import envelope_violations


class ObservationScopeTests(unittest.TestCase):
    def test_reports_angle_excursion_without_clamping(self):
        p, state = configuration('centred_descent')
        normal = make_observation(state, 0., p)
        self.assertEqual(envelope_violations(normal, 0., p), [])
        upward = make_observation(replace(state, vy=5.), 0., p)
        self.assertEqual(envelope_violations(upward, 0., p), ['angle of attack'])
        self.assertEqual(upward[3], 5.)

    def test_rejects_invalid_physics_and_atmosphere(self):
        p, state = configuration('crosswind_diagnostics')
        observation = make_observation(state, 0., p)
        bad_fuel = observation.copy()
        bad_fuel[6] = -1.
        with self.assertRaisesRegex(ValueError, 'fuel'):
            envelope_violations(bad_fuel, 0., p)
        bad_wind = observation.copy()
        bad_wind[9] += 1.
        with self.assertRaisesRegex(ValueError, 'atmosphere'):
            envelope_violations(bad_wind, 0., p)


if __name__ == '__main__':
    unittest.main()
