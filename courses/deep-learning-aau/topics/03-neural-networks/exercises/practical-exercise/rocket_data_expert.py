"""MPC adaptations for short approaches and disturbed dataset starts.

The original full-descent expert remains available unchanged. Short approaches
prioritize an attainable location inside the pad rather than forcing its exact
centre, and allow an engine-off recovery if a burn reverses descent.
"""
import numpy as np

from rocket_expert import Controller
from rocket_physics import State, clearance
from rocket_scoring import CONFIG


class DatasetExpert(Controller):
    version = 'mixed-state-mpc-v1'

    def reset(self):
        super().reset()
        self.landing_x = None
        self.landing_vx = 0.

    def _residual(self, z, initial, wind):
        residual = super()._residual(z, initial, wind)
        residual[0] -= self.landing_x or 0.
        residual[2] -= self.landing_vx/.3
        controls = z[2:].reshape(self.knots, 2, -1)
        # A modest thrust cost retains steering/braking time instead of
        # always delaying ignition until a maximum-thrust burn is necessary.
        return np.vstack((residual, .05*controls[:, 0]))

    def predict_action(self, observation):
        obs = np.asarray(observation, dtype=float)
        if (obs.shape != (12,) or not np.all(np.isfinite(obs))
                or not 0 <= obs[6] <= self.p.fuel_capacity):
            return super().predict_action(observation)  # Shared input validation.
        gap = clearance(State(*obs[:9]), self.p)[0]
        # Derive the target from the current observation each time. A fixed
        # private goal from the initial state would introduce a hidden input
        # for the feedforward learner imitating these demonstrations.
        self.landing_x, self.landing_vx = 0., 0.
        if gap < 120.:
            time_left = max(.2, 2*gap/max(2., -obs[3]+self.touchdown_speed))
            pad_margin = CONFIG.d_ref*.75
            self.landing_x = float(np.clip(obs[0]+.5*obs[2]*time_left, -pad_margin, pad_margin))
            if gap < 15.:
                self.landing_vx = float(np.clip(obs[2], -.5, .5))
        if obs[3] >= 0.:
            # Positive commands cannot provide less than minimum engine thrust.
            # Re-open the coast phase instead of powering an unwanted climb.
            self.plan = None
            self.burning = False
            self.diagnostics = dict(recoasting=True)
            return (0., 0.)
        return super().predict_action(obs)
