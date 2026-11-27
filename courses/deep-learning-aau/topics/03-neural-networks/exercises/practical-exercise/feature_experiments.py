"""
Every feature set and architecture tried in mytrain_experiments.ipynb, behind one create_model.

This file is for experiments only. The sandbox calls create_model() with no arguments, so the
defaults are the final model, but submit guidance_features.py instead: it is the same network
written out on its own without the experiment switches.

None of the features have learnable weights, so they can be computed once for the whole dataset
before training (see the notebook) instead of on every batch.
"""
import torch
from torch import nn

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]

# Simulator constants (rocket_calibration.py)
G = 9.80665
MIN_THRUST, MAX_THRUST = 482000.0, 845000.0
GIMBAL_MAX = 0.0872665  # 5 degrees in radians


# ---------------------------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------------------------
def mass_properties(fuel):
    """Mass, height of the centre of mass above the base and moment of inertia.
    The fuel is a cylinder which fills the tank from the bottom.
    (The numbers are written out because torch.jit.script cannot use global float constants.)"""
    fuel_height = 39.0 * fuel / 411000.0
    fuel_centre = 5.0 + fuel_height / 2
    mass = 28000.0 + fuel
    centre = (28000.0 * 23.0 + fuel * fuel_centre) / mass
    inertia = (5.60e6 + 28000.0 * (23.0 - centre) ** 2
               + fuel * (3 * 1.78 ** 2 + fuel_height ** 2) / 12
               + fuel * (fuel_centre - centre) ** 2)
    return mass, centre, inertia


def base_height(y, theta, centre):
    """Height of the lowest landing foot. The feet are at (+-9, 0) in body coordinates."""
    return y - centre * torch.cos(theta) - 9.0 * torch.abs(torch.sin(theta))


def past_removed(obs):
    """The 18/50 model: drop actual_thrust and actual_gimbal (10 features)."""
    return torch.cat((obs[..., :7], obs[..., 9:]), dim=-1)


# ---------------------------------------------------------------------------------------------
# Engine-off landing prediction (same maths as acceleration_features.py, written as flat
# functions so torch.jit.script can compile it)
# ---------------------------------------------------------------------------------------------
def engine_off_accelerations(vx, vy, theta, omega, wind_x, wind_y, density, mass, arm, inertia):
    relative_x, relative_y = vx - wind_x, vy - wind_y
    speed = torch.sqrt(relative_x * relative_x + relative_y * relative_y).clamp(min=1e-6)
    s, c = torch.sin(theta), torch.cos(theta)
    sin_alpha = (s * relative_y + c * relative_x) / speed
    cos_alpha = (s * relative_x - c * relative_y) / speed
    drag = 0.65 + 15.0 * sin_alpha * sin_alpha
    lift = -1.2 * sin_alpha * cos_alpha
    pressure_area = 0.5 * 10.5209 * density * speed
    force_x = pressure_area * (-drag * relative_x - lift * relative_y)
    force_y = pressure_area * (-drag * relative_y + lift * relative_x)
    torque = (-arm * (s * force_y + c * force_x)
              - pressure_area * speed * (48.768 ** 2 * 0.3) * omega / speed.clamp(min=1.0))
    return force_x / mass, force_y / mass - 9.80665, torque / inertia


def suvat_time_to_ground(y, vy, theta, accel_y, centre):
    accel_y = accel_y.clamp(max=-1.0)
    height = base_height(y, theta, centre).clamp(min=0.0)
    return (-vy - torch.sqrt((vy * vy - 2 * accel_y * height).clamp(min=0.0))) / accel_y


def engine_off_landing(obs: torch.Tensor, steps: int = 8) -> torch.Tensor:
    """Time to ground, landing vy, x, angle and angular velocity if the engine stayed off.
    `steps` RK2 pieces, each taking 1/(pieces left) of the remaining suvat time."""
    x, y, vx, vy, theta, omega, fuel = obs[:, 0], obs[:, 1], obs[:, 2], obs[:, 3], obs[:, 4], obs[:, 5], obs[:, 6]
    wind_x, wind_y, density0 = obs[:, 9], obs[:, 10], obs[:, 11]
    mass, centre, inertia = mass_properties(fuel)
    arm = 37.0 - centre
    start = y.clamp(min=0.0)
    elapsed = torch.zeros_like(x)
    for i in range(steps):
        left = steps - i
        ax, ay, aw = engine_off_accelerations(vx, vy, theta, omega, wind_x, wind_y,
                                              density0 * torch.exp((start - y.clamp(min=0.0)) / 8500.0), mass, arm, inertia)
        dt = suvat_time_to_ground(y, vy, theta, ay, centre) / left
        half = dt / 2
        my = y + vy * half
        mvx, mvy = vx + ax * half, vy + ay * half
        mtheta, momega = theta + omega * half, omega + aw * half
        ax, ay, aw = engine_off_accelerations(mvx, mvy, mtheta, momega, wind_x, wind_y,
                                              density0 * torch.exp((start - my.clamp(min=0.0)) / 8500.0), mass, arm, inertia)
        x, y = x + mvx * dt, y + mvy * dt
        vx, vy = vx + ax * dt, vy + ay * dt
        theta, omega = theta + momega * dt, omega + aw * dt
        elapsed = elapsed + dt
    ax, ay, aw = engine_off_accelerations(vx, vy, theta, omega, wind_x, wind_y,
                                          density0 * torch.exp((start - y.clamp(min=0.0)) / 8500.0), mass, arm, inertia)
    dt = suvat_time_to_ground(y, vy, theta, ay, centre)
    return torch.stack((elapsed + dt, vy + ay.clamp(max=-1.0) * dt, x + vx * dt + 0.5 * ax * dt * dt,
                        theta + omega * dt + 0.5 * aw * dt * dt, omega + aw * dt), dim=1)


