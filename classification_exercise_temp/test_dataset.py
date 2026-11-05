import csv
from dataclasses import replace
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from generate_dataset import COLUMNS, generate_dataset, random_initial_state, run_expert
from rocket_calibration import configuration
from rocket_closed_loop import make_observation
from rocket_expert import ExpertController
from rocket_physics import discrete_command, step


class DatasetTests(unittest.TestCase):
    def test_sampling_is_reproducible(self):
        a, b, c = random.Random(42), random.Random(42), random.Random(43)
        first = [random_initial_state(a) for _ in range(8)]
        second = [random_initial_state(b) for _ in range(8)]
        self.assertEqual([s for s, _ in first], [s for s, _ in second])
        self.assertEqual([p.wind(0, 0) for _, p in first], [p.wind(0, 0) for _, p in second])
        self.assertNotEqual(first[0][0], random_initial_state(c)[0])

    def test_closed_loop_observes_before_action(self):
        p, state = configuration('near_ground_contact')
        decisions, _ = run_expert(state, p, max_time=.2)
        controller = ExpertController()
        first = make_observation(state, 0, p)
        action = controller.predict_action(first)
        self.assertEqual(decisions[0], (first.tolist(), action))
        for i in range(10):
            state, contact = step(i * .01, state, discrete_command(action, p), p, .01)
            self.assertIsNone(contact)
        self.assertEqual(decisions[1][0], make_observation(state, .1, p).tolist())
        self.assertEqual(decisions[1][1], controller.predict_action(make_observation(state, .1, p)))

    def test_csv_has_unique_runs_and_labels_including_failure(self):
        p, state = configuration('near_ground_contact')
        successful = [(list(range(12)), 3), (list(range(12, 24)), 8)]
        failed = [(list(range(24, 36)), 0)]
        with tempfile.TemporaryDirectory() as tmp, patch('generate_dataset.random_initial_state', return_value=(state, p)), \
             patch('generate_dataset.run_expert', side_effect=[(successful, {'success': True}), (failed, {'success': False})]):
            path = Path(tmp) / 'data.csv'
            generate_dataset(2, 7, path)
            with path.open(newline='') as source:
                reader = csv.reader(source)
                self.assertEqual(next(reader), list(COLUMNS))
                rows = list(reader)
        self.assertEqual(rows, [[str(x) for x in (0, 0, *successful[0][0], 3, 1)],
                                [str(x) for x in (0, 1, *successful[1][0], 8, 1)],
                                [str(x) for x in (1, 0, *failed[0][0], 0, 0)]])

    def test_successful_regressions(self):
        cases = []
        for name in ('demo_descent', 'centred_descent'):
            p, initial = configuration(name)
            cases.extend((p, replace(initial, x=initial.x + dx)) for dx in (-3., 0., 3.))
        rng = random.Random(73013)
        for i in range(12):
            p, initial = configuration('centred_descent' if i % 2 == 0 else 'crosswind_diagnostics')
            initial = replace(initial, x=rng.uniform(-8, 8), y=rng.uniform(420, 480),
                              vx=rng.uniform(-1, 1), vy=rng.uniform(-51, -45),
                              theta=rng.uniform(-.015, .015), omega=rng.uniform(-.002, .002),
                              fuel=rng.uniform(8000, 10000), thrust=0., gimbal=0.)
            cases.append((p, initial))
        for i, (p, state) in enumerate(cases):
            with self.subTest(case=i):
                decisions, result = run_expert(state, p)
                self.assertTrue(decisions)
                self.assertTrue(result['success'])


if __name__ == '__main__':
    unittest.main()
