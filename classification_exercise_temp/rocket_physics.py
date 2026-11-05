"""Deterministic planar, variable-mass rocket dynamics; SI units throughout.

Body coordinates are (right, nose). The state position is the instantaneous
centre of mass. Angular acceleration uses the specified effective exhaust-flux
closure I * omega_dot = torque, not d(I*omega)/dt = torque.
"""
from dataclasses import dataclass
from functools import lru_cache
from math import atan2, cos, hypot, isfinite, sin
from typing import Callable

Vector = tuple[float, float]
ScalarField = Callable[[float], float]
WindField = Callable[[float, float], Vector]
Coefficient = Callable[[float], float]


def cross(a: Vector, b: Vector) -> float:
    return a[0] * b[1] - a[1] * b[0]


def clip(x: float, low: float, high: float) -> float:
    return max(low, min(high, x))


@dataclass(frozen=True)
class State:
    x: float
    y: float
    vx: float
    vy: float
    theta: float
    omega: float
    fuel: float
    thrust: float
    gimbal: float

    def values(self):
        return (self.x, self.y, self.vx, self.vy, self.theta, self.omega,
                self.fuel, self.thrust, self.gimbal)


@dataclass(frozen=True)
class Command:
    throttle: float
    gimbal: float

    def __post_init__(self):
        if not (isfinite(self.throttle) and 0 <= self.throttle <= 1 and
                isfinite(self.gimbal) and -1 <= self.gimbal <= 1):
            raise ValueError('command must be finite and normalized')


@dataclass(frozen=True)
class Parameters:
    dry_mass: float
    dry_centroid: Vector
    dry_inertia: float
    fuel_capacity: float
    tank_bottom: float
    tank_height: float
    tank_radius: float
    engine: Vector
    hull: tuple[Vector, ...]  # closed polygon, body coordinates
    feet: tuple[Vector, ...]  # additional point contacts
    area: float
    length: float
    min_thrust: float
    max_thrust: float
    isp: float
    g0: float
    thrust_tau: float
    thrust_rate: float
    gimbal_max: float
    gimbal_tau: float
    gimbal_rate: float
    cmq: float
    speed_epsilon: float
    throttle_levels: tuple[float, float, float]
    control_interval: float
    timestep: float
    event_tolerance: float
    gravity: ScalarField
    density: ScalarField
    wind: WindField
    drag_coefficient: Coefficient
    lift_coefficient: Coefficient
    centre_of_pressure: Callable[[float], Vector]
    # Piecewise-linear terrain, extended horizontally beyond its endpoints.
    terrain: tuple[Vector, ...]

    def __post_init__(self):
        positive = (self.dry_mass, self.dry_inertia, self.fuel_capacity,
                    self.tank_height, self.tank_radius, self.length, self.isp,
                    self.g0, self.thrust_tau, self.thrust_rate, self.gimbal_tau,
                    self.gimbal_rate, self.speed_epsilon, self.control_interval,
                    self.timestep, self.event_tolerance)
        if not all(isfinite(v) and v > 0 for v in positive):
            raise ValueError('positive parameters must be finite and positive')
        if not (0 <= self.min_thrust <= self.max_thrust and self.max_thrust > 0
                and self.gimbal_max >= 0 and self.area >= 0 and self.cmq >= 0):
            raise ValueError('invalid force or actuator parameters')
        low, medium, high = self.throttle_levels
        if not 0 < low < medium < high <= 1:
            raise ValueError('throttle levels must be ordered within (0, 1]')
        if len(self.hull) < 3 or not self.terrain or any(
                a[0] >= b[0] for a, b in zip(self.terrain, self.terrain[1:])):
            raise ValueError('hull needs three vertices and terrain ordered x points')
        numbers = (self.min_thrust, self.max_thrust, self.gimbal_max, self.area,
                   self.cmq, self.tank_bottom, *self.dry_centroid, *self.engine,
                   *(v for point in (*self.hull, *self.feet, *self.terrain) for v in point))
        if not all(isfinite(v) for v in numbers):
            raise ValueError('geometry and parameters must be finite')


def discrete_command(action: int, p: Parameters) -> Command:
    if type(action) is not int or not 0 <= action <= 9:
        raise ValueError('action must be an integer from 0 to 9')
    return _discrete_command(action, p.throttle_levels)


