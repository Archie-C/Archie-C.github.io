import csv
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES, evaluate_closed_loop, make_observation
from rocket_physics import State
from rocket_softmax import SoftmaxPolicy, sanity_check
from rocket_expert_benchmark import feasibility_cases


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
                restored = SoftmaxPolicy.from_settings(model.solver_settings)
                np.testing.assert_array_equal(restored.predict_proba(observations), probabilities)
                result = evaluate_closed_loop(model.predict_action, s, p, 'near_ground_contact', max_time=.2)
                self.assertEqual(len(result['decisions']), 2)
                self.assertIn(result['decisions'][0]['action'], range(10))

    def test_overlapping_exploratory_start_is_rejected(self):
        case = feasibility_cases(count=6, seed=42018)[0]
        p, _ = configuration(case['scenario'])
        obs = make_observation(case['initial'], 0, p)
        with tempfile.TemporaryDirectory() as tmp:
            for split in ('train', 'validation'):
                with (Path(tmp) / f'{split}.csv').open('w', newline='', encoding='utf-8') as target:
                    writer = csv.writer(target)
                    writer.writerow([*OBSERVATION_NAMES, 'action'])
                    writer.writerow([*obs, 0])
            with self.assertRaisesRegex(ValueError, 'overlap'):
                sanity_check(tmp, iterations=1)

    def test_recorded_models_reproduce_closed_loop_replays(self):
        for version in ('v1.0', 'v1.1'):
            archive = Path(__file__).parent / 'benchmarks' / f'classifier-{version}-full-report.json.gz'
            with gzip.open(archive, 'rt', encoding='utf-8') as source:
                report = json.load(source)
            for name in ('raw', 'engineered'):
                with self.subTest(dataset=version, basis=name):
                    result = report[name]
                    recorded = result['closed_loop']['runs'][0]['replay']
                    config = recorded['config']
                    archived_source = Path(__file__).parent / 'versions' / 'rocket-softmax-v0.2' / 'rocket_softmax.py'
                    self.assertEqual(hashlib.sha256(archived_source.read_bytes()).hexdigest(),
                                     config['closed_loop']['policy']['source_sha256'])
                    p, _ = configuration(config['scenario'])
                    model = SoftmaxPolicy.from_settings(result['model'])
                    reproduced = evaluate_closed_loop(model.predict_action, State(**config['initial_state']),
                                                       p, config['scenario'], max_time=20.)['replay']
                    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
                    self.assertEqual(canonical(reproduced), canonical(recorded))

    def test_invalid_labels_are_rejected(self):
        with self.assertRaises(ValueError):
            SoftmaxPolicy().fit(np.zeros((1, 12)), np.array([10]))


if __name__ == '__main__':
    unittest.main()
