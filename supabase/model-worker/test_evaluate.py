import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import tempfile
from unittest import mock

try:
    if sys.version_info < (3, 9):
        raise ImportError('simulator requires Python 3.9+')
    import numpy as np
    spec = importlib.util.spec_from_file_location('evaluate', Path(__file__).with_name('evaluate.py'))
    evaluate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluate)
except ImportError:
    evaluate = None

@unittest.skipIf(evaluate is None, 'requires Python 3.9+ and numpy')
class EvaluationTests(unittest.TestCase):
    def test_simulator_produces_bounded_metrics(self):
        model = mock.Mock()
        model.predict.return_value = evaluate.Command(0, 0)
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(evaluate, 'private_flights', return_value=[]), \
             mock.patch.object(evaluate, 'Model', return_value=model), \
             mock.patch.object(evaluate, 'SCENARIOS', ('near_ground_contact',)), \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused', directory]), \
             mock.patch('sys.stdout', output):
            evaluate.main()
            replay = json.loads((Path(directory) / 'run-0.json').read_bytes())
            self.assertEqual(replay['schema'], 'rocket-run-v1')
            self.assertEqual(replay['config']['scenario'], 'near_ground_contact')
            self.assertTrue(replay['snapshots'])
        metrics = json.loads(output.getvalue())['metrics']
        self.assertTrue(0 <= metrics['score'] <= 100)
        self.assertIn(metrics['landing_success_pct'], (0, 100))
        model.predict.assert_called()
        model.close.assert_called_once()

    def test_private_cases_are_reproducible_balanced_and_validated(self):
        from dataclasses import asdict
        from collections import Counter
        from private_cases import private_flights, test_version
        first = list(private_flights('a' * 64))
        repeat = list(private_flights('a' * 64))
        other = list(private_flights('b' * 64))
        self.assertEqual(len(first), 10)
        self.assertEqual(Counter(c.profile for _, c in first),
                         {p: 2 for p in ('descent', 'mid_flight', 'approach', 'recovery', 'crosswind')})
        self.assertEqual([asdict(c.initial) for _, c in first], [asdict(c.initial) for _, c in repeat])
        self.assertNotEqual([asdict(c.initial) for _, c in first], [asdict(c.initial) for _, c in other])
        self.assertNotEqual(test_version('a' * 64), test_version('b' * 64))
        with self.assertRaises(ValueError):
            list(private_flights(''))

    def test_private_cases_run_with_their_wind_in_real_simulator(self):
        from private_cases import private_flights
        for parameters, case in private_flights('a' * 64):
            result = evaluate.evaluate_closed_loop(lambda obs: evaluate.Command(0, 0),
                case.initial, parameters, case.scenario, max_time=0.1, control_mode='continuous',
                constant_wind=case.constant_wind, wind_profile=case.gusts)
            self.assertNotEqual(result['replay']['status'], 'error')
            self.assertIn('score', result['scoring'])

    def test_all_fourteen_flights_contribute_to_landing_metrics(self):
        model = mock.Mock()
        output = io.StringIO()
        fake_scores = [{'score': n, 'success': n % 2 == 0} for n in range(14)]
        responses = [{'replay': {'status': 'finished'}, 'scoring': score} for score in fake_scores]
        with mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64}), \
             mock.patch.object(evaluate, 'Model', return_value=model), \
             mock.patch.object(evaluate, 'evaluate_closed_loop', side_effect=responses) as run, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused']), \
             mock.patch('sys.stdout', output):
            evaluate.main()
        self.assertEqual(run.call_count, 14)
        metrics = json.loads(output.getvalue())['metrics']
        self.assertEqual(metrics, {'score': 6.5, 'landing_success_pct': 50})

    def test_missing_private_seed_fails_before_loading_model(self):
        output = io.StringIO()
        with mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': ''}), \
             mock.patch.object(evaluate, 'Model') as model, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused']), \
             mock.patch('sys.stdout', output):
            evaluate.main()
        self.assertEqual(json.loads(output.getvalue()), {'error_category': 'infrastructure'})
        model.assert_not_called()

    def test_only_public_flights_are_written_and_all_flights_are_scored(self):
        responses = [{'replay': {'status': 'completed', 'snapshots': [{'time': 1}], 'case': n},
                      'scoring': {'score': n, 'success': n % 2 == 0}} for n in range(14)]
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64}), \
             mock.patch.object(evaluate, 'ModalModel', return_value=mock.Mock()), \
             mock.patch.dict(evaluate.os.environ, {'MODEL_BACKEND': 'modal'}), \
             mock.patch.object(evaluate, 'evaluate_closed_loop', side_effect=responses), \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused', directory]), \
             mock.patch('sys.stdout', output):
            evaluate.main()
            result = json.loads(output.getvalue())
            self.assertEqual(result['metrics'], {'score': 6.5, 'landing_success_pct': 50})
            self.assertEqual(len(result['public_replays']), 4)
            files = sorted(Path(directory).glob('*.json'))
            self.assertEqual(len(files), 4)
            self.assertEqual([json.loads(p.read_bytes())['case'] for p in files], list(range(4)))

    def test_rejects_out_of_range_model_output(self):
        model = evaluate.Model.__new__(evaluate.Model)
        model.process = mock.Mock()
        model.read = mock.Mock(return_value={'output': [[1.1, 0.0]]})
        with self.assertRaises(evaluate.EvaluationError) as caught:
            model.predict(np.zeros(12))
        self.assertEqual(caught.exception.category, 'invalid_shape')

if __name__ == '__main__':
    unittest.main()
