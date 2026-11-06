"""Regression checks for the browser evaluator's CSV and overlap handling."""
import csv
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run_uploaded_controller as evaluation

import numpy as np

from run_uploaded_controller import (OBSERVATION_COLUMNS, test_predictions,
                                     read_observations, read_test_observations, read_sequence_metadata,
                                     read_validation_runs, main)


class DataLoadingTests(unittest.TestCase):
    def test_columns_and_sequence_metadata_follow_the_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.csv'
            columns = ['run_id', 'step', 'action', *reversed(OBSERVATION_COLUMNS)]
            with path.open('w', newline='', encoding='utf-8') as file:
                writer = csv.DictWriter(file, fieldnames=columns)
                writer.writeheader()
                for index in range(2):
                    writer.writerow({'run_id': 'run-a', 'step': index, 'action': 3 + index,
                                     **{name: index * 100 + n for n, name in enumerate(OBSERVATION_COLUMNS)}})
            observations, actions = read_observations(path)
            ids, steps = read_sequence_metadata(path)
        np.testing.assert_array_equal(observations, [list(range(12)), list(range(100, 112))])
        np.testing.assert_array_equal(actions, [3, 4])
        np.testing.assert_array_equal(ids, ['run-a', 'run-a'])
        np.testing.assert_array_equal(steps, [0, 1])

    def test_prediction_resets_at_sequence_boundaries(self):
        class Policy:
            def reset(self):
                self.count = 0
            def predict_action(self, observation):
                self.count += 1
                return self.count
        result = test_predictions(Policy(), np.zeros((5, 12)), None,
                                  np.array(['a', 'a', 'b', 'b', 'b']),
                                  np.array([0, 1, 0, 2, 3]))
        self.assertEqual(result['predictions'], [1, 2, 1, 1, 2])
        self.assertIsNone(result['overlapping_observations'])

    def test_public_test_file_does_not_require_labels(self):
        path = Path(__file__).with_name('X_test.csv')
        with path.open(newline='', encoding='utf-8') as file:
            columns = next(csv.reader(file))
        self.assertNotIn('action', columns)
        self.assertNotIn('success', columns)
        self.assertEqual(read_test_observations(path).shape[1], 12)

    def test_test_flights_use_test_starts_not_validation_starts(self):
        directory = Path(__file__).parent
        test_cases = read_validation_runs(directory / 'X_test.csv')
        validation_cases = read_validation_runs(directory / 'validation_runs.csv')
        self.assertEqual(len(test_cases), 10)
        self.assertEqual(len(validation_cases), 10)
        self.assertNotEqual(float(test_cases[0]['x']), float(validation_cases[0]['x']))
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'controller.py'
            source.write_text("class Controller:\n def load(self, path): pass\n def predict_action(self, observation): return 0\n")
            with patch.object(evaluation, 'evaluate_closed_loop', wraps=evaluation.evaluate_closed_loop) as simulated:
                result = main(str(source), str(Path(temp) / 'weights'))
        self.assertEqual(simulated.call_count, 20)
        for case, call in zip(validation_cases + test_cases, simulated.call_args_list):
            initial = call.args[1]
            self.assertEqual(initial.x, float(case['x']))
            self.assertEqual(initial.y, float(case['y']))
            self.assertEqual(call.kwargs['constant_wind'],
                             (float(case['wind_x']), float(case['wind_y'])))
        self.assertEqual(result['test']['summary']['total_runs'], 10)
        self.assertEqual(set(result['test']), {'summary'})
        self.assertEqual(result['validation']['summary']['total_runs'], 10)
        self.assertEqual(len(result['validation']['runs']), 10)
        self.assertEqual(len(result['validation']['replays']), 10)
        self.assertTrue(all(replay is not None for replay in result['validation']['expert_replays']))

    def test_overlap_counts_each_test_row_once_including_duplicates(self):
        class Controller:
            def predict_action(self, observation):
                return 0
        train = np.array([[1., 2.], [1., 2.], [9., 10.]])
        test = np.array([[1., 2.], [1., 2.], [3., 4.]])
        result = test_predictions(Controller(), test, train)
        self.assertEqual(result['overlapping_observations'], 2)


if __name__ == '__main__':
    unittest.main()
