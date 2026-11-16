"""A small PyTorch rocket controller with NumPy inference for the browser.

Train a model with create_model(), then save it with Controller.save(). The
browser loads the exported .npz file without needing PyTorch.
"""
import numpy as np

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]


def create_model():
    """Create the network for training. PyTorch is only needed locally."""
    import torch
    from torch import nn

    class RocketNetwork(nn.Module):
        def __init__(self):
            super().__init__()
            self.hidden = nn.Linear(len(FEATURES), 32)
            self.output = nn.Linear(32, len(TARGETS))

        def forward(self, x):
            x = torch.relu(self.hidden(x))
            x = self.output(x)
            return torch.stack((torch.sigmoid(x[..., 0]), torch.tanh(x[..., 1])), dim=-1)

    return RocketNetwork()


class Controller:
    """Load exported weights and predict one action for the simulator."""

    def __init__(self):
        self.weights = None

    def save(self, path, model, mean, std):
        """Export the trained network and training-set feature statistics."""
        state = model.state_dict()
        arrays = {name: value.detach().cpu().numpy() for name, value in state.items()}
        np.savez(path, mean=np.asarray(mean), std=np.asarray(std), **arrays)

    def load(self, path):
        with np.load(path, allow_pickle=False) as saved:
            self.weights = {name: saved[name].copy() for name in saved.files}
        return self

    def predict_action(self, observation):
        if self.weights is None:
            raise ValueError("Load a trained weights file before evaluating the controller")
        w = self.weights
        x = (np.asarray(observation, dtype=np.float32) - w["mean"]) / w["std"]
        x = np.maximum(0, w["hidden.weight"] @ x + w["hidden.bias"])
        x = w["output.weight"] @ x + w["output.bias"]
        thrust = 1.0 / (1.0 + np.exp(-np.clip(x[0], -80, 80)))
        return float(thrust), float(np.tanh(x[1]))
