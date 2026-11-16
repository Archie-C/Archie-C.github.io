"""Example submission architecture for the practical's training notebook.

The saved state must contain the network weights and the training-set feature
mean and standard deviation. See the submission instructions on the page.
"""
import torch
from torch import nn


class RocketNetwork(nn.Module):
    def __init__(self):
        super().__init__()
        self.hidden = nn.Linear(12, 32)
        self.output = nn.Linear(32, 2)

    def forward(self, x):
        x = torch.relu(self.hidden(x))
        x = self.output(x)
        return torch.stack((torch.sigmoid(x[..., 0]), torch.tanh(x[..., 1])), dim=-1)


class SubmissionModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer('mean', torch.zeros(12))
        self.register_buffer('std', torch.ones(12))
        self.network = RocketNetwork()

    def forward(self, observation):
        return self.network((observation - self.mean) / self.std)


def create_model():
    return SubmissionModel()
