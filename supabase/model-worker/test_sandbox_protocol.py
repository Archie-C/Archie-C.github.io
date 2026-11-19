import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

AVAILABLE = all(importlib.util.find_spec(name) for name in ('torch', 'safetensors'))


@unittest.skipUnless(AVAILABLE, 'requires torch and safetensors')
class SandboxProtocolTests(unittest.TestCase):
    def run_sandbox(self, requests, expression=None):
        import torch
        from safetensors.torch import save_file
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = expression or 'torch.stack((torch.sigmoid(x[:, 0]), torch.tanh(x[:, 1])), dim=-1)'
            (root / 'model.py').write_text(
                'import torch\nfrom torch import nn\n'
                'class Controller(nn.Module):\n'
                '    def __init__(self):\n'
                '        super().__init__()\n'
                '        self.register_buffer("dummy", torch.zeros(1))\n'
                '    def forward(self, x):\n'
                f'        return {expression}\n'
                'def create_model():\n    return Controller()\n', encoding='utf-8')
            save_file({'dummy': torch.zeros(1)}, root / 'weights.safetensors')
            source = Path(__file__).with_name('sandbox.py').read_text(encoding='utf-8')
            source = source.replace('/submission/model.py', (root / 'model.py').as_posix())
            source = source.replace('/submission/weights.safetensors', (root / 'weights.safetensors').as_posix())
            (root / 'sandbox.py').write_text(source, encoding='utf-8')
            result = subprocess.run([sys.executable, '-B', '-I', '-u', str(root / 'sandbox.py')],
                                    input=''.join(json.dumps(request) + '\n' for request in requests),
                                    capture_output=True, text=True, timeout=30, check=True)
            return [json.loads(line) for line in result.stdout.splitlines()]

    def test_multiple_active_flights_and_final_single_flight(self):
        responses = self.run_sandbox([[[0] * 12] * 10, [[0] * 12] * 3, [[0] * 12]])
        self.assertEqual(responses[0], {'ready': True})
        for response, count in zip(responses[1:], (10, 3, 1)):
            self.assertEqual(response, {'output': [[0.5, 0.0]] * count})

    def test_invalid_input_shape_is_rejected(self):
        for request in ([], [[0] * 11], [[0] * 12] * 11):
            with self.subTest(request=request):
                self.assertEqual(self.run_sandbox([request])[-1], {'error': 'invalid_shape'})

    def test_invalid_model_output_is_rejected(self):
        for expression in ('torch.zeros((1, 2))', 'torch.full((len(x), 2), float("nan"))'):
            with self.subTest(expression=expression):
                responses = self.run_sandbox([[[0] * 12] * 3], expression)
                self.assertEqual(responses[-1], {'error': 'invalid_shape'})

    def test_random_inference_is_seeded_per_submission(self):
        expression = 'torch.rand((len(x), 2))'
        requests = [[[0] * 12] * 2]
        self.assertEqual(self.run_sandbox(requests, expression), self.run_sandbox(requests, expression))


if __name__ == '__main__':
    unittest.main()
