"""Deterministic held-out flights. Keep the 256-bit seed in a trusted secret."""
import hashlib
import re
import sys
import os
from pathlib import Path

EVALUATOR_VERSION = 'rocket-worker-v4'

PROFILES = ('descent', 'mid_flight', 'approach', 'recovery', 'crosswind')


def test_version(secret):
    if not isinstance(secret, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', secret):
        raise ValueError('MODEL_PRIVATE_SEED must be 64 hexadecimal characters')
    import numpy as np
    root = Path(__file__).resolve().parent
    practical = root.parents[1] / 'courses/deep-learning-aau/topics/03-neural-networks/exercises/practical-exercise'
    sources = [root / name for name in ('private_cases.py', 'evaluate.py', 'sandbox.py', 'worker.py', 'modal_app.py', 'Dockerfile')]
    sources += [practical / name for name in ('rocket_closed_loop.py', 'rocket_runtime.py', 'rocket_physics.py',
                                             'rocket_calibration.py', 'rocket_scoring.py', 'rocket_sampling.py', 'rocket_wind.py')]
    digest = hashlib.sha256(bytes.fromhex(secret))
    for source in sources:
        digest.update(source.name.encode())
        digest.update(source.read_bytes())
    digest.update(sys.version.encode())
    digest.update(np.__version__.encode())
    backend = os.environ.get('MODEL_BACKEND', 'docker')
    digest.update(backend.encode())
    if backend != 'modal':
        digest.update(os.environ.get('MODEL_CONTAINER_IMAGE', 'rocket-model-sandbox:1').encode())
    return 'landing-private-10-v4-' + digest.hexdigest()[:16]



def private_flights(secret):
    # Imports live here so the queue consumer can validate configuration before claiming.
    from rocket_sampling import profile_for_run, sample_mixed_case
    test_version(secret)
    seed = int(secret, 16)
    counts = {profile: 0 for profile in PROFILES}
    for run_id in range(100):
        profile = profile_for_run(seed, run_id)
        if counts[profile] >= 2:
            continue
        params, case = sample_mixed_case(seed, run_id)
        if case.profile != profile:
            raise ValueError('private flight profile mismatch')
        counts[profile] += 1
        yield params, case
        if all(count == 2 for count in counts.values()):
            return
    raise ValueError('could not create all private flights')
