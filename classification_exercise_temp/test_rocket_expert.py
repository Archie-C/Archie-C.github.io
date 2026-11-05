import unittest
from dataclasses import replace

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES, evaluate_closed_loop, make_observation
from rocket_physics import discrete_command
from rocket_expert import DiscreteExpert, guidance, simple_discrete_guidance
from unittest.mock import patch


class ClosedLoopTests(unittest.TestCase):
    def setUp(self):
        self.p, self.initial = configuration('near_ground_contact')

    def test_observation(self):
        state = replace(self.initial, x=2, vx=3, thrust=400, gimbal=.01)
        observation = make_observation(state, 0, self.p)
        self.assertEqual(observation.dtype, np.float64)
        self.assertEqual(observation.shape, (12,))
        self.assertEqual(len(OBSERVATION_NAMES), 12)
        np.testing.assert_allclose(observation, [2, 25, 3, -2, 0, 0, 4000, 400, .01, 0, 0, self.p.density(25, 0)])

    def test_actions_and_contact_are_reproducible(self):
        times = []
        def policy(obs):
            times.append(obs[1])
            return 0
        a = evaluate_closed_loop(policy, self.initial, self.p, 'near_ground_contact', max_time=2)
        b = evaluate_closed_loop(policy, self.initial, self.p, 'near_ground_contact', max_time=2)
        self.assertEqual(a, b)
        self.assertTrue(a['replay']['terminal']['type'] == 'contact')
        self.assertEqual([round(d['time'], 6) for d in a['decisions']], [i / 10 for i in range(8)])
        self.assertLess(a['scoring']['contact_time'], .8)

    def test_invalid_action_is_explicit(self):
        result = evaluate_closed_loop(lambda _: 10, self.initial, self.p, 'near_ground_contact', max_time=1)
        self.assertEqual(result['replay']['terminal']['type'], 'error')
        self.assertIn('action', result['termination_reason'])
        self.assertEqual(result['decisions'], [])

    def test_prototype_is_deterministic_and_falls_back(self):
        observation = make_observation(self.initial, 0, self.p)
        expert = DiscreteExpert(horizon_steps=1)
        first = expert.predict_action(observation)
        self.assertEqual(first, expert.predict_action(observation))
        self.assertIn(first, range(10))
        self.assertFalse(expert.diagnostics['fallback'])
        with patch('rocket_expert.step', side_effect=ArithmeticError('injected failure')):
            fallback = expert.predict_action(observation)
        self.assertIn(fallback, range(10))
        self.assertTrue(expert.diagnostics['fallback'])
        self.assertTrue(0 <= guidance(observation).throttle <= 1)

    def test_guidance_centred_touchdowns(self):
        p, initial = configuration('centred_descent')
        for policy, mode in ((guidance, 'continuous'), (simple_discrete_guidance, 'discrete')):
            with self.subTest(mode=mode):
                result = evaluate_closed_loop(policy, initial, p, 'centred_descent',
                                              max_time=20, control_mode=mode)
                self.assertTrue(result['scoring']['success'], result['scoring'])
                self.assertGreater(result['scoring']['score'], 80)
                self.assertEqual(result['replay']['terminal']['type'], 'contact')
                if mode == 'continuous':
                    self.assertTrue(all(d['action'] is None for d in result['decisions']))
                    self.assertTrue(all('throttle' in d['command'] for d in result['decisions']))
                else:
                    self.assertTrue(all(d['action'] in range(10) for d in result['decisions']))

    def test_predictive_expert_centred_touchdown(self):
        p, initial = configuration('centred_descent')
        expert = DiscreteExpert()
        result = evaluate_closed_loop(expert.predict_action, initial, p, 'centred_descent', max_time=20)
        self.assertTrue(result['scoring']['success'], result['scoring'])
        self.assertGreater(result['scoring']['score'], 80)
        self.assertTrue(all(d['action'] in range(10) for d in result['decisions']))
        self.assertFalse(any(d['diagnostics']['fallback'] for d in result['decisions']))
        policy = result['replay']['config']['closed_loop']['policy']
        self.assertEqual(policy['version'], expert.version)
        self.assertEqual(policy['settings']['horizon_steps'], expert.horizon_steps)
        self.assertEqual(len(policy['source_sha256']), 64)

    def test_continuous_mode_rejects_discrete_outputs(self):
        result = evaluate_closed_loop(lambda _: 0, self.initial, self.p, 'near_ground_contact',
                                      max_time=1, control_mode='continuous')
        self.assertEqual(result['replay']['terminal']['type'], 'error')
        self.assertIn('continuous policy', result['termination_reason'])

    def test_action_mapping(self):
        for action in range(10):
            command = discrete_command(action, self.p)
            self.assertEqual(command.throttle, 0 if action == 0 else (.12, .55, 1)[(action-1)//3])
            self.assertEqual(command.gimbal, 0 if action == 0 else (1, 0, -1)[(action-1)%3])


if __name__ == '__main__':
    unittest.main()
