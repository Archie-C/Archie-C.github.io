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
                nn.BatchNorm1d(len(FEATURES)-2+3),
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES)-2+3, 64),
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
            x, y = observation[..., 0], observation[..., 1]
            u_x, u_y = observation[..., 2], observation[..., 3]
            g = -9.80665
            # 0 = y + u_y*t + 0.5*g*t^2; g < 0, so the minus root is the future one
            root = torch.sqrt(torch.clamp(u_y**2 - 2 * g * y, min=0.0))
            time_to_ground = (-u_y - root) / g
            projected_landing_x = x + u_x * time_to_ground
            projected_landing_v_y = -root  # same as u_y + g * time_to_ground
            extra = torch.stack(
                (time_to_ground, projected_landing_v_y, projected_landing_x), dim=-1
            )
            # Drop wind_x (9) and wind_y (10)
            return torch.cat((observation[..., :7], observation[..., 9:], extra), dim=-1)

        def forward(self, observation):
            x = self.features(observation)
            x = self.layers(x)

            # Keep the unclamped thrust so training can push engine-off rows clearly below 0.
            self.raw_thrust = x[..., 0]
            # This stacks the outputs of the two activation functions along the last dimension
            # so that the output has shape (batch_size, 2) where the first column is thrust and the second column is gimbal.
            return torch.stack((
                        self.thrust_activation(x[..., 0]), 
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)


    return RocketNetwork()
