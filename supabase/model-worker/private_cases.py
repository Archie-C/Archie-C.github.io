"""Deterministic held-out flights. Keep the 256-bit seed in a trusted secret."""
import hashlib
import re

PUBLIC_TESTS = ('demo_descent', 'centred_descent', 'crosswind_diagnostics', 'near_ground_contact')
PROFILES = ('descent', 'mid_flight', 'approach', 'recovery', 'crosswind')


def test_version(secret):
    if not isinstance(secret, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', secret):
        raise ValueError('MODEL_PRIVATE_SEED must be 64 hexadecimal characters')
    digest = hashlib.sha256(bytes.fromhex(secret)).hexdigest()[:16]
    return 'landing-14-v2-' + digest


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
