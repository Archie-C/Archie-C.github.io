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
    def test_simulator_produces_bounded_metrics_without_recordings(self):
        model = mock.Mock()
        model.predict_batch.side_effect = lambda observations: [evaluate.Command(0, 0) for _ in observations]
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64, 'MODEL_BACKEND': 'docker'}), \
             mock.patch.object(evaluate, 'Model', return_value=model), \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused', directory]), \
             mock.patch('sys.stdout', output):
            evaluate.main()
            self.assertEqual(list(Path(directory).iterdir()), [])
        result = json.loads(output.getvalue())
        self.assertTrue(0 <= result['metrics']['score'] <= 100)
        self.assertTrue(0 <= result['metrics']['landing_success_pct'] <= 100)
        self.assertEqual(result['public_replays'], [])
        model.predict_batch.assert_called()
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
        self.assertTrue(test_version('a' * 64).startswith('landing-private-10-v4-'))
        self.assertNotEqual(test_version('a' * 64), test_version('b' * 64))
        with self.assertRaises(ValueError):
            list(private_flights(''))

    def test_private_cases_run_with_their_wind_in_real_simulator(self):
        from private_cases import private_flights
        from rocket_closed_loop import evaluate_closed_loop
        for parameters, case in private_flights('a' * 64):
            result = evaluate_closed_loop(lambda obs: evaluate.Command(0, 0),
                case.initial, parameters, case.scenario, max_time=0.1, control_mode='continuous',
                constant_wind=case.constant_wind, wind_profile=case.gusts)
            self.assertNotEqual(result['replay']['status'], 'error')
            self.assertIn('score', result['scoring'])

    def test_only_ten_held_out_flights_contribute_to_landing_metrics(self):
        from dataclasses import asdict
        from rocket_calibration import SCENARIOS, configuration
        from private_cases import private_flights
        flights = list(private_flights('a' * 64))
        public_states = [asdict(configuration(name)[1]) for name in SCENARIOS]
        model = mock.Mock()
        output = io.StringIO()
        fake_scores = [{'score': n, 'success': n % 2 == 0} for n in range(10)]
        responses = [{'status': 'contact', 'scoring': score} for score in fake_scores]
        with mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64, 'MODEL_BACKEND': 'docker'}), \
             mock.patch.object(evaluate, 'Model', return_value=model), \
             mock.patch.object(evaluate, 'evaluate_closed_loop_batch', return_value=responses) as run, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused']), \
             mock.patch('sys.stdout', output):
            evaluate.main()
        run.assert_called_once()
        self.assertIs(run.call_args.kwargs['record'], False)
        for config, (parameters, case) in zip(run.call_args.args[1], flights):
            self.assertEqual(config['initial_state'], case.initial)
            self.assertEqual(config['parameters'], parameters)
            self.assertEqual(config['scenario_id'], case.scenario)
            self.assertEqual(config['constant_wind'], case.constant_wind)
            self.assertEqual(config['wind_profile'], case.gusts)
            self.assertNotIn(asdict(config['initial_state']), public_states)
        metrics = json.loads(output.getvalue())['metrics']
        self.assertEqual(metrics, {'score': 4.5, 'landing_success_pct': 50})
        model.close.assert_called_once()

    def test_missing_private_seed_fails_before_loading_model(self):
        output = io.StringIO()
        with mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': ''}), \
             mock.patch.object(evaluate, 'Model') as model, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused']), \
             mock.patch('sys.stdout', output):
            evaluate.main()
        self.assertEqual(json.loads(output.getvalue()), {'error_category': 'infrastructure'})
        model.assert_not_called()

    def test_modal_scores_only_held_out_flights_without_exposing_replays(self):
        responses = [{'status': 'completed', 'private_case': n,
                      'scoring': {'score': n, 'success': n % 2 == 0}} for n in range(10)]
        output = io.StringIO()
        model = mock.Mock()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(evaluate.os.environ, {'MODEL_PRIVATE_SEED': 'a' * 64, 'MODEL_BACKEND': 'modal'}), \
             mock.patch.object(evaluate, 'ModalModel', return_value=model) as modal, \
             mock.patch.object(evaluate, 'Model') as docker, \
             mock.patch.object(evaluate, 'evaluate_closed_loop_batch', return_value=responses) as run, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused', directory]), \
             mock.patch('sys.stdout', output):
            evaluate.main()
            result = json.loads(output.getvalue())
            self.assertEqual(result['metrics'], {'score': 4.5, 'landing_success_pct': 50})
            self.assertEqual(result['public_replays'], [])
            self.assertEqual(list(Path(directory).iterdir()), [])
        run.assert_called_once()
        self.assertEqual(len(run.call_args.args[1]), 10)
        self.assertIs(run.call_args.kwargs['record'], False)
        self.assertNotIn('private_case', output.getvalue())
        modal.assert_called_once_with('unused', 'unused')
        docker.assert_not_called()
        model.close.assert_called_once()

    def test_empty_private_set_fails_before_loading_model(self):
        output = io.StringIO()
        with mock.patch.object(evaluate, 'private_flights', return_value=[]), \
             mock.patch.object(evaluate, 'Model') as docker, \
             mock.patch.object(evaluate, 'ModalModel') as modal, \
             mock.patch.object(sys, 'argv', ['evaluate.py', 'unused', 'unused']), \
             mock.patch('sys.stdout', output):
            evaluate.main()
        self.assertEqual(json.loads(output.getvalue()), {'error_category': 'infrastructure'})
        docker.assert_not_called()
        modal.assert_not_called()

    def test_batch_and_recording_modes_preserve_flight_outcomes(self):
        from rocket_closed_loop import evaluate_closed_loop, evaluate_closed_loop_batch
        from private_cases import private_flights
        import rocket_runtime
        import rocket_closed_loop
        configs = [dict(initial_state=case.initial, parameters=parameters, scenario_id=case.scenario,
                        constant_wind=case.constant_wind, wind_profile=case.gusts)
                   for parameters, case in private_flights('a' * 64)]
        sequential = [evaluate_closed_loop(lambda obs: evaluate.Command(0, 0),
                                           **config, control_mode='continuous') for config in configs]
        sizes = []
        def policy(observations):
            sizes.append(len(observations))
            return [evaluate.Command(0, 0) for _ in observations]
        with mock.patch.object(rocket_runtime, 'state_packet', side_effect=AssertionError('recording in grading')), \
             mock.patch.object(rocket_closed_loop, 'state_packet', side_effect=AssertionError('recording in grading')), \
             mock.patch.object(rocket_runtime.Run, 'record', side_effect=AssertionError('replay in grading')):
            batched = evaluate_closed_loop_batch(policy, configs, record=False)
        self.assertEqual(sizes[0], 10)
        self.assertLess(sizes[-1], 10)
        self.assertLess(len(sizes), sum(len(result['decisions']) for result in sequential))
        for expected, actual in zip(sequential, batched):
            self.assertEqual(actual['scoring'], expected['scoring'])
            self.assertEqual(actual['termination_reason'], expected['termination_reason'])
            self.assertEqual(actual['status'], expected['status'])
            self.assertIsNone(actual['replay'])
            self.assertEqual(actual['decisions'], [])
        self.assertTrue(sequential[0]['replay']['snapshots'])

    def test_batch_rejects_missing_or_extra_predictions(self):
        from rocket_closed_loop import evaluate_closed_loop_batch
        from rocket_runtime import scenario
        parameters, initial = scenario('demo_descent')
        config = dict(initial_state=initial, parameters=parameters, scenario_id='demo_descent')
        for count in (0, 2):
            with self.subTest(count=count), self.assertRaises(ValueError):
                evaluate_closed_loop_batch(lambda obs: [evaluate.Command(0, 0)] * count, [config])

    def test_batch_response_validates_every_row(self):
        self.assertEqual(len(evaluate.validate_batch_response({'output': [[0.5, 0], [1, -1]]}, 2)), 2)
        for rows in ([[0.5, 0]], [[0.5, 0], [2, 0]], [[0.5, 0], [float('nan'), 0]],
                     [[0.5, 0], [True, 0]], [[0.5, 0], [0.5]]):
            with self.subTest(rows=rows), self.assertRaises(evaluate.EvaluationError):
                evaluate.validate_batch_response({'output': rows}, 2)

    def test_benchmark_version_changes_when_runtime_or_sources_change(self):
        from private_cases import test_version
        version = test_version('a' * 64)
        read_bytes = Path.read_bytes
        def changed(path):
            contents = read_bytes(path)
            return contents + b'changed' if path.name == 'rocket_physics.py' else contents
        with mock.patch.object(Path, 'read_bytes', changed):
            self.assertNotEqual(version, test_version('a' * 64))
        with mock.patch.object(np, '__version__', 'different-runtime'):
            self.assertNotEqual(version, test_version('a' * 64))

    def test_rejects_out_of_range_model_output(self):
        model = evaluate.Model.__new__(evaluate.Model)
        model.process = mock.Mock()
        model.read = mock.Mock(return_value={'output': [[1.1, 0.0]]})
        with self.assertRaises(evaluate.EvaluationError) as caught:
            model.predict(np.zeros(12))
        self.assertEqual(caught.exception.category, 'invalid_shape')

if __name__ == '__main__':
    unittest.main()
