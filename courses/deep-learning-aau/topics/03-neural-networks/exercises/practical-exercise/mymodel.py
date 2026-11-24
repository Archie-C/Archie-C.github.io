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
                nn.BatchNorm1d(len(FEATURES)),
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES), 64),
                nn.Dropout(0.2),
                nn.ReLU(),
                nn.Linear(64, 64),
                nn.Dropout(0.2),
                nn.ReLU(),
                nn.Linear(64, len(TARGETS)),
            )
        
        # Update these to use a torch activation function instead of just returning x
        def gimbal_activation(self, x):
            return torch.tanh(x)
        
        def thrust_activation(self, x):
            # The engine is only off for a command of exactly 0; any positive value
            # fires it at minimum thrust (~482 kN). Sigmoid never reaches 0, so clamp instead.
            # Straight-through: the output is clamped to [0, 1], but the gradient
            # passes as if unclamped, so a negative output can still learn to turn on.
            clamped = torch.clamp(x, 0.0, 1.0)
            return x + (clamped - x).detach()

        def features(self, observation):
            y = observation[..., 1]
            u_y = observation[..., 3]
            g = -9.80655
            # suvat solution for time to ground, assuming constant acceleration of gravity and no wind
            time_to_ground = - u_y / g + torch.sqrt(u_y**2 - 2 * g * y) / g
            projected_landing_x = observation[..., 0] + observation[..., 2] * time_to_ground
            projected_landing_v_y = u_y + g * time_to_ground
            # Remove observation 8 and 9
            return torch.cat((observation[..., :8], observation[..., 10:], time_to_ground.unsqueeze(-1), projected_landing_v_y, projected_landing_x), dim=-1)

        def forward(self, observation):
            x = self.layers(observation)

            # Keep the unclamped thrust so training can push engine-off rows clearly below 0.
            self.raw_thrust = x[..., 0]
            # This stacks the outputs of the two activation functions along the last dimension
            # so that the output has shape (batch_size, 2) where the first column is thrust and the second column is gimbal.
            return torch.stack((
                        self.thrust_activation(x[..., 0]), 
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)


    return RocketNetwork()
