"""Generate reproducible continuous MPC demonstrations, one CSV row per decision."""
import argparse
from collections import deque
from contextlib import closing
import csv
from dataclasses import asdict, replace
import hashlib
import io
import json
import math
import multiprocessing
import os
from pathlib import Path
import platform
import signal
import time
import tempfile

import numpy as np
import scipy
import threadpoolctl

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_expert import Controller
from rocket_data_expert import DatasetExpert
from rocket_scoring import CONFIG
from rocket_sampling import PROFILE_COUNTS, SAMPLER_VERSION, sample_mixed_case

OBSERVATION_COLUMNS = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass',
                       'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y', 'air_density')
CSV_COLUMNS = ('run_id', 'step', *OBSERVATION_COLUMNS, 'thrust', 'gimbal', 'success')
# Keep starts within the envelope tested with the continuous expert. Units are
# SI/radians, as in the observations. Thrust and gimbal initially equal zero.
DEFAULT_RANGES = dict(x=(-35., 35.), y=(400., 750.), vx=(-6., 6.), vy=(-75., -40.),
                      theta=(-.06, .06), omega=(-.008, .008), fuel_mass=(9000., 13000.),
                      wind_x=(-5., 5.), wind_y=(-1., 1.))


def validate_ranges(ranges):
    if set(ranges) != set(DEFAULT_RANGES):
        raise ValueError('sampling ranges must contain exactly: ' + ', '.join(DEFAULT_RANGES))
    normalized = {}
    for name, limits in ranges.items():
        if (not isinstance(limits, (list, tuple)) or len(limits) != 2
                or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in limits)
                or limits[0] > limits[1]):
            raise ValueError(f'{name} must have two finite bounds in increasing order')
        normalized[name] = [float(v) for v in limits]
    p, _ = configuration('centred_descent')
    if normalized['fuel_mass'][0] <= 0 or normalized['fuel_mass'][1] > p.fuel_capacity:
        raise ValueError('fuel_mass must be positive and within tank capacity')
    if normalized['y'][0] <= 0 or normalized['vy'][1] >= 0:
        raise ValueError('initial height must be positive and vertical velocity negative')
    return normalized


def sample_case(seed, run_id, ranges):
    """A run's start depends only on seed/id, including after a resumed job."""
    rng = np.random.default_rng(np.random.SeedSequence([seed, run_id]))
    values = {key: float(rng.uniform(*ranges[key])) for key in DEFAULT_RANGES}
    p, initial = configuration('centred_descent')
    initial = replace(initial, **{k: values[k] for k in ('x', 'y', 'vx', 'vy', 'theta', 'omega')},
                      fuel=values['fuel_mass'], thrust=0., gimbal=0.)
    return p, initial, (values['wind_x'], values['wind_y'])


def csv_bytes(rows):
    buffer = io.StringIO(newline='')
    csv.writer(buffer, lineterminator='\n').writerows(rows)
    return buffer.getvalue().encode('utf-8')


def flight_rows(run_id, result):
    """Labels are the expert's commands, not measured physical actuator states."""
    if result['replay']['status'] == 'error':
        raise RuntimeError(f"run {run_id}: {result['termination_reason']}")
    success = int(result['scoring']['success'])
    rows = []
    for step, decision in enumerate(result['decisions']):
        observation = decision['observation']
        command = decision['command']
        thrust, gimbal = command['throttle'], command['gimbal']
        if (len(observation) != 12 or not all(math.isfinite(v) for v in (*observation, thrust, gimbal))
                or not 0 <= thrust <= 1 or not -1 <= gimbal <= 1):
            raise ValueError(f'run {run_id}, step {step}: invalid observation or continuous command')
        rows.append((run_id, step, *observation, thrust, gimbal, success))
    if not rows:
        raise ValueError(f'run {run_id} produced no expert decisions; check initial clearance')
    return rows


