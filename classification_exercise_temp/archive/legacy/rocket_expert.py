"""Deterministic, observation-only guidance and bounded predictive shooting.

All candidates use authoritative RK4/contact physics, with a fixed short horizon.
A dataset must pass the documented acceptance gates before it is frozen.
"""
from dataclasses import replace
import hashlib
import math
from pathlib import Path

import numpy as np

from rocket_calibration import configuration
from rocket_physics import Command, State, clearance, discrete_command, mass_properties, step
from rocket_scoring import score_contact

# Freeze provenance at import, before a long-running evaluation begins.
SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
EXPERT_VERSION = 'expert-prototype-v0.5'


def _state(observation):
    v = np.asarray(observation, dtype=np.float64)
    if v.shape != (12,) or not np.all(np.isfinite(v)):
        raise ValueError('expected 12 finite observation values')
    return State(*map(float, v[:9]))


def guidance(observation):
    """Continuous braking and attitude guidance for the fixed coastal profile."""
    s = _state(observation)
    p, _ = configuration('centred_descent')
    mass, _, _ = mass_properties(s.fuel, p)
    height = max(0., clearance(s, p)[0])
    # Track a braking curve and use feed-forward acceleration. Because enabled
    # minimum thrust exceeds weight, switch the engine fully off below the
    # ignition threshold instead of pretending it can hover continuously.
    braking = max(.1, p.max_thrust / mass - p.g0)
    desired_vy = -max(1., .65 * math.sqrt(2 * braking * height))
    acceleration = max(-p.g0, min(braking, 3. * (desired_vy - s.vy) + braking * .65**2))
    throttle = (mass * (p.g0 + acceleration) - p.min_thrust) / (p.max_thrust - p.min_thrust)
    throttle = 0. if throttle <= .15 or s.fuel <= 0 else min(1., max(.01, throttle))
    desired_theta = max(-.12, min(.12, .003 * s.x + .035 * s.vx))
    gimbal = max(-1., min(1., 4. * (s.theta - desired_theta) + 12. * s.omega)) if throttle else 0.
    return Command(throttle, gimbal)


def simple_discrete_guidance(observation):
    """Diagnostic only: quantize the continuous guidance, not an expert label."""
    desired = guidance(observation)
    # Discrete steering needs a larger command to overcome the centre deadband.
    desired = Command(desired.throttle, max(-1., min(1., 5. * desired.gimbal)))
    if desired.throttle == 0:
        return 0
    p, _ = configuration('centred_descent')
    return min(range(1, 10), key=lambda i: (
        abs(discrete_command(i, p).throttle - desired.throttle)
        + .1 * abs(discrete_command(i, p).gimbal - desired.gimbal), i))


class DiscreteExpert:
    """Bounded discrete shooting with an observation-derived guidance rollout.

    Each candidate starts with a different action and continues with a fixed
    guidance baseline; predictions use the authoritative step and contact
    solver. Wind and density are held at their observed values throughout the
    short horizon. No plan or state is retained across calls.
    """
    version = EXPERT_VERSION

    def __init__(self, horizon_steps=5):
        if type(horizon_steps) is not int or not 1 <= horizon_steps <= 10:
            raise ValueError('horizon_steps must be an integer from 1 to 10')
        self.horizon_steps = horizon_steps
        self.diagnostics = {}
        self.solver_settings = dict(horizon_steps=horizon_steps, candidates=10,
                                    continuation='simple_discrete_guidance', tie_break='lowest action ID')

    def predict_action(self, observation):
        s = _state(observation)
        values = np.asarray(observation, dtype=np.float64)
        p, _ = configuration('centred_descent')
        p = replace(p, wind=lambda y, t: (float(values[9]), float(values[10])),
                    density=lambda y, t=None: float(values[11]))
        fallback_id = simple_discrete_guidance(observation)
        desired = guidance(observation)
        desired = Command(desired.throttle, max(-1., min(1., 5. * desired.gimbal)))
        costs, contacts = [], []
        try:
            for action in range(10):
                candidate = s
                first = discrete_command(action, p)
                contact = None
                t = 0.
                for interval in range(self.horizon_steps):
                    predicted_observation = np.array((*candidate.values(), *values[9:]), dtype=np.float64)
                    rollout_action = action if interval == 0 else simple_discrete_guidance(predicted_observation)
                    cmd = discrete_command(rollout_action, p)
                    for _ in range(round(p.control_interval / p.timestep)):
                        candidate, contact = step(t, candidate, cmd, p, p.timestep)
                        t += p.timestep
                        if contact:
                            break
                    if contact:
                        break
                if contact:
                    result = score_contact(contact, p)
                    cost = -1e6 - result['score'] if result['success'] else 1e8
                else:
                    result = None
                    height = max(0., clearance(candidate, p)[0])
                    mass = p.dry_mass + candidate.fuel
                    braking = max(.1, p.max_thrust / mass - p.g0)
                    desired_vy = -max(1., .65 * math.sqrt(2 * braking * height))
                    # Guidance tracking encourages progress even when the short
                    # horizon cannot reach contact; predicted state and contact
                    # can outweigh the initial command's tracking penalty.
                    cost = (100 * (first.throttle - desired.throttle)**2
                            + .1 * (first.gimbal - desired.gimbal)**2
                            + .005 * (candidate.vy - desired_vy)**2
                            + .002 * candidate.x**2 + .05 * candidate.vx**2
                            + 20 * candidate.theta**2 + 40 * candidate.omega**2)
                if not math.isfinite(cost):
                    raise ArithmeticError('nonfinite candidate cost')
                if contact is None:
                    cost = min(cost, 1e6)  # Every unsafe contact remains more costly.
                costs.append(cost)
                contacts.append(result)
            if all(value >= 1e8 for value in costs):
                raise ArithmeticError('all predicted candidates contact unsafely')
            action = min(range(10), key=lambda i: (costs[i], i))
            ordered = sorted(costs)
            self.diagnostics = dict(fallback=False, costs=costs,
                                    cost_gap=ordered[1] - ordered[0],
                                    predicted_safe=bool(contacts[action] and contacts[action]['success']),
                                    predicted_contact=contacts[action],
                                    horizon_seconds=self.horizon_steps * p.control_interval)
            return action
        except Exception as exc:
            self.diagnostics = dict(fallback=True, reason=f'{type(exc).__name__}: {exc}', predicted_safe=False)
            return fallback_id


