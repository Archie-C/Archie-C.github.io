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
                nn.BatchNorm1d(len(FEATURES)-2+3), 
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES)-2+3, 32), 
                nn.ReLU(),
                nn.Linear(32, len(TARGETS)),
            )
        
        
        def gimbal_activation(self, x):
            return torch.tanh(x)
        
        def thrust_activation(self, x):
            clamped = torch.clamp(x, min=0.0, max=1.0)
            return x + (clamped - x).detach()
        
        def landing_prediction(self, observation):
            """Time to ground, landing vy and landing x if the engine stayed off from now on.

            Gravity, drag and lift give the current acceleration, using the simulator's own equations (see forces
            and mass_properties in rocket_physics.py, and the constants in rocket_calibration.py). That acceleration
            is assumed to stay constant until landing. The current thrust and gimbal are deliberately not used.
            """
            x, y, vx, vy, theta, _, fuel, _, _, wind_x, wind_y, air_density = observation.unbind(dim=-1)

            # Mass and height of the centre of mass above the base.
            # The fuel is a cylinder which fills the tank from the bottom.
            fuel_height = 39.0 * fuel / 411000.0
            fuel_centre = 5.0 + fuel_height / 2
            mass = 28000.0 + fuel
            centre = (28000.0 * 23.0 + fuel * fuel_centre) / mass

            # Drag and lift depend on the velocity relative to the wind and the angle of attack, alpha.
            relative_x, relative_y = vx - wind_x, vy - wind_y
            speed = torch.sqrt(relative_x ** 2 + relative_y ** 2).clamp(min=1e-6) # Avoid division by zero
            sin_theta, cos_theta = torch.sin(theta), torch.cos(theta)
            sin_alpha = (sin_theta * relative_y + cos_theta * relative_x) / speed
            cos_alpha = (sin_theta * relative_x - cos_theta * relative_y) / speed
            drag_coefficient = 0.65 + 15.0 * sin_alpha ** 2
            lift_coefficient = -0.6 * 2 * sin_alpha * cos_alpha
            # Dynamic pressure times area, divided by speed because it multiplies the velocity components below.
            pressure_area = 0.5 * air_density * speed * 10.5209
            aero_x = pressure_area * (-drag_coefficient * relative_x - lift_coefficient * relative_y)
            aero_y = pressure_area * (-drag_coefficient * relative_y + lift_coefficient * relative_x)

            accel_x = aero_x / mass
            # Always falling, otherwise there might be no landing to predict.
            accel_y = (aero_y / mass - 9.80665).clamp(max=-1.0)

            # y is the height of the centre of mass, so this is the height of the rocket's base.
            # This ignores tilt, which puts one foot lower than the other.
            height = (y - centre).clamp(min=0.0)

            # suvat: 0 = height + vy*t + 0.5*accel_y*t^2. accel_y < 0, so the minus root is the future one.
            root = torch.sqrt(vy ** 2 - 2 * accel_y * height)
            time_to_ground = (-vy - root) / accel_y
            landing_vy = -root # same as vy + accel_y * time_to_ground
            landing_x = x + vx * time_to_ground + 0.5 * accel_x * time_to_ground ** 2

            return torch.stack((time_to_ground, landing_vy, landing_x), dim=-1)

        def features(self, observation):
            # Remove the middle features (actual_thrust, actual_gimbal), and add the 3 engine-off landing predictions.
            return torch.cat((observation[..., :7], observation[..., 9:], self.landing_prediction(observation)), dim=-1)

        def forward(self, observation):
            x = self.layers(self.features(observation))
            # This stacks the outputs of the two activation functions along the last dimension
            # so that the output has shape (batch_size, 2) where the first column is thrust and the second column is gimbal.
            return torch.stack((
                        self.thrust_activation(x[..., 0]), 
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)


    return RocketNetwork()