# ---------------------------------------------------------------------------------------------
# Cheap closed-form features (a few dozen ops instead of thousands)
# ---------------------------------------------------------------------------------------------
def powered(obs):
    """Suicide-burn features: what constant thrust would stop the descent exactly at the ground."""
    y, vx, vy, theta, omega, fuel = obs[:, 1], obs[:, 2], obs[:, 3], obs[:, 4], obs[:, 5], obs[:, 6]
    mass, centre, inertia = mass_properties(fuel)
    height = base_height(y, theta, centre).clamp(min=0.5)
    accel_needed = G + vy.clamp(max=0.0) ** 2 / (2 * height)                          # upward accel to stop at the ground
    throttle_needed = (accel_needed * mass - MIN_THRUST) / (MAX_THRUST - MIN_THRUST)  # the command that gives it
    time_to_stop = -vy.clamp(max=0.0) / (MAX_THRUST / mass - G)                       # time to stop at full thrust
    omega_stop = omega / (MAX_THRUST * GIMBAL_MAX * centre / inertia)                 # time for full gimbal to stop the rotation
    return torch.stack((height.log(), accel_needed, throttle_needed, time_to_stop, omega_stop, vx / height.sqrt()), dim=1)


def touchdown(obs):
    """Projections to touchdown assuming a constant-deceleration burn from here (t = 2h/|vy|)."""
    x, y, vx, vy, theta, omega, fuel = obs[:, 0], obs[:, 1], obs[:, 2], obs[:, 3], obs[:, 4], obs[:, 5], obs[:, 6]
    mass, centre, inertia = mass_properties(fuel)
    height = base_height(y, theta, centre).clamp(min=0.5)
    t = (2 * height / (-vy).clamp(min=0.5)).clamp(max=60.0)
    landing_x = x + vx * t / 2
    return torch.stack((t.log(), landing_x, theta + omega * t, landing_x / height.sqrt(), omega * t.sqrt()), dim=1)


def _guidance_common(obs):
    x, y, vx, vy, theta, omega, fuel = obs[:, 0], obs[:, 1], obs[:, 2], obs[:, 3], obs[:, 4], obs[:, 5], obs[:, 6]
    mass, centre, inertia = mass_properties(fuel)
    height = base_height(y, theta, centre).clamp(min=0.5)
    time_to_go = (2 * height / (-vy).clamp(min=0.5)).clamp(min=0.3, max=60.0)
    accel_needed = G + vy.clamp(max=0.0) ** 2 / (2 * height)
    thrust_accel = accel_needed.clamp(min=MIN_THRUST / mass, max=MAX_THRUST / mass)
    return x, vx, vy, theta, omega, time_to_go, thrust_accel


def attitude(obs):
    """Direction of travel (air-relative, 0 = straight down) and the angle between it and the body."""
    x, vx, vy, theta, omega, time_to_go, thrust_accel = _guidance_common(obs)
    gamma = torch.atan2(vx - obs[:, 9], -(vy - obs[:, 10]))
    return torch.stack((gamma, theta - gamma), dim=1)


def guidance(obs):
    """ZEM/ZEV guidance to x=0, vx=0 at touchdown, the tilt that would deliver it and the rotation
    rate that would reach that tilt in time."""
    x, vx, vy, theta, omega, time_to_go, thrust_accel = _guidance_common(obs)
    accel_x_needed = (-6 * x / time_to_go ** 2 - 4 * vx / time_to_go).clamp(-3.0, 3.0)
    theta_needed = torch.asin((-accel_x_needed / thrust_accel).clamp(-0.3, 0.3))  # accel_x = -thrust_accel * sin(theta)
    theta_error = theta - theta_needed
    omega_needed = -theta_error / time_to_go.clamp(min=1.0)
    return torch.stack((time_to_go.log(), accel_x_needed, theta_needed, theta_error, omega_needed, omega - omega_needed), dim=1)


def pd(obs):
    """Tilt a few seconds ahead at the current rotation rate."""
    theta, omega = obs[:, 4], obs[:, 5]
    return torch.stack((theta + omega, theta + 2 * omega, theta + 4 * omega), dim=1)


