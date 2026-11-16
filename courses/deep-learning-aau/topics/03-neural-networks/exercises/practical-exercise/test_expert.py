"""Numerical-model and continuous-interface checks for the MPC expert."""
import unittest
import csv
import json
from pathlib import Path
import tempfile
from contextlib import redirect_stdout
import io

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import make_observation
from rocket_expert import Controller, main
from rocket_physics import Command, apply_actuators, derivative


class ExpertTests(unittest.TestCase):
    def test_prediction_dynamics_match_the_simulator(self):
        expert = Controller()
        for scenario in ('centred_descent', 'demo_descent', 'crosswind_diagnostics', 'near_ground_contact'):
            p, state = configuration(scenario)
            for throttle, gimbal in ((0., 0.), (.35, -.4), (1., 1.)):
                command = Command(throttle, gimbal)
                applied = apply_actuators(state, command, p)
                expected = np.array(derivative(0, applied, command, p).values())[:7]
                s = np.array(state.values())[:7, None]
                u = np.array([[throttle], [gimbal], [float(throttle > 0)]])
                actual = expert._dynamics(s, u, p.wind(state.y, 0))[:, 0]
                np.testing.assert_allclose(actual, expected, atol=1e-7, rtol=1e-7)

    def test_complex_step_jacobian_matches_finite_differences(self):
        expert = Controller(knots=4)
        p, state = configuration('demo_descent')
        obs = make_observation(state, 0, p)
        z = np.r_[1., 5., np.tile([.7, .02], 4)]
        batch = np.tile(z[:, None], (1, len(z))).astype(complex)
        batch += 1e-20j*np.eye(len(z))
        jac = expert._residual(batch, obs[:7], obs[9:11]).imag/1e-20
        for index in range(len(z)):
            delta = np.zeros_like(z)
            delta[index] = 1e-5
            difference = (expert._residual((z+delta)[:, None], obs[:7], obs[9:11])
                          - expert._residual((z-delta)[:, None], obs[:7], obs[9:11]))[:, 0]/2e-5
            np.testing.assert_allclose(jac[:, index], difference, atol=1e-5, rtol=1e-5)

    def test_controls_are_continuous_and_bounded(self):
        p, state = configuration('near_ground_contact')
        expert = Controller()
        result = expert.predict_action(make_observation(state, 0, p))
        self.assertEqual(len(result), 2)
        self.assertTrue(0 <= result[0] <= 1 and -1 <= result[1] <= 1)

    def test_export_contains_continuous_commands_and_valid_recording(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with redirect_stdout(io.StringIO()):
                result = main(['--scenario', 'near_ground_contact',
                               '--dataset', str(root/'data.csv'), '--report', str(root/'report.json'),
                               '--replays', str(root/'replays')])
            self.assertEqual(result, 0)
            with (root/'data.csv').open(newline='') as file:
                rows = list(csv.DictReader(file))
            self.assertTrue(rows)
            self.assertNotIn('action', rows[0])
            for row in rows:
                self.assertTrue(0 <= float(row['thrust']) <= 1)
                self.assertTrue(-1 <= float(row['gimbal']) <= 1)
            self.assertTrue(any(0 < float(row['thrust']) < 1 for row in rows))
            report = json.loads((root/'report.json').read_text())
            self.assertTrue(report[0]['scoring']['success'])
            replay = json.loads(next((root/'replays').glob('*.json')).read_text())
            self.assertTrue(all(command['action'] is None for command in replay['commands']))
            self.assertEqual(replay['config']['closed_loop']['control_mode'], 'continuous')

    def test_reset_and_invalid_inputs(self):
        expert = Controller()
        for observation in (np.zeros(11), np.full(12, np.nan), np.r_[np.zeros(6), -1, np.zeros(5)]):
            with self.assertRaises(ValueError):
                expert.predict_action(observation)
        expert.burning = True
        expert.reset()
        self.assertIsNone(expert.plan)
        self.assertFalse(expert.burning)


if __name__ == '__main__':
    unittest.main()
