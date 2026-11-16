"""A basic neural network for the rocket control practical.

Train create_model() with raw observations. The model stores normalization as
part of its state. The notebook exports this file as model.py for submission
for submission with its safetensors weights.
"""

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]


def create_model():
    """Return a small PyTorch network that accepts raw observations."""
    # PyTorch is required when training or evaluating the model.
    import torch
    from torch import nn

    class RocketNetwork(nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("mean", torch.zeros(len(FEATURES)))
            self.register_buffer("std", torch.ones(len(FEATURES)))
            self.hidden = nn.Linear(len(FEATURES), 32)
            self.output = nn.Linear(32, len(TARGETS))

        def forward(self, observation):
            x = (observation - self.mean) / self.std
            x = torch.relu(self.hidden(x))
            x = self.output(x)
            return torch.stack((torch.sigmoid(x[..., 0]), torch.tanh(x[..., 1])), dim=-1)

    return RocketNetwork()