@lru_cache(maxsize=128)
def _discrete_command(action: int, throttle_levels: tuple[float, float, float]) -> Command:
    if action == 0:
        return Command(0, 0)
    i = action - 1
    return Command(throttle_levels[i // 3], (1, 0, -1)[i % 3])


def mass_properties(fuel: float, p: Parameters) -> tuple[float, Vector, float]:
    """Uniform cylindrical fuel from tank bottom up; dry inertia is centroidal."""
    if not 0 <= fuel <= p.fuel_capacity:
        raise ValueError('fuel outside tank capacity')
    height = p.tank_height * fuel / p.fuel_capacity
    fuel_c = (0.0, p.tank_bottom + height / 2)
    mass = p.dry_mass + fuel
    c = tuple((p.dry_mass * d + fuel * f) / mass
              for d, f in zip(p.dry_centroid, fuel_c))
    inertia = (p.dry_inertia + p.dry_mass * sum((d - z)**2 for d, z in zip(p.dry_centroid, c))
               + fuel * (3 * p.tank_radius**2 + height**2) / 12
               + fuel * sum((f - z)**2 for f, z in zip(fuel_c, c)))
    if not isfinite(inertia) or inertia <= 0:
        raise ValueError('invalid moment of inertia')
    return mass, c, inertia


def world_vector(body: Vector, theta: float) -> Vector:
    e = (cos(theta), sin(theta))
    n = (-sin(theta), cos(theta))
    return (body[0] * e[0] + body[1] * n[0], body[0] * e[1] + body[1] * n[1])


def relative_point(point: Vector, centre: Vector, theta: float) -> Vector:
    return world_vector((point[0] - centre[0], point[1] - centre[1]), theta)


def forces(t: float, s: State, p: Parameters, *, _powered: bool | None = None,
           _centre: Vector | None = None):
    """Return thrust, drag, lift, thrust torque, aero torque and damping."""
    if _centre is None:
        _, c, _ = mass_properties(clip(s.fuel, 0, p.fuel_capacity), p)
    else:
        c = _centre
    thrust = s.thrust if (s.fuel > 0 if _powered is None else _powered) else 0.0
    ft = (-thrust * sin(s.theta + s.gimbal), thrust * cos(s.theta + s.gimbal))
    torque_t = cross(relative_point(p.engine, c, s.theta), ft)
    wx, wy = p.wind(s.y, t)
    vr = (s.vx - wx, s.vy - wy)
    speed = hypot(*vr)
    rho = p.density(s.y)
    if not isfinite(rho) or rho < 0 or not all(isfinite(v) for v in vr):
        raise ValueError('invalid atmospheric model')
    if speed == 0:
        return ft, (0.0, 0.0), (0.0, 0.0), torque_t, 0.0, 0.0
    tail = (sin(s.theta), -cos(s.theta))
    alpha = atan2(cross(tail, vr), tail[0] * vr[0] + tail[1] * vr[1])
    cd, cl = p.drag_coefficient(alpha), p.lift_coefficient(alpha)
    if not isfinite(cd) or cd < 0 or not isfinite(cl):
        raise ValueError('invalid aerodynamic coefficient')
    q_area = 0.5 * rho * speed**2 * p.area
    unit = (vr[0] / speed, vr[1] / speed)
    drag = (-q_area * cd * unit[0], -q_area * cd * unit[1])
    lift = (-q_area * cl * unit[1], q_area * cl * unit[0])
    damping = -q_area * p.length * p.cmq * s.omega * p.length / (2 * max(speed, p.speed_epsilon))
    cp = relative_point(p.centre_of_pressure(alpha), c, s.theta)
    aero_torque = cross(cp, (drag[0] + lift[0], drag[1] + lift[1])) + damping
    return ft, drag, lift, torque_t, aero_torque, damping


def derivative(t: float, s: State, command: Command, p: Parameters, *, _powered: bool | None = None) -> State:
    if not all(isfinite(v) for v in s.values()):
        raise ValueError('non-finite state')
    mass, centre, inertia = mass_properties(clip(s.fuel, 0, p.fuel_capacity), p)
    powered = s.fuel > 0 if _powered is None else _powered
    ft, fd, fl, torque, aero_torque, _ = forces(t, s, p, _powered=powered, _centre=centre)
    g = p.gravity(s.y)
    if not isfinite(g) or g < 0:
        raise ValueError('gravity must be finite and nonnegative')
    target = 0.0 if command.throttle == 0 else p.min_thrust + command.throttle * (p.max_thrust - p.min_thrust)
    dt = clip((target - s.thrust) / p.thrust_tau, -p.thrust_rate, p.thrust_rate) if powered else 0.0
    dg = clip((command.gimbal * p.gimbal_max - s.gimbal) / p.gimbal_tau, -p.gimbal_rate, p.gimbal_rate)
    result = State(s.vx, s.vy, (ft[0] + fd[0] + fl[0]) / mass,
                   (ft[1] + fd[1] + fl[1]) / mass - g, s.omega,
                   (torque + aero_torque) / inertia,
                   -s.thrust / (p.isp * p.g0) if powered else 0.0, dt, dg)
    if not all(isfinite(v) for v in result.values()):
        raise ValueError('non-finite derivative')
    return result


def _add(s: State, k: State, scale: float) -> State:
    return State(*(a + scale * b for a, b in zip(s.values(), k.values())))


def _rk4_trajectory(t: float, s: State, command: Command, p: Parameters, h: float):
    """Return RK4 endpoint and its cubic continuous extension on [0, 1]."""
    # Extend the powered ODE smoothly across a trial fuel boundary; the
    # event locator truncates the accepted step at exhaustion.
    powered = s.fuel > 0
    k1 = derivative(t, s, command, p, _powered=powered)
    k2 = derivative(t + h / 2, _add(s, k1, h / 2), command, p, _powered=powered)
    k3 = derivative(t + h / 2, _add(s, k2, h / 2), command, p, _powered=powered)
    k4 = derivative(t + h, _add(s, k3, h), command, p, _powered=powered)
    # y(u) = y0 + a*u + b*u^2 + c*u^3; at u=1 this is RK4.
    coefficients = tuple((h * a, h * (-1.5*a + b + c - 0.5*d),
                          h * (2/3) * (a - b - c + d))
                         for a, b, c, d in zip(k1.values(), k2.values(),
                                               k3.values(), k4.values()))
    def evaluate(u):
        return State(*(v + u*(a + u*(b + u*c))
                       for v, (a, b, c) in zip(s.values(), coefficients)))
    return evaluate(1.0), evaluate, coefficients


def _rk4(t: float, s: State, command: Command, p: Parameters, h: float) -> State:
    return _rk4_trajectory(t, s, command, p, h)[0]


def ground_height(x: float, terrain: tuple[Vector, ...]) -> float:
    if x <= terrain[0][0]: return terrain[0][1]
    if x >= terrain[-1][0]: return terrain[-1][1]
    for a, b in zip(terrain, terrain[1:]):
        if x <= b[0]:
            return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    raise AssertionError('unreachable')


def clearance(s: State, p: Parameters) -> tuple[float, Vector]:
    """Minimum clearance over hull edges and feet against piecewise-linear terrain."""
    _, c, _ = mass_properties(clip(s.fuel, 0, p.fuel_capacity), p)
    def transform(point):
        r = relative_point(point, c, s.theta)
        return (s.x + r[0], s.y + r[1])
    hull = tuple(map(transform, p.hull))
    points = list(hull) + [transform(point) for point in p.feet]
    for a, b in zip(hull, hull[1:] + hull[:1]):
        if a[0] != b[0]:
            for x, _ in p.terrain:
                fraction = (x - a[0]) / (b[0] - a[0])
                if 0 < fraction < 1:
                    points.append((x, a[1] + fraction * (b[1] - a[1])))
    return min(((y - ground_height(x, p.terrain), (x, y)) for x, y in points), key=lambda item: item[0])


@lru_cache(maxsize=128)
def _contact_geometry(terrain, hull, feet, dry_centroid, tank_bottom, tank_height,
                      dry_mass, fuel_capacity):
    """Cache geometry-only terms used by every contact search."""
    slopes = [abs((b[1] - a[1]) / (b[0] - a[0]))
              for a, b in zip(terrain, terrain[1:])]
    slope = max(slopes, default=0.0)
    # The mixture centroid lies between the dry centroid and the tank axis.
    fuel_ends = ((0.0, tank_bottom), (0.0, tank_bottom + tank_height / 2))
    references = (dry_centroid, *fuel_ends)
    points = (*hull, *feet)
    radius = max(hypot(point[0] - c[0], point[1] - c[1])
                 for point in points for c in references)
    centroid_span = max(hypot(dry_centroid[0] - c[0], dry_centroid[1] - c[1])
                        for c in fuel_ends)
    # Bound |dc/dfuel| for the tank, including the moving fuel centroid.
    centre_rate = centroid_span / dry_mass + tank_height / (2 * fuel_capacity)
    return slope, radius, centre_rate


def _contact_search(evaluate, coefficients, duration: float, p: Parameters):
    """Find first contact on the RK4 continuous extension, conservatively.

    Each transformed point has a bounded displacement derived from the
    cubic coefficients, tank geometry and terrain's maximum slope. A search
    interval can be rejected only when that bound proves it stays above the
    surface. Near a tangent, terminate on the safe side at time tolerance.
    """
    slope, radius, centre_rate = _contact_geometry(
        p.terrain, p.hull, p.feet, p.dry_centroid, p.tank_bottom,
        p.tank_height, p.dry_mass, p.fuel_capacity)
    def rate_bound(i):
        a, b, c = coefficients[i]
        return abs(a) + 2 * abs(b) + 3 * abs(c)
    bound = (slope * rate_bound(0) + rate_bound(1) + (1 + slope) *
             (radius * rate_bound(4) + centre_rate * rate_bound(6)))

    def search(lo, hi, distance):
        # Clearance is Lipschitz with this conservative bound, including
        # terrain corners sliding along an edge of the rigid hull.
        if distance > bound * (hi - lo):
            return None
        if (hi - lo) * duration <= p.event_tolerance:
            return lo
        mid = (lo + hi) / 2
        if mid == lo or mid == hi:
            return lo
        left = search(lo, mid, distance)
        if left is not None:
            return left
        return search(mid, hi, clearance(evaluate(mid), p)[0])

    fraction = search(0.0, 1.0, clearance(evaluate(0.0), p)[0])
    if fraction is None:
        return None
    return fraction, evaluate(fraction)


@dataclass(frozen=True)
class Contact:
    time: float
    state: State
    point: Vector


def step(t: float, s: State, command: Command, p: Parameters, h: float) -> tuple[State, Contact | None]:
    """Advance at most h, locating first contact and fuel/actuator limit events."""
    if not isfinite(h) or h <= 0 or not isfinite(t):
        raise ValueError('time and step must be finite, with positive step')
    if not all(isfinite(v) for v in s.values()) or not (0 <= s.fuel <= p.fuel_capacity and 0 <= s.thrust <= p.max_thrust and abs(s.gimbal) <= p.gimbal_max):
        raise ValueError('invalid initial state')
    if s.fuel == 0 and s.thrust != 0:
        raise ValueError('thrust must be zero without fuel')
    distance, point = clearance(s, p)
    if distance <= 0:
        if distance < 0:
            raise ValueError('initial hull penetrates terrain')
        return s, Contact(t, s, point)
    end = t + h
    if not isfinite(end) or end <= t:
        raise ValueError('step is not representable at the current time')
    while t < end:
        # A bounded actuator substep keeps RK4 stable even if the requested
        # physics step is much larger than an actuator response time.
        duration = min(end - t, p.thrust_tau, p.gimbal_tau)
        candidate, trajectory, coefficients = _rk4_trajectory(t, s, command, p, duration)
        def metrics(state):
            return (state.fuel if s.fuel > 0 else 1.0,
                    state.thrust, p.max_thrust - state.thrust,
                    p.gimbal_max - state.gimbal, p.gimbal_max + state.gimbal)
        start_metrics = metrics(s)
        end_metrics = metrics(candidate)
        events = []
        for i, (a, b) in enumerate(zip(start_metrics, end_metrics)):
            if a > 0 and b <= 0:
                lo, hi = 0.0, duration
                while hi - lo > p.event_tolerance:
                    mid = (lo + hi) / 2
                    if metrics(_rk4(t, s, command, p, mid))[i] > 0: lo = mid
                    else: hi = mid
                events.append((hi, i, lo))
        event_duration = min(events)[0] if events else duration
        if events:
            _, trajectory, coefficients = _rk4_trajectory(t, s, command, p, event_duration)
        contact = _contact_search(trajectory, coefficients, event_duration, p)
        if contact is not None:
            fraction, contact_state = contact
            return contact_state, Contact(t + fraction * event_duration, contact_state,
                                          clearance(contact_state, p)[1])
        if not events:
            if any(v < 0 for v in end_metrics):
                raise ArithmeticError('unresolved actuator or fuel boundary')
            s = candidate
            next_time = t + duration
            if next_time <= t:
                raise ArithmeticError('time cannot advance at this precision')
            t = next_time
            continue
        event_time, kind, _ = min(events)
        s = _rk4(t, s, command, p, event_time)
        values = list(s.values())
        if kind == 0: values[6], values[7] = 0.0, 0.0
        elif kind == 1: values[7] = 0.0
        elif kind == 2: values[7] = p.max_thrust
        elif kind == 3: values[8] = p.gimbal_max
        else: values[8] = -p.gimbal_max
        s = State(*values)
        next_time = t + event_time
        if next_time <= t:
            raise ArithmeticError('event time cannot advance at this precision')
        t = next_time
    if not all(isfinite(v) for v in s.values()):
        raise ArithmeticError('non-finite integration result')
    return s, None


def simulate(initial: State, actions: list[int], p: Parameters, start_time: float = 0.0):
    """Yield (time, state, contact); one held action per control interval."""
    t, s = start_time, initial
    yield t, s, None
    for action in actions:
        command = discrete_command(action, p)
        interval_end = t + p.control_interval
        if not isfinite(interval_end) or interval_end <= t:
            raise ValueError('control interval is not representable at the current time')
        while t < interval_end:
            h = min(p.timestep, interval_end - t)
            s, contact = step(t, s, command, p, h)
            t = contact.time if contact else t + h
            yield t, s, contact
            if contact: return
