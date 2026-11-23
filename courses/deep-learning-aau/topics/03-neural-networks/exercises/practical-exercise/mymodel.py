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
                nn.BatchNorm1d(len(FEATURES) + 12),
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES) + 12, 32), 
                nn.ReLU(),
                nn.Linear(32, len(TARGETS)),
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

        def create_features(self, observation):
            # observation: (batch_size, len(FEATURES)) tensor
            # Features are only inputs, so no gradients are needed through the projection.
            with torch.no_grad():
                projections = self.project(observation)
            return torch.cat([observation, *projections], dim=-1)

        def project(self, observation):
            """Project a short trajectory under gravity and drag (as in 06_drag.py).

            Returns a list of three (batch_size, 4) tensors holding
            [y, vy, theta, omega] after 1, 2 and 3 seconds.
            The rocket stops moving once it first touches the ground.
            """
            X = observation
            h, vx, vy = X[:, 1], X[:, 2], X[:, 3]
            theta, omega = X[:, 4], X[:, 5]
            wind_x, wind_y = X[:, 9], X[:, 10]
            air_density = torch.clamp(X[:, 11], min=0)

            # Mass, centre of mass and moment of inertia depend on the remaining fuel.
            fuel = torch.clamp(X[:, 6], 0, 411000)
            mass = 28000 + fuel
            fh = 39 * fuel / 411000
            fc = 5 + fh / 2
            centre = (28000 * 23 + fuel * fc) / mass
            inertia = (5.60e6 + 28000 * (23 - centre) ** 2
                       + fuel * (3 * 1.78 ** 2 + fh ** 2) / 12 + fuel * (fc - centre) ** 2)

            # Hull and feet outline used for a flat-pad first-contact estimate.
            points = torch.tensor([[-1.83, 1.60], [1.83, 1.60], [1.83, 43.60],
                                   [1.65, 45.20], [1.65, 48.768], [-1.65, 48.768],
                                   [-1.65, 45.20], [-1.83, 43.60], [-9, 0], [9, 0]],
                                  dtype=X.dtype, device=X.device)

            def clearance(y, angle):
                offsets = (torch.sin(angle)[:, None] * points[:, 0]
                           + torch.cos(angle)[:, None] * (points[:, 1] - centre[:, None]))
                return y + offsets.min(dim=1).values

            active = clearance(h, theta) > 0
            outputs = []
            dt = 0.25
            for step in range(12):
                # Drag from the velocity relative to the wind with an angle-dependent coefficient.
                rx, ry = vx - wind_x, vy - wind_y
                speed = torch.hypot(rx, ry)
                tail_x, tail_y = torch.sin(theta), -torch.cos(theta)
                aoa = torch.atan2(tail_x * ry - tail_y * rx, tail_x * rx + tail_y * ry)
                cd = 0.65 + 15 * torch.sin(aoa) ** 2
                factor = 0.5 * air_density * 10.5209 * cd * speed
                fx, fy = -factor * rx, -factor * ry

                ax = fx / mass
                ay = -9.80665 + fy / mass
                angular = (37 - centre) * (-torch.sin(theta) * fy - torch.cos(theta) * fx) / inertia

                # Approximate first contact by interpolating across this integration step.
                nh = h + vy * dt + 0.5 * ay * dt ** 2
                nt = theta + omega * dt + 0.5 * angular * dt ** 2
                old_gap, new_gap = clearance(h, theta), clearance(nh, nt)
                hit = active & (new_gap <= 0)
                denom = torch.where(hit, old_gap - new_gap, torch.ones_like(old_gap))
                fraction = torch.where(hit, torch.clamp(old_gap / denom, 0, 1),
                                       torch.ones_like(old_gap))
                duration = dt * fraction * active.to(X.dtype)

                # Out-of-place updates so the input observation is never modified.
                h = h + vy * duration + 0.5 * ay * duration ** 2
                theta = theta + omega * duration + 0.5 * angular * duration ** 2
                vx = vx + ax * duration
                vy = vy + ay * duration
                omega = omega + angular * duration
                active = active & ~hit

                if step in (3, 7, 11):
                    outputs.append(torch.stack((h, vy, theta, omega), dim=-1))

            return outputs

        def forward(self, observation):
            device = self.layers[0].weight.device
            observation = torch.as_tensor(observation, dtype=torch.float32, device=device)
            # Support a single unbatched observation of shape (len(FEATURES),)
            unbatched = observation.dim() == 1
            if unbatched:
                observation = observation.unsqueeze(0)

            features = self.create_features(observation)
            x = self.layers(features)
            if unbatched:
                x = x.squeeze(0)
            # Keep the unclamped thrust so training can push engine-off rows clearly below 0.
            self.raw_thrust = x[..., 0]
            # This stacks the outputs of the two activation functions along the last dimension
            # so that the output has shape (batch_size, 2) where the first column is thrust and the second column is gimbal.
            return torch.stack((
                        self.thrust_activation(x[..., 0]), 
                        self.gimbal_activation(x[..., 1])
                    ), dim=-1)


    return RocketNetwork()