class ContinuousReference:
    """Bounded receding-horizon continuous-command shooting reference.

    An explicit engine-off candidate and a grid of enabled throttle/gimbal
    commands are followed by the continuous guidance baseline. Candidate
    rollouts use the full contact solver, and the first command is replanned at
    each control boundary. This bounded grid is a reference search, not proof of
    global optimality or feasibility.
    """
    version = 'continuous-reference-prototype-v0.3'

    def __init__(self, horizon_steps=3):
        if type(horizon_steps) is not int or not 1 <= horizon_steps <= 10:
            raise ValueError('horizon_steps must be an integer from 1 to 10')
        self.horizon_steps = horizon_steps
        self.diagnostics = {}
        self.solver_settings = dict(horizon_steps=horizon_steps,
                                    throttle_grid=[0., .12, .35, .55, .75, 1.],
                                    gimbal_grid=[-1., 0., 1.],
                                    continuation='guidance', tie_break='candidate order')

    def predict_command(self, observation):
        state = _state(observation)
        values = np.asarray(observation, dtype=np.float64)
        p, _ = configuration('centred_descent')
        p = replace(p, wind=lambda y, t: (float(values[9]), float(values[10])),
                    density=lambda y, t=None: float(values[11]))
        fallback = guidance(observation)
        # Include the continuous baseline's actual output as a candidate in
        # addition to the grid, with a deterministic, observation-derived order.
        candidates = [Command(0., 0.)] + [Command(throttle, gimbal)
                     for throttle in (.12, .35, .55, .75, 1.) for gimbal in (0., 1., -1.)]
        candidates.append(fallback)
        costs, contacts = [], []
        try:
            for first in candidates:
                candidate, contact, t = state, None, 0.
                for interval in range(self.horizon_steps):
                    obs = np.array((*candidate.values(), *values[9:]), dtype=np.float64)
                    command = first if interval == 0 else guidance(obs)
                    for _ in range(round(p.control_interval / p.timestep)):
                        candidate, contact = step(t, candidate, command, p, p.timestep)
                        t += p.timestep
                        if contact:
                            break
                    if contact:
                        break
                if contact:
                    result = score_contact(contact, p)
                    cost = -1e6 - result['score'] if result['success'] else 1e8
                else:
                    result = None
                    height = max(0., clearance(candidate, p)[0])
                    braking = max(.1, p.max_thrust / (p.dry_mass + candidate.fuel) - p.g0)
                    desired_vy = -max(1., .65 * math.sqrt(2 * braking * height))
                    cost = (100 * (first.throttle - fallback.throttle)**2
                            + .1 * (first.gimbal - fallback.gimbal)**2
                            + .005 * (candidate.vy - desired_vy)**2
                            + .002 * candidate.x**2 + .05 * candidate.vx**2
                            + 20 * candidate.theta**2 + 40 * candidate.omega**2)
                if not math.isfinite(cost):
                    raise ArithmeticError('nonfinite candidate cost')
                if contact is None:
                    cost = min(cost, 1e6)  # Every unsafe contact remains more costly.
                costs.append(cost)
                contacts.append(result)
            if all(value >= 1e8 for value in costs):
                raise ArithmeticError('all predicted candidates contact unsafely')
            chosen = min(range(len(costs)), key=lambda i: (costs[i], i))
            ordered = sorted(costs)
            self.diagnostics = dict(fallback=False, costs=costs, cost_gap=ordered[1]-ordered[0],
                                    predicted_safe=bool(contacts[chosen] and contacts[chosen]['success']),
                                    predicted_contact=contacts[chosen],
                                    horizon_seconds=self.horizon_steps*p.control_interval)
            return candidates[chosen]
        except Exception as exc:
            self.diagnostics = dict(fallback=True, reason=f'{type(exc).__name__}: {exc}', predicted_safe=False)
            return fallback