def generation_config(seed, ranges, max_time, expert_settings, sampling):
    directory = Path(__file__).resolve().parent
    sources = ('generate_dataset.py', 'rocket_expert.py', 'rocket_closed_loop.py',
               'rocket_physics.py', 'rocket_calibration.py', 'rocket_runtime.py', 'rocket_scoring.py',
               'rocket_sampling.py', 'rocket_wind.py', 'rocket_data_expert.py')
    return dict(schema='rocket-regression-dataset-v2', seed=seed, ranges=ranges,
                sampling=SAMPLER_VERSION if sampling == 'mixed' else 'legacy-uniform-v1',
                profile_counts=PROFILE_COUNTS if sampling == 'mixed' else {'legacy': 1},
                max_time=max_time, expert=expert_settings,
                expert_class='DatasetExpert' if sampling == 'mixed' else 'Controller',
                scoring_version=CONFIG.version, python=platform.python_version(),
                numpy=np.__version__, scipy=scipy.__version__, threadpoolctl=threadpoolctl.__version__,
                numerical_threads=1,
                source_sha256={name: hashlib.sha256((directory/name).read_bytes()).hexdigest()
                               for name in sources})


def save_metadata(path, metadata):
    """Atomically commit the list of complete flights after flushing the CSV."""
    descriptor, name = tempfile.mkstemp(prefix=path.name+'.', suffix='.tmp', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
            json.dump(metadata, file, indent=2, allow_nan=False)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        # This temporary file belongs to this generator invocation.
        if temporary.exists():
            temporary.unlink()


def verify_checkpoint(output, metadata):
    """Detect edits/truncation; extra bytes from an interrupted flight may remain."""
    digest = hashlib.sha256()
    position = 0
    with output.open('rb') as source:
        header = csv_bytes([CSV_COLUMNS])
        if source.read(len(header)) != header:
            raise ValueError('CSV header does not match the regression dataset schema')
        source.seek(0)
        checkpoints = [(len(header), metadata['header_sha256'])]
        checkpoints.extend((run['end_byte'], run['csv_sha256']) for run in metadata['runs'])
        for end, expected in checkpoints:
            if end < position:
                raise ValueError('invalid checkpoint offsets')
            remaining = end-position
            while remaining:
                block = source.read(min(remaining, 1024*1024))
                if not block:
                    raise ValueError('dataset is shorter than its checkpoint')
                digest.update(block)
                remaining -= len(block)
            if digest.hexdigest() != expected:
                raise ValueError('dataset content differs from its checkpoint')
            position = end
    if metadata['committed_bytes'] != position:
        raise ValueError('invalid committed byte count')
    return digest


def default_workers():
    """Use a small CPU pool by default without multiplying BLAS threads."""
    cpu_count = getattr(os, 'process_cpu_count', os.cpu_count)() or 1
    return min(4, cpu_count)


def _initialize_worker():
    # The parent handles cancellation and owns every dataset/checkpoint write.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    global _worker_thread_limit
    _worker_thread_limit = threadpoolctl.threadpool_limits(limits=1)


def _generate_flight(run_id, seed, ranges, max_time, settings, sampling='legacy'):
    """Do expensive work in isolation; transfer only CSV bytes and metrics."""
    scenario, profile, wind_profile = 'centred_descent', 'legacy', None
    if sampling == 'mixed':
        parameters, case = sample_mixed_case(seed, run_id)
        initial, wind = case.initial, case.constant_wind
        scenario, profile, wind_profile = case.scenario, case.profile, case.gusts
    else:
        parameters, initial, wind = sample_case(seed, run_id, ranges)
    expert = (DatasetExpert if sampling == 'mixed' else Controller)(**settings)
    started = time.perf_counter()
    result = evaluate_closed_loop(expert.command, initial, parameters, scenario,
                                  max_time=max_time, control_mode='continuous',
                                  measure_time=True, constant_wind=wind, wind_profile=wind_profile)
    rows = flight_rows(run_id, result)
    block = csv_bytes(rows)
    summary = dict(run_id=run_id, rows=len(rows), profile=profile, scenario=scenario,
                   initial_state=asdict(initial), wind=wind, wind_profile=wind_profile,
                   scoring=result['scoring'], termination=result['termination_reason'],
                   solver_seconds=result['policy_seconds'], elapsed_seconds=time.perf_counter()-started)
    return block, summary


def _flight_results(start, stop, seed, ranges, max_time, settings, workers, sampling='legacy'):
    """Bound outstanding work and yield in run order regardless of completion order."""
    if start == stop:
        return
    workers = min(workers, stop-start)
    arguments = lambda run_id: (run_id, seed, ranges, max_time, settings, sampling)
    if workers == 1:
        with threadpoolctl.threadpool_limits(limits=1):
            for run_id in range(start, stop):
                yield _generate_flight(*arguments(run_id))
        return
    # Spawn also works on Windows and avoids inherited numerical-library state.
    context = multiprocessing.get_context('spawn')
    with context.Pool(workers, initializer=_initialize_worker) as pool:
        ids = iter(range(start, stop))
        pending = deque()
        for _ in range(min(2*workers, stop-start)):
            pending.append(pool.apply_async(_generate_flight, arguments(next(ids))))
        while pending:
            # Waiting for the earliest submitted run makes output byte-for-byte
            # independent of worker count and preserves contiguous checkpoints.
            yield pending.popleft().get()
            run_id = next(ids, None)
            if run_id is not None:
                pending.append(pool.apply_async(_generate_flight, arguments(run_id)))
    # Pool's context manager terminates outstanding work if the iterator is
    # closed on failure/cancellation. Workers never write dataset files.


def generate_dataset(output, *, runs=1000, seed=42, ranges=None, max_time=60.,
                     resume=False, knots=8, max_nfev=45, touchdown_speed=.3, workers=1, sampling='mixed', progress=print):
    """Stream exactly `runs` independent trajectories, retaining failed landings.

    The metadata file commits whole flights. On resume, uncommitted trailing
    CSV bytes are discarded. Changing the run count allows extending a batch;
    changing the seed, model, environment or generation settings is rejected.
    Worker count is execution-only and may change between resumed batches.
    """
    if type(runs) is not int or runs <= 0 or type(seed) is not int or seed < 0:
        raise ValueError('runs must be a positive integer and seed a nonnegative integer')
    if type(workers) is not int or workers <= 0:
        raise ValueError('workers must be a positive integer')
    p, _ = configuration('centred_descent')
    if (not math.isfinite(max_time) or max_time <= 0 or
            abs(max_time/p.control_interval-round(max_time/p.control_interval)) > 1e-9):
        raise ValueError('max_time must be positive and a multiple of the control interval')
    settings = dict(knots=knots, max_nfev=max_nfev, touchdown_speed=touchdown_speed)
    Controller(**settings)  # Validate solver settings before creating output files.
    if sampling not in ('mixed', 'legacy'):
        raise ValueError('sampling must be mixed or legacy')
    if sampling == 'mixed' and ranges is not None:
        raise ValueError('custom ranges require sampling=legacy; mixed sampling uses flight-phase recipes')
    ranges = validate_ranges(DEFAULT_RANGES if ranges is None else ranges) if sampling == 'legacy' else None
    output = Path(output)
    metadata_path = output.with_suffix('.metadata.json')
    if output.resolve() == metadata_path.resolve():
        raise ValueError('output path must differ from its metadata path')
    config = generation_config(seed, ranges, max_time, settings, sampling)
    header = csv_bytes([CSV_COLUMNS])
    if resume:
        metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
        if metadata['config'] != config:
            raise ValueError('cannot resume with different generation settings, sources or dependency versions')
        if [run['run_id'] for run in metadata['runs']] != list(range(len(metadata['runs']))):
            raise ValueError('checkpoint run IDs must be contiguous from zero')
        if len(metadata['runs']) > runs:
            raise ValueError('requested runs is smaller than the completed run count')
        digest = verify_checkpoint(output, metadata)
        mode = 'r+b'
    else:
        if output.exists() or metadata_path.exists():
            raise FileExistsError('dataset or metadata already exists; use --resume or choose a new output')
        output.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(header)
        metadata = dict(config=config, columns=list(CSV_COLUMNS), requested_runs=runs,
                        committed_bytes=len(header), header_sha256=digest.hexdigest(), runs=[])
        # A newly created header remains a valid checkpoint if generation stops.
        with output.open('xb') as file:
            file.write(header)
            file.flush()
            os.fsync(file.fileno())
        save_metadata(metadata_path, metadata)
        mode = 'r+b'
    metadata['requested_runs'] = runs
    results = _flight_results(len(metadata['runs']), runs, seed, ranges, max_time, settings, workers, sampling)
    with output.open(mode) as file, closing(results):
        file.seek(metadata['committed_bytes'])
        file.truncate()
        for block, summary in results:
            file.write(block)
            file.flush()
            os.fsync(file.fileno())
            digest.update(block)
            summary.update(end_byte=file.tell(), csv_sha256=digest.hexdigest())
            metadata['runs'].append(summary)
            metadata['committed_bytes'] = file.tell()
            save_metadata(metadata_path, metadata)
            if progress is not None:
                successful = sum(item['scoring']['success'] for item in metadata['runs'])
                progress(f"{len(metadata['runs'])}/{runs} flights | {successful} successful | "
                         f"{summary['profile']} | {summary['rows']} rows | score {summary['scoring']['score']:.2f} | "
                         f"{summary['elapsed_seconds']:.1f}s")
    save_metadata(metadata_path, metadata)
    return metadata


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('landings.csv'))
    parser.add_argument('--runs', type=int, default=1000, help='Total independent flights (default: 1000).')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--workers', type=int, default=default_workers(),
                        help='Parallel flights (default: up to 4 CPUs); use 1 for serial generation.')
    parser.add_argument('--resume', action='store_true', help='Resume or extend a matching dataset checkpoint.')
    parser.add_argument('--sampling', choices=('mixed', 'legacy'), default='mixed',
                        help='Flight-phase mixture (default) or the original uniform sampler.')
    parser.add_argument('--ranges', type=Path, help='JSON bounds overrides; requires --sampling legacy.')
    parser.add_argument('--max-time', type=float, default=60., help='Maximum simulated seconds per flight.')
    parser.add_argument('--knots', type=int, default=8)
    parser.add_argument('--max-nfev', type=int, default=45)
    parser.add_argument('--touchdown-speed', type=float, default=.3)
    args = parser.parse_args(argv)
    try:
        ranges = None
        if args.ranges:
            ranges = dict(DEFAULT_RANGES)
            overrides = json.loads(args.ranges.read_text(encoding='utf-8'))
            if not isinstance(overrides, dict):
                raise ValueError('--ranges must contain a JSON object')
            ranges.update(overrides)
        metadata = generate_dataset(args.output, runs=args.runs, seed=args.seed, ranges=ranges,
                                    max_time=args.max_time, resume=args.resume, knots=args.knots,
                                    max_nfev=args.max_nfev, touchdown_speed=args.touchdown_speed, workers=args.workers, sampling=args.sampling,
                                    progress=lambda message: print(message, flush=True))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f'Generation failed: {exc}\n')
    except KeyboardInterrupt:
        parser.exit(130, 'Interrupted. Resume with the same command plus --resume.\n')
    count = sum(run['rows'] for run in metadata['runs'])
    print(f"Saved {count} rows from {len(metadata['runs'])} flights to {args.output}", flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
