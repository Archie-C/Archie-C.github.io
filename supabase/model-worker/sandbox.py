"""Untrusted side of the inference protocol; never give this process secrets."""
import importlib.util
import json
import math
import sys
import contextlib

import torch
from safetensors.torch import load_file

protocol = sys.stdout
sys.stdout = sys.stderr
torch.set_num_threads(1)
try:
    spec = importlib.util.spec_from_file_location('submission', '/submission/model.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    model = module.create_model()
    if not isinstance(model, torch.nn.Module):
        raise TypeError('create_model must return torch.nn.Module')
    model.load_state_dict(load_file('/submission/weights.safetensors', device='cpu'), strict=True)
    model.eval()
    print(json.dumps({'ready': True}), file=protocol, flush=True)
except BaseException:
    print(json.dumps({'error': 'model_loading'}), file=protocol, flush=True)
    sys.exit(1)

for line in sys.stdin:
    try:
        observation = json.loads(line)
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            output = model(torch.tensor([observation], dtype=torch.float32))
        if not isinstance(output, torch.Tensor) or tuple(output.shape) != (1, 2):
            print(json.dumps({'error': 'invalid_shape'}), file=protocol, flush=True)
            break
        values = output.tolist()
        if any(not math.isfinite(v) for v in values[0]):
            print(json.dumps({'error': 'invalid_shape'}), file=protocol, flush=True)
            break
        print(json.dumps({'output': values}, allow_nan=False), file=protocol, flush=True)
    except BaseException:
        print(json.dumps({'error': 'runtime'}), file=protocol, flush=True)
        break
