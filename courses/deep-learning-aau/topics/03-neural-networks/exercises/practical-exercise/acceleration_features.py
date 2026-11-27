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
                nn.BatchNorm1d(len(FEATURES)-2+5),
                # Linear is in the form (number_of_input_features, number_of_output_features)
                nn.Linear(len(FEATURES)-2+5, 32),
                nn.ReLU(),
                nn.Linear(32, len(TARGETS)),
            )
        
        
        def gimbal_activation(self, x):
            return torch.tanh(x)
        
        def thrust_activation(self, x):
            clamped = torch.clamp(x, min=0.0, max=1.0)
            return x + (clamped - x).detach()
        
        def engine_off_accelerations(self, vx, vy, theta, omega, wind_x, wind_y, air_density, mass, centre, inertia):
            """Linear and angular acceleration with the engine off: gravity, drag, lift, aero torque and damping.

            These are the simulator's own equations (see forces and derivative in rocket_physics.py, and the
            constants in rocket_calibration.py) with the thrust set to zero.
            """
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
            accel_y = aero_y / mass - 9.80665

            # Drag and lift act at the centre of pressure, 37 m up the body, so they turn the rocket about its
            # centre of mass. The cross product of the lever arm (-arm*sin(theta), arm*cos(theta)) with the force.
            arm = 37.0 - centre
            aero_torque = -arm * (sin_theta * aero_y + cos_theta * aero_x)
            # Pitch damping resists rotation: -q * area * length * cmq * omega * length / (2 * speed).
            damping = -pressure_area * speed * 48.768 ** 2 * 0.6 * omega / (2 * speed.clamp(min=1.0))
            angular_accel = (aero_torque + damping) / inertia

            return accel_x, accel_y, angular_accel

        def base_height(self, y, theta, centre):
            """Height of the lowest landing foot. The feet are at (+-9, 0) in body coordinates."""
            return y - centre * torch.cos(theta) - 9.0 * torch.abs(torch.sin(theta))

        def time_to_ground(self, y, vy, theta, accel_y, centre):
            """suvat time until the lowest foot reaches the ground, holding accel_y constant."""
            # Always falling, otherwise there might be no landing to predict.
            accel_y = accel_y.clamp(max=-1.0)
            height = self.base_height(y, theta, centre).clamp(min=0.0)
            # 0 = height + vy*t + 0.5*accel_y*t^2. accel_y < 0, so the minus root is the future one.
            root = torch.sqrt((vy ** 2 - 2 * accel_y * height).clamp(min=0.0))
            return (-vy - root) / accel_y

        def landing_prediction(self, observation, steps=8):
            """Time to ground, landing vy, landing x, landing angle and landing angular velocity if the engine
            stayed off from now on.

            Rather than assuming today's acceleration lasts until landing, the flight is split into `steps`
            pieces. Each piece re-estimates the time left with suvat, takes 1/(pieces left) of it, and moves the
            whole state (position, velocity, angle and angular velocity) forward with a midpoint (RK2) step,
            recomputing drag, lift, torque and air density along the way. A last suvat step closes the small gap
            to the ground. The wind is held at its current value because only the current wind is observed.
            The current thrust and gimbal are deliberately not used.
            """
            x, y, vx, vy, theta, omega, fuel, _, _, wind_x, wind_y, air_density = observation.unbind(dim=-1)

            # Mass, height of the centre of mass above the base and moment of inertia (mass_properties).
            # The fuel is a cylinder which fills the tank from the bottom. With the engine off it stays constant.
            fuel_height = 39.0 * fuel / 411000.0
            fuel_centre = 5.0 + fuel_height / 2
            mass = 28000.0 + fuel
            centre = (28000.0 * 23.0 + fuel * fuel_centre) / mass
            inertia = (5.60e6 + 28000.0 * (23.0 - centre) ** 2
                       + fuel * (3 * 1.78 ** 2 + fuel_height ** 2) / 12
                       + fuel * (fuel_centre - centre) ** 2)

            # Density falls off exponentially with a scale height of 8500 m (rocket_calibration.density).
            start_height = y.clamp(min=0.0)
            def density(height):
                return air_density * torch.exp(-(height.clamp(min=0.0) - start_height) / 8500.0)

            def accelerations(vx, vy, theta, omega, y):
                return self.engine_off_accelerations(vx, vy, theta, omega, wind_x, wind_y, density(y),
                                                     mass, centre, inertia)

            elapsed = torch.zeros_like(x)
            for pieces_left in range(steps, 0, -1):
                ax, ay, aw = accelerations(vx, vy, theta, omega, y)
                dt = self.time_to_ground(y, vy, theta, ay, centre) / pieces_left
                half = dt / 2
                # Midpoint state
                mx, my = x + vx * half, y + vy * half
                mvx, mvy = vx + ax * half, vy + ay * half
                mtheta, momega = theta + omega * half, omega + aw * half
                ax, ay, aw = accelerations(mvx, mvy, mtheta, momega, my)
                # Full step using the midpoint rates
                x, y = x + mvx * dt, y + mvy * dt
                vx, vy = vx + ax * dt, vy + ay * dt
                theta, omega = theta + momega * dt, omega + aw * dt
                elapsed = elapsed + dt

            # Close the remaining gap (usually centimetres) with one constant-acceleration step.
            ax, ay, aw = accelerations(vx, vy, theta, omega, y)
            dt = self.time_to_ground(y, vy, theta, ay, centre)
            time_to_ground = elapsed + dt
            landing_x = x + vx * dt + 0.5 * ax * dt ** 2
            landing_vy = vy + ay.clamp(max=-1.0) * dt
            landing_theta = theta + omega * dt + 0.5 * aw * dt ** 2
            landing_omega = omega + aw * dt

            return torch.stack((time_to_ground, landing_vy, landing_x, landing_theta, landing_omega), dim=-1)

        def features(self, observation):
            # Remove the middle features (actual_thrust, actual_gimbal), and add the 5 engine-off landing predictions.
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
