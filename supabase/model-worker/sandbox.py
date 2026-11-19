"""Untrusted side of the inference protocol; never give this process secrets."""
import importlib.util
import json
import math
import sys
import contextlib
import random

import torch
from safetensors.torch import load_file

protocol = sys.stdout
sys.stdout = sys.stderr
torch.set_num_threads(1)
random.seed(0)
torch.manual_seed(0)
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
        observations = torch.tensor(json.loads(line), dtype=torch.float32)
        if observations.ndim != 2 or observations.shape[1] != 12 or not 1 <= len(observations) <= 10:
            print(json.dumps({'error': 'invalid_shape'}), file=protocol, flush=True)
            break
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            output = model(observations)
        if not isinstance(output, torch.Tensor) or tuple(output.shape) != (len(observations), 2):
            print(json.dumps({'error': 'invalid_shape'}), file=protocol, flush=True)
            break
        values = output.tolist()
        if any(not math.isfinite(v) for row in values for v in row):
            print(json.dumps({'error': 'invalid_shape'}), file=protocol, flush=True)
            break
        print(json.dumps({'output': values}, allow_nan=False), file=protocol, flush=True)
    except BaseException:
        print(json.dumps({'error': 'runtime'}), file=protocol, flush=True)
        break
