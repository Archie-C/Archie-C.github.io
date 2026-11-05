import json
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop, make_observation
from rocket_expert import ExpertController
from rocket_expert_evaluate import evaluate, regression_cases, sample_cases
from rocket_expert_versions import load_expert


class ExpertSimplificationTests(unittest.TestCase):
    def test_sampler_is_seeded_and_covers_tiers_and_profiles(self):
        a = sample_cases(964731, 4)
        self.assertEqual(a, sample_cases(964731, 4))
        self.assertNotEqual(a, sample_cases(964732, 4))
        self.assertEqual({c['tier'] for c in a}, {'nominal', 'challenging', 'extreme'})
        self.assertEqual({c['scenario'] for c in a}, {'centred_descent', 'crosswind_diagnostics'})
        self.assertEqual(len(regression_cases()), 24)

    def test_observation_validation_and_reset(self):
        p, s = configuration('near_ground_contact')
        expert = ExpertController(horizon_steps=1, control_interval=.05)
        with self.assertRaises(ValueError):
            expert.predict_action(np.full(12, float('nan')))
        action = expert.predict_action(make_observation(s, 0, p))
        self.assertIn(action, range(10))
        expert.reset()
        self.assertIsNone(expert.previous_action)
        self.assertEqual(expert.diagnostics, {})
        self.assertEqual(action, expert.predict_action(make_observation(s, 0, p)))

    def test_timing_replay_and_determinism(self):
        p, s = configuration('near_ground_contact')
        p = replace(p, control_interval=.05)
        expert = ExpertController(horizon_steps=1, control_interval=.05)
        a = evaluate_closed_loop(expert.predict_action, s, p, 'near_ground_contact', max_time=.2)
        b = evaluate_closed_loop(expert.predict_action, s, p, 'near_ground_contact', max_time=.2)
        self.assertEqual(a, b)
        self.assertEqual(a['replay']['config']['parameters']['control_interval'], .05)
        self.assertEqual([round(d['time'], 2) for d in a['decisions']], [0, .05, .1, .15])
        self.assertTrue(all(d['action'] in range(10) for d in a['decisions']))
        bad = evaluate_closed_loop(lambda _: 10, s, p, 'near_ground_contact', max_time=.2)
        self.assertEqual(bad['replay']['status'], 'error')

    def test_evaluation_writes_failed_replay_and_metrics(self):
        _, s = configuration('near_ground_contact')
        case = dict(case_id='test', tier='test', scenario='near_ground_contact', initial=s)
        with tempfile.TemporaryDirectory() as tmp:
            report = evaluate([case], [.1], tmp, max_time=.1)[0]
            self.assertEqual(report['overall']['total_runs'], 1)
            self.assertIsNone(report['overall']['mean_successful_quality'])
            replay = json.loads((Path(tmp) / report['runs'][0]['replay']).read_text())
            self.assertEqual(replay['schema'], 'rocket-run-v1')
            self.assertEqual(replay['terminal']['reason'], 'run time limit')

    def test_historical_expert_loads_by_hash(self):
        import hashlib
        path = Path(__file__).parent / 'versions/expert-prototype-v0.5/rocket_expert.py'
        module = load_expert('expert-prototype-v0.5', hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertTrue(hasattr(module, 'DiscreteExpert'))


if __name__ == '__main__':
    unittest.main()
