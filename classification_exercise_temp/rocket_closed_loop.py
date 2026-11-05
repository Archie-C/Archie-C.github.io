"""Trusted local closed-loop driver and the public observation-v1.0 contract."""
from dataclasses import asdict
import hashlib
import json
import math

import numpy as np

from rocket_physics import clearance
from rocket_scoring import CONFIG, score_contact
from rocket_server import Run, state_packet

OBSERVATION_VERSION = 'observation-v1.0'
OBSERVATION_NAMES = ('x_relative', 'height_relative', 'velocity_x', 'velocity_y',
                     'theta', 'omega', 'fuel_mass', 'actual_thrust', 'actual_gimbal',
                     'wind_x', 'wind_y', 'air_density')


def make_observation(state, time, parameters):
    """Return pad-relative COM, velocities, actuators and atmosphere in SI units.

    Upward velocity, anticlockwise angle, and leftward thrust deflection are
    positive. The pad geometry is fixed by touchdown-v1.0.
    """
    wind = parameters.wind(state.y, time)
    values = (state.x - (CONFIG.pad_left + CONFIG.pad_right) / 2,
              state.y - CONFIG.pad_height, state.vx, state.vy, state.theta,
              state.omega, state.fuel, state.thrust, state.gimbal,
              *wind, parameters.density(state.y, time))
    observation = np.asarray(values, dtype=np.float64)
    if observation.shape != (12,) or not np.all(np.isfinite(observation)):
        raise ValueError('observation must contain 12 finite values')
    return observation


def evaluate_closed_loop(policy, initial_state, parameters, scenario_id, *, max_time=30.0):
    """Run a trusted stateless policy at fixed simulation-time boundaries.

    The scenario must describe the supplied configuration, so replay metadata
    remains meaningful. Invalid policy outputs terminate explicitly.
    """
    if not math.isfinite(max_time) or max_time <= 0:
        raise ValueError('max_time must be positive and finite')
    if abs(max_time / parameters.control_interval - round(max_time / parameters.control_interval)) > 1e-9:
        raise ValueError('max_time must be a control boundary')
    run = Run(scenario_id)
    if parameters != run.p:
        raise ValueError('parameters must match the named calibrated scenario')
    run.initial = run.state = initial_state
    run.config['initial_state'] = asdict(initial_state)
    identity = json.dumps([run.config['physics_config'], asdict(initial_state), max_time], sort_keys=True)
    run.id = hashlib.sha256(identity.encode()).hexdigest()[:32]
    run.config['run_id'] = run.id
    run.config['observation_version'] = OBSERVATION_VERSION
    run.config['closed_loop'] = dict(max_time=max_time, policy=getattr(policy, '__qualname__', type(policy).__name__))
    run.snapshots = [state_packet(run, 0, initial_state, run.command.copy(), 0)]
    decisions = []
    run.status = 'running'
    # Detect initial contact before asking the policy for an action.
    if clearance(initial_state, parameters)[0] <= 0:
        run.advance()  # same authoritative contact handling and replay format
    while run.status == 'running':
        if run.t >= max_time - 1e-10:
            run.status = 'completed'
            run.event = dict(run_id=run.id, type='completed', time=run.t,
                             reason='run time limit', scoring=score_contact(None, parameters))
            break
        obs = make_observation(run.state, run.t, parameters)
        try:
            action = policy(obs.copy())
            if isinstance(action, np.integer):
                action = int(action)
            run.queue(dict(command_sequence=len(decisions), action=action, effective_time=run.t))
        except Exception as exc:
            run.status = 'error'
            run.error = f'Policy error ({type(exc).__name__}): {exc}'
            run.event = dict(run_id=run.id, type='error', time=run.t,
                             reason=run.error, scoring=score_contact(None, parameters))
            break
        diagnostics = getattr(getattr(policy, '__self__', None), 'diagnostics', None)
        decisions.append(dict(time=run.t, observation=obs.tolist(), action=action,
                              diagnostics=diagnostics.copy() if diagnostics else None))
        boundary = (len(decisions)) * parameters.control_interval
        while run.status == 'running' and run.t < boundary - 1e-10:
            run.advance()
    replay = run.record()
    replay['decisions'] = decisions
    return dict(scenario_id=scenario_id, decisions=decisions,
                scoring=run.event['scoring'], termination_reason=run.event['reason'], replay=replay)
