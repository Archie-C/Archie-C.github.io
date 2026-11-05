import json
from pathlib import Path
import unittest
from dataclasses import asdict, replace

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES, evaluate_closed_loop, make_observation
from rocket_physics import Command, discrete_command, step
from rocket_expert import ContinuousReference, DiscreteExpert, SOURCE_SHA256, guidance, simple_discrete_guidance
from rocket_expert_benchmark import (FINAL_SEED, FINAL_SET, FINAL_SUCCESS_TARGET, benchmark,
                                     diagnostic_cases, feasibility_cases, final_feasibility_cases)
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

    def test_observation_tracks_crosswind_and_actual_actuators(self):
        p, state = configuration('crosswind_diagnostics')
        initial_fuel = state.fuel
        for index in range(10):
            state, contact = step(index * p.timestep, state, Command(1., 1.), p, p.timestep)
            self.assertIsNone(contact)
        observation = make_observation(state, p.control_interval, p)
        np.testing.assert_allclose(observation[:9], state.values())
        np.testing.assert_allclose(observation[9:11], p.wind(state.y, p.control_interval))
        self.assertAlmostEqual(observation[11], p.density(state.y, p.control_interval))
        self.assertLess(observation[6], initial_fuel)
        self.assertGreater(observation[7], 0.)
        self.assertLess(observation[7], p.max_thrust)
        self.assertGreater(observation[8], 0.)
        self.assertLess(observation[8], p.gimbal_max)
        self.assertGreater(observation[9], 0.)

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

    def test_benchmark_retains_cases_and_results(self):
        self.assertEqual(len(diagnostic_cases()), 12)
        self.assertEqual(feasibility_cases(), feasibility_cases())
        self.assertEqual(len(feasibility_cases()), 12)
        self.assertNotEqual(feasibility_cases(seed=1)[0]['case_id'], feasibility_cases(seed=2)[0]['case_id'])
        cases = diagnostic_cases()[:1]
        report = benchmark(cases, ['all_off'], max_time=.2)
        result = report['policies']['all_off']
        self.assertEqual(result['metrics']['total_runs'], 1)
        self.assertEqual(result['failure_reasons'], {'no contact': 1})
        self.assertEqual(result['runs'][0]['case_id'], cases[0]['case_id'])
        self.assertIsNone(report['cases'][0]['discrete_expert_safe'])
        self.assertIn('snapshots', result['runs'][0]['replay'])
        self.assertGreaterEqual(result['mean_wall_seconds_per_decision'], 0)

    def test_frozen_final_feasibility_manifest(self):
        path = Path(__file__).parent / 'benchmarks' / 'feasibility-v1.0-manifest.json'
        manifest = json.loads(path.read_text(encoding='utf-8'))
        cases = [dict(case_id=c['case_id'], scenario=c['scenario'], initial=asdict(c['initial']))
                 for c in final_feasibility_cases()]
        self.assertEqual(manifest['cases'], cases)
        self.assertEqual(manifest['scenario_set'], FINAL_SET)
        self.assertEqual(manifest['seed'], FINAL_SEED)
        self.assertEqual(manifest['target_success_rate'], FINAL_SUCCESS_TARGET)
        self.assertEqual(manifest['target_minimum_successes'], 9)

    def test_expert_replay_repeats_identically(self):
        expert = DiscreteExpert(horizon_steps=1)
        first = evaluate_closed_loop(expert.predict_action, self.initial, self.p,
                                     'near_ground_contact', max_time=2)
        second = evaluate_closed_loop(expert.predict_action, self.initial, self.p,
                                      'near_ground_contact', max_time=2)
        self.assertEqual(first['decisions'], second['decisions'])
        self.assertEqual(first['scoring'], second['scoring'])
        self.assertEqual(first['replay'], second['replay'])
        self.assertEqual(first['replay']['terminal']['type'], 'contact')

    def test_continuous_predictive_reference_centred_touchdown(self):
        p, initial = configuration('centred_descent')
        expert = ContinuousReference()
        obs = make_observation(initial, 0, p)
        self.assertEqual(expert.predict_command(obs), expert.predict_command(obs))
        result = evaluate_closed_loop(expert.predict_command, initial, p, 'centred_descent',
                                      max_time=20, control_mode='continuous')
        self.assertTrue(result['scoring']['success'], result['scoring'])
        self.assertGreater(result['scoring']['score'], 80)
        self.assertFalse(any(d['diagnostics']['fallback'] for d in result['decisions']))
        self.assertTrue(all(d['action'] is None for d in result['decisions']))

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
        self.assertEqual(policy['source_sha256'], SOURCE_SHA256)

    def test_predictive_expert_crosswind_touchdown(self):
        case = feasibility_cases()[3]
        p, _ = configuration(case['scenario'])
        expert = DiscreteExpert()
        result = evaluate_closed_loop(expert.predict_action, case['initial'], p, case['scenario'], max_time=20)
        self.assertTrue(result['scoring']['success'], result['scoring'])
        self.assertGreater(result['scoring']['score'], 80)
        self.assertTrue(any(d['action'] in (1, 3, 4, 6, 7, 9) for d in result['decisions']))

    def test_continuous_mode_rejects_discrete_outputs(self):
        result = evaluate_closed_loop(lambda _: 0, self.initial, self.p, 'near_ground_contact',
                                      max_time=1, control_mode='continuous')
        self.assertEqual(result['replay']['terminal']['type'], 'error')
        self.assertIn('continuous policy', result['termination_reason'])

    def test_continuous_reference_fallback_is_explicit(self):
        observation = make_observation(self.initial, 0, self.p)
        reference = ContinuousReference(horizon_steps=1)
        with patch('rocket_expert.step', side_effect=ArithmeticError('injected failure')):
            fallback = reference.predict_command(observation)
        self.assertEqual(fallback, guidance(observation))
        self.assertTrue(reference.diagnostics['fallback'])
        self.assertIn('injected failure', reference.diagnostics['reason'])

    def test_timeout_and_unexpected_solver_failures_use_fallback(self):
        observation = make_observation(self.initial, 0, self.p)
        for failure in (TimeoutError('budget exceeded'), RuntimeError('solver failed')):
            with self.subTest(failure=type(failure).__name__):
                discrete = DiscreteExpert(horizon_steps=1)
                reference = ContinuousReference(horizon_steps=1)
                with patch('rocket_expert.step', side_effect=failure):
                    first = discrete.predict_action(observation)
                    self.assertEqual(first, discrete.predict_action(observation))
                    self.assertEqual(reference.predict_command(observation), guidance(observation))
                self.assertIn(first, range(10))
                self.assertTrue(discrete.diagnostics['fallback'])
                self.assertIn(type(failure).__name__, discrete.diagnostics['reason'])
                self.assertTrue(reference.diagnostics['fallback'])
                self.assertIn(type(failure).__name__, reference.diagnostics['reason'])

    def test_timeout_is_recorded_in_benchmark_fallback_metrics(self):
        case = dict(case_id='timeout-case', scenario='near_ground_contact', initial=self.initial)
        with patch('rocket_expert.step', side_effect=TimeoutError('budget exceeded')):
            report = benchmark([case], ['discrete_expert'], max_time=.1)
        result = report['policies']['discrete_expert']
        self.assertEqual(result['fallback_count'], 1)
        self.assertEqual(result['fallback_frequency'], 1.)
        decision = result['runs'][0]['replay']['decisions'][0]
        self.assertTrue(decision['diagnostics']['fallback'])
        self.assertIn('TimeoutError', decision['diagnostics']['reason'])

    def test_action_mapping(self):
        for action in range(10):
            command = discrete_command(action, self.p)
            self.assertEqual(command.throttle, 0 if action == 0 else (.12, .55, 1)[(action-1)//3])
            self.assertEqual(command.gimbal, 0 if action == 0 else (1, 0, -1)[(action-1)%3])


if __name__ == '__main__':
    unittest.main()
