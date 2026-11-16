import importlib.util
import sys
import types
import unittest
from unittest import mock
from pathlib import Path


class ModalTests(unittest.TestCase):
    def setUp(self):
        modules = {
            'rocket_closed_loop': types.SimpleNamespace(evaluate_closed_loop=None),
            'rocket_runtime': types.SimpleNamespace(scenario=None),
            'rocket_physics': types.SimpleNamespace(Command=lambda a, b: (a, b)),
        }
        self.patch = mock.patch.dict(sys.modules, modules)
        self.patch.start()
        spec = importlib.util.spec_from_file_location('modal_evaluate_test', Path(__file__).with_name('evaluate.py'))
        self.evaluate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.evaluate)

    def tearDown(self):
        self.patch.stop()

    def test_sandbox_is_isolated_and_terminated(self):
        process = mock.Mock()
        process.stdout = iter([b'{"ready":true}\n', b'{"output":[[0.5,0.1]]}\n'])
        sandbox = mock.Mock()
        sandbox.exec.return_value = process
        modal = types.ModuleType('modal')
        modal.App = mock.Mock()
        modal.Sandbox = mock.Mock()
        modal.Sandbox.create.return_value = sandbox
        stream_type = types.ModuleType('modal.stream_type')
        stream_type.StreamType = types.SimpleNamespace(DEVNULL='discard')
        app = types.ModuleType('modal_app')
        app.sandbox_image = object()
        with mock.patch.dict(sys.modules, {'modal': modal, 'modal.stream_type': stream_type, 'modal_app': app}):
            model = self.evaluate.ModalModel('artifacts', 'job-name')
            self.assertEqual(model.predict(mock.Mock(tolist=lambda: [0] * 12)), (0.5, 0.1))
            model.close()
        kwargs = modal.Sandbox.create.call_args.kwargs
        self.assertTrue(kwargs['block_network'])
        self.assertNotIn('secrets', kwargs)
        self.assertEqual(sandbox.filesystem.copy_from_local.call_count, 2)
        process.stdin.drain.assert_called_once()
        sandbox.terminate.assert_called_once()

    def test_authenticated_notification_spawns_consumer_without_schedule(self):
        modal = types.ModuleType('modal')
        image = mock.Mock()
        image.pip_install.return_value = image
        image.run_commands.return_value = image
        image.add_local_file.return_value = image
        modal.Image = mock.Mock()
        modal.Image.debian_slim.return_value = image
        modal.Secret = mock.Mock()
        modal.fastapi_endpoint = mock.Mock(side_effect=lambda **kwargs: lambda function: function)
        app = mock.Mock()
        registered = []
        def register(**kwargs):
            def decorate(function):
                registered.append((function.__name__, kwargs))
                function.spawn = mock.Mock()
                return function
            return decorate
        app.function.side_effect = register
        modal.App = mock.Mock(return_value=app)
        spec = importlib.util.spec_from_file_location('modal_app_test', Path(__file__).with_name('modal_app.py'))
        module = importlib.util.module_from_spec(spec)
        with mock.patch.dict(sys.modules, {'modal': modal}):
            spec.loader.exec_module(module)
            self.assertEqual(module.notify_queued(), {'accepted': True})
        module.consume_queue.spawn.assert_called_once_with()
        for call in image.add_local_file.call_args_list:
            self.assertTrue(call.args[1].startswith('/'), call.args[1])
            self.assertNotIn('\\', call.args[1])
        self.assertNotIn('schedule', dict(registered)['consume_queue'])
        modal.fastapi_endpoint.assert_called_once_with(method='POST', requires_proxy_auth=True)
        self.assertEqual(dict(registered)['consume_queue']['max_containers'], 1)

    def test_invalid_output_is_rejected(self):
        with self.assertRaises(self.evaluate.EvaluationError) as error:
            self.evaluate.validate_response({'output': [[2, 0]]})
        self.assertEqual(error.exception.category, 'invalid_shape')

    def test_sandbox_is_terminated_when_setup_fails(self):
        sandbox = mock.Mock()
        sandbox.filesystem.copy_from_local.side_effect = OSError('failed')
        modal = types.ModuleType('modal')
        modal.App = mock.Mock()
        modal.Sandbox = mock.Mock()
        modal.Sandbox.create.return_value = sandbox
        stream_type = types.ModuleType('modal.stream_type')
        stream_type.StreamType = types.SimpleNamespace(DEVNULL='discard')
        app = types.ModuleType('modal_app')
        app.sandbox_image = object()
        with mock.patch.dict(sys.modules, {'modal': modal, 'modal.stream_type': stream_type, 'modal_app': app}):
            with self.assertRaises(OSError):
                self.evaluate.ModalModel('artifacts', 'job-name')
        sandbox.terminate.assert_called_once()

if __name__ == '__main__':
    unittest.main()
