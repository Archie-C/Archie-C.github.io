"""Deterministic, observation-only prototype guidance and discrete shooting.

This prototype is not certified and must not be used to release labelled data.
All candidates use authoritative RK4/contact physics, with a fixed short horizon.
"""
from dataclasses import replace
import math

import numpy as np

from rocket_calibration import configuration
from rocket_physics import Command, State, clearance, discrete_command, mass_properties, step
from rocket_scoring import score_contact

EXPERT_VERSION = 'expert-prototype-v0.1'


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
    # Approximate ignition delay and a shallow terminal descent target.
    braking = max(.1, p.max_thrust / mass - p.g0)
    stopping = max(0., -s.vy)**2 / (2 * braking) + max(0., -s.vy) * .35
    desired_vy = -min(30., max(1., math.sqrt(max(0., 2 * braking * height)) * .6))
    acceleration = p.g0 + .8 * (desired_vy - s.vy)
    throttle = (mass * acceleration - p.min_thrust) / (p.max_thrust - p.min_thrust)
    if height > stopping * 1.15 or s.fuel <= 0:
        throttle = 0.
    else:
        throttle = min(1., max(.01, throttle))
    desired_theta = max(-.12, min(.12, .003 * s.x + .035 * s.vx))
    gimbal = max(-1., min(1., 4. * (s.theta - desired_theta) + 12. * s.omega)) if throttle else 0.
    return Command(throttle, gimbal)


class DiscreteExpert:
    """Fixed-budget ten-way shooting, stateless across decision boundaries.

    Wind and density are held at their observed values in the hypothetical
    horizon; all other model parameters are the published fixed coastal profile.
    The same observation therefore always produces the same action.
    """
    version = EXPERT_VERSION

    def __init__(self, horizon_steps=3):
        if type(horizon_steps) is not int or not 1 <= horizon_steps <= 10:
            raise ValueError('horizon_steps must be an integer from 1 to 10')
        self.horizon_steps = horizon_steps
        self.diagnostics = {}

    def predict_action(self, observation):
        s = _state(observation)
        values = np.asarray(observation, dtype=np.float64)
        p, _ = configuration('centred_descent')
        p = replace(p, wind=lambda y, t: (float(values[9]), float(values[10])),
                    density=lambda y, t=None: float(values[11]))
        fallback = guidance(observation)
        # The fallback is a deterministic discrete command, used only on error.
        fallback_id = min(range(10), key=lambda i: (abs(discrete_command(i, p).throttle-fallback.throttle)
                          + .1 * abs(discrete_command(i, p).gimbal-fallback.gimbal), i))
        costs = []
        try:
            for action in range(10):
                candidate = s
                cmd = discrete_command(action, p)
                contact = None
                t = 0.
                for _ in range(self.horizon_steps * round(p.control_interval / p.timestep)):
                    candidate, contact = step(t, candidate, cmd, p, p.timestep)
                    t += p.timestep
                    if contact:
                        break
                if contact:
                    score = score_contact(contact, p)
                    cost = -1000. - score['score'] if score['success'] else 1e8
                else:
                    height = max(0., clearance(candidate, p)[0])
                    mass = p.dry_mass + candidate.fuel
                    braking = max(.1, p.max_thrust / mass - p.g0)
                    desired = -min(30., max(1., math.sqrt(2 * braking * height) * .6))
                    cost = ((candidate.vy-desired)**2 + .02*candidate.x**2 + 2*candidate.vx**2
                            + 1000*candidate.theta**2 + 4000*candidate.omega**2)
                if not math.isfinite(cost):
                    raise ArithmeticError('nonfinite candidate cost')
                costs.append(cost)
            action = min(range(10), key=lambda i: (costs[i], i))
            self.diagnostics = dict(fallback=False, costs=costs, predicted_safe=costs[action] < 0,
                                    horizon_seconds=self.horizon_steps * p.control_interval)
            return action
        except (ArithmeticError, ValueError, OverflowError) as exc:
            self.diagnostics = dict(fallback=True, reason=f'{type(exc).__name__}: {exc}', predicted_safe=False)
            return fallback_id
