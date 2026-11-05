"""Validate observations against the fixed coastal calibration envelope."""
import math

import numpy as np

from rocket_closed_loop import make_observation
from rocket_physics import State, clearance


def envelope_violations(observation, time, parameters):
    """Return envelope excursions; reject invalid or inconsistent physical states.

    observation-v1.0 is fixed to the calibrated pad at (0, 0). No values are
    clamped, and an undefined angle of attack at zero airspeed is not a violation.
    """
    values = np.asarray(observation, dtype=np.float64)
    if values.shape != (12,) or not np.all(np.isfinite(values)) or not math.isfinite(time):
        raise ValueError('observation and time must be finite')
    s = State(*map(float, values[:9]))
    if (not 0 <= s.fuel <= parameters.fuel_capacity or not 0 <= s.thrust <= parameters.max_thrust or
            abs(s.gimbal) > parameters.gimbal_max or (s.fuel == 0 and s.thrust != 0) or
            clearance(s, parameters)[0] <= 0):
        raise ValueError('invalid fuel, actuator or contact state')
    if not np.allclose(make_observation(s, time, parameters), values, rtol=1e-12, atol=1e-12):
        raise ValueError('observation atmosphere differs from recorded configuration')
    wind = parameters.wind(s.y, time)
    air = (s.vx - wind[0], s.vy - wind[1])
    speed = math.hypot(*air)
    tail = (math.sin(s.theta), -math.cos(s.theta))
    alpha = math.atan2(tail[0]*air[1] - tail[1]*air[0], tail[0]*air[0] + tail[1]*air[1]) if speed else None
    reasons = []
    if not 0 <= s.y <= 1000: reasons.append('altitude')
    if speed > 130: reasons.append('airspeed')
    if alpha is not None and abs(alpha) > math.radians(35): reasons.append('angle of attack')
    return reasons
