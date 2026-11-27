"""
A basic neural network for the rocket control practical.

Final model from mytrain_experiments.ipynb: the past actuator values are removed (except the
actual thrust), and two groups of cheap physics features are added:
  - powered descent: what constant thrust would stop the rocket exactly at the ground
  - guidance: the sideways acceleration needed to arrive over the pad centre with no sideways
    speed, the tilt that would give it, and how far the rocket is from that tilt
"""

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]

# The sandbox calls this so don't change the name or signature.
def create_model():
    """Return a small PyTorch network that accepts raw observations."""
    import torch
    from torch import nn

    # 10 raw features (no actual thrust/gimbal) + 6 powered + 1 actual thrust + 6 guidance
    N_FEATURES = 23

    class RocketNetwork(nn.Module):
        def __init__(self):
            super().__init__()
            self.layers = nn.Sequential(
                # This lets torch handle input normalisation for you
                nn.BatchNorm1d(N_FEATURES),
                nn.Linear(N_FEATURES, 64),
                # Leaky ReLU was the best activation in the architecture comparison
                nn.LeakyReLU(0.05),
                nn.Linear(64, len(TARGETS)),
            )

        def gimbal_activation(self, x):
            return torch.tanh(x)

        def thrust_activation(self, x):
            # Straight-through clamp: exactly 0 switches the engine off, but the gradient still flows
            clamped = torch.clamp(x, min=0.0, max=1.0)
            return x + (clamped - x).detach()

        def mass_properties(self, fuel):
            """Mass, height of the centre of mass above the base and moment of inertia (rocket_physics.py).
            The fuel is a cylinder which fills the tank from the bottom."""
            fuel_height = 39.0 * fuel / 411000.0
            fuel_centre = 5.0 + fuel_height / 2
            mass = 28000.0 + fuel
            centre = (28000.0 * 23.0 + fuel * fuel_centre) / mass
            inertia = (5.60e6 + 28000.0 * (23.0 - centre) ** 2
                       + fuel * (3 * 1.78 ** 2 + fuel_height ** 2) / 12
                       + fuel * (fuel_centre - centre) ** 2)
            return mass, centre, inertia

        def features(self, observation):
            x, y, vx, vy, theta, omega, fuel = observation.unbind(dim=-1)[:7]
            mass, centre, inertia = self.mass_properties(fuel)

            # Height of the lowest foot (feet at +-9 m), kept above 0.5 m to avoid dividing by zero
            height = (y - centre * torch.cos(theta) - 9.0 * torch.abs(torch.sin(theta))).clamp(min=0.5)

            # Powered descent: the constant upward acceleration that stops the rocket exactly at the ground,
            # and the throttle command that would give it (0 = minimum thrust 482 kN, 1 = maximum 845 kN).
            accel_needed = 9.80665 + vy.clamp(max=0.0) ** 2 / (2 * height)
            throttle_needed = (accel_needed * mass - 482000.0) / (845000.0 - 482000.0)
            time_to_stop = -vy.clamp(max=0.0) / (845000.0 / mass - 9.80665)
            # How long full gimbal (5 degrees) would take to stop the current rotation
            omega_stop = omega / (845000.0 * 0.0872665 * centre / inertia)
            powered = torch.stack((height.log(), accel_needed, throttle_needed, time_to_stop,
                                   omega_stop, vx / height.sqrt()), dim=-1)

            # Guidance: assume a constant-deceleration burn from here, so touchdown is 2h/|vy| away.
            time_to_go = (2 * height / (-vy).clamp(min=0.5)).clamp(min=0.3, max=60.0)
            thrust_accel = accel_needed.clamp(min=482000.0 / mass, max=845000.0 / mass)
            # ZEM/ZEV optimal guidance: sideways acceleration to arrive at x = 0 with vx = 0
            accel_x_needed = (-6 * x / time_to_go ** 2 - 4 * vx / time_to_go).clamp(-3.0, 3.0)
            # Thrust pushes sideways by -thrust_accel * sin(theta), so this is the tilt that gives it
            theta_needed = torch.asin((-accel_x_needed / thrust_accel).clamp(-0.3, 0.3))
            theta_error = theta - theta_needed
            omega_needed = -theta_error / time_to_go.clamp(min=1.0)
            guidance = torch.stack((time_to_go.log(), accel_x_needed, theta_needed, theta_error,
                                    omega_needed, omega - omega_needed), dim=-1)

            return torch.cat((
                observation[..., :7], observation[..., 9:],   # raw features without actual thrust/gimbal
                powered,
                observation[..., 7:8] / 1e6,                   # actual thrust in MN
                guidance,
            ), dim=-1)

        def forward(self, observation):
            x = self.layers(self.features(observation))
            return torch.stack((
                        self.thrust_activation(x[..., 0]),
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)

    return RocketNetwork()