def actual_thrust(obs):
    return obs[:, 7:8] / 1e6


def actual_gimbal(obs):
    return obs[:, 8:9] / GIMBAL_MAX


# ---------------------------------------------------------------------------------------------
# Feature sets, in the order they appear in the notebook
# ---------------------------------------------------------------------------------------------
FEATURE_SETS = {
    "past_removed":                 lambda o: past_removed(o),
    "engine_off":                   lambda o: torch.cat((past_removed(o), engine_off_landing(o)), -1),
    "engine_off_powered":           lambda o: torch.cat((past_removed(o), engine_off_landing(o), powered(o)), -1),
    "powered":                      lambda o: torch.cat((past_removed(o), powered(o)), -1),
    "powered_touchdown":            lambda o: torch.cat((past_removed(o), powered(o), touchdown(o)), -1),
    "powered_actual_gimbal":        lambda o: torch.cat((past_removed(o), powered(o), actual_gimbal(o)), -1),
    "powered_actual_thrust":        lambda o: torch.cat((past_removed(o), powered(o), actual_thrust(o)), -1),
    "powered_attitude":             lambda o: torch.cat((past_removed(o), powered(o), attitude(o)), -1),
    "powered_guidance":             lambda o: torch.cat((past_removed(o), powered(o), guidance(o)), -1),
    "powered_pd":                   lambda o: torch.cat((past_removed(o), powered(o), pd(o)), -1),
    "powered_all":                  lambda o: torch.cat((past_removed(o), powered(o), attitude(o), guidance(o), pd(o)), -1),
    "powered_actual_thrust_guidance": lambda o: torch.cat((past_removed(o), powered(o), actual_thrust(o), guidance(o)), -1),
    "powered_guidance_touchdown":   lambda o: torch.cat((past_removed(o), powered(o), guidance(o), touchdown(o)), -1),
    # Raw x, vx, theta and omega swapped for the guidance terms
    "guidance_only":                lambda o: torch.cat((o[:, 1:2], o[:, 3:4], o[:, 6:7], o[:, 9:], powered(o), guidance(o)), -1),
}

ACTIVATIONS = {"relu": nn.ReLU, "tanh": nn.Tanh, "silu": nn.SiLU, "leaky": lambda: nn.LeakyReLU(0.05)}


def _mlp(n_in, hidden, activation, n_out, dropout=0.0, layernorm=False):
    layers, width = [], n_in
    for h in hidden:
        layers.append(nn.Linear(width, h))
        if layernorm:
            layers.append(nn.LayerNorm(h))
        layers.append(ACTIVATIONS[activation]())
        if dropout:
            layers.append(nn.Dropout(dropout))
        width = h
    layers.append(nn.Linear(width, n_out))
    return nn.Sequential(*layers)


class _Residual(nn.Module):
    def __init__(self, width, activation):
        super().__init__()
        self.block = nn.Sequential(nn.Linear(width, width), ACTIVATIONS[activation](), nn.Linear(width, width))
        self.activation = ACTIVATIONS[activation]()

    def forward(self, x):
        return self.activation(x + self.block(x))


class _Split(nn.Module):
    """Separate networks for thrust and gimbal."""
    def __init__(self, n_in, hidden, activation):
        super().__init__()
        self.thrust = _mlp(n_in, hidden, activation, 1)
        self.gimbal = _mlp(n_in, hidden, activation, 1)

    def forward(self, x):
        return torch.cat((self.thrust(x), self.gimbal(x)), dim=-1)


class RocketNetwork(nn.Module):
    def __init__(self, feature_set, hidden, activation, dropout, layernorm, residual, split):
        super().__init__()
        self.feature_set = feature_set
        n = FEATURE_SETS[feature_set](torch.zeros(2, len(FEATURES))).shape[-1]
        if split:
            body = _Split(n, hidden, activation)
        elif residual:
            width = hidden[0]
            body = nn.Sequential(nn.Linear(n, width), ACTIVATIONS[activation](),
                                 *[_Residual(width, activation) for _ in range(residual)], nn.Linear(width, 2))
        else:
            body = _mlp(n, hidden, activation, 2, dropout, layernorm)
        self.layers = nn.Sequential(nn.BatchNorm1d(n), body)

    def features(self, observation):
        return FEATURE_SETS[self.feature_set](observation)

    def forward(self, observation):
        x = self.layers(self.features(observation))
        thrust = x[..., 0]
        thrust = thrust + (thrust.clamp(0.0, 1.0) - thrust).detach()  # straight-through clamp
        return torch.stack((thrust, torch.tanh(x[..., 1])), dim=-1)


def create_model(feature_set="powered_actual_thrust_guidance", hidden=(64,), activation="leaky",
                 dropout=0.0, layernorm=False, residual=0, split=False):
    return RocketNetwork(feature_set, tuple(hidden), activation, dropout, layernorm, residual, split)
