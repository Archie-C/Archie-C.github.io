"""
A basic neural network for the rocket control practical.

Final model from mytrain_experiments.ipynb: an ensemble of 15 small networks that all see the same features.
The past actuator values are removed and the powered descent features are added (what constant thrust
would stop the rocket exactly at the ground). Every network was trained the same way with a different seed,
and the ensemble averages their outputs before the thrust clamp and the gimbal tanh.
"""

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]

# How many networks are averaged
N_MEMBERS = 15

# The sandbox calls this so don't change the name or signature.
def create_model():
    """Return a small PyTorch network that accepts raw observations."""
    import torch
    from torch import nn

    # 10 raw features (no actual thrust/gimbal) + 6 powered
    N_FEATURES = 16

    def member():
        # The same layout as the experiment models, so their trained weights load straight in
        return nn.Sequential(
            # This lets torch handle input normalisation for you
            nn.BatchNorm1d(N_FEATURES),
            nn.Sequential(
                nn.Linear(N_FEATURES, 32),
                nn.ReLU(),
                nn.Linear(32, len(TARGETS)),
            ),
        )

    class RocketNetwork(nn.Module):
        def __init__(self):
            super().__init__()
            self.members = nn.ModuleList([member() for _ in range(N_MEMBERS)])

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

            return torch.cat((
                observation[..., :7], observation[..., 9:],   # raw features without actual thrust/gimbal
                powered,
            ), dim=-1)

        def forward(self, observation):
            features = self.features(observation)
            # Average the raw outputs of every network, then the same activations as a single model
            x = torch.stack([network(features) for network in self.members]).mean(dim=0)
            return torch.stack((
                        self.thrust_activation(x[..., 0]),
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)

    return RocketNetwork()
