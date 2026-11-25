"""
A basic neural network for the rocket control practical.
"""

FEATURES = [
    "x", "y", "vx", "vy", "theta", "omega", "fuel_mass", "actual_thrust",
    "actual_gimbal", "wind_x", "wind_y", "air_density",
]
TARGETS = ["thrust", "gimbal"]

# The sandbox calls this so don't change the name or signature.
def create_model():
    """Return a small PyTorch network that accepts raw observations."""
    # PyTorch is required when training or evaluating the model.
    import torch
    from torch import nn
    # You may also want to use the following
    # from torch.nn import functional as F

    # Some useful PyTorch functions:
    # nn.Sequential: a container for a sequence of layers
    # nn.BatchNorm1d: normalize features using batch statistics and a learned scale and offset
    # nn.Linear: a fully connected layer: Wx + b
    # nn.ReLU: a ReLU activation function
    # nn.Tanh: a tanh activation function
    # nn.Sigmoid: a sigmoid activation function
    # nn.Module: the base class for all PyTorch models
    
    # For use in the forward pass or in the activation functions, you can use the following:
    # torch.stack: stack tensors along a new dimension
    # torch.relu: apply the ReLU function elementwise
    # torch.tanh: apply the tanh function elementwise
    # torch.sigmoid: apply the sigmoid function elementwise

    class RocketNetwork(nn.Module):
        def __init__(self):
            super().__init__()
            # You can add more layers in the nn.Sequential container below. 
            # The first layer should have len(FEATURES) input features and 
            # the last layer should have len(TARGETS) output features.
            # The layers between should have input and output features that match 
            # For example, the 32 out and 32 in match in this example.
            # Add more layers by just adding more nn.(some function) lines in the nn.Sequential container.
            self.layers = nn.Sequential(
                # This lets torch handle input normalisation for you
                nn.BatchNorm1d(len(FEATURES)-2), 
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES)-2, 32), 
                nn.ReLU(),
                nn.Linear(32, 32),
                nn.ReLU(),
                nn.Dropout(p=0.5),
                nn.Linear(32, len(TARGETS)),
            )
        
        
        def gimbal_activation(self, x):
            return torch.tanh(x)
        
        def thrust_activation(self, x):
            clamped = torch.clamp(x, min=0.0, max=1.0)
            return x + (clamped - x).detach()
        
        def features(self, observation):
            # Remove the middle features (actual_thrust, actual_gimbal)
            return torch.cat((observation[..., :7], observation[..., 9:]), dim=-1)

        def forward(self, observation):
            x = self.layers(self.features(observation))
            # This stacks the outputs of the two activation functions along the last dimension
            # so that the output has shape (batch_size, 2) where the first column is thrust and the second column is gimbal.
            return torch.stack((
                        self.thrust_activation(x[..., 0]), 
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)


    return RocketNetwork()
