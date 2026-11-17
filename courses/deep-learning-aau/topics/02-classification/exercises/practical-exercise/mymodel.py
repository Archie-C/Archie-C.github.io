"""NumPy softmax classifier with calibrated physics and nonlinear basis functions.

The final learned mapping is linear in the basis features. No neural network,
external simulator, expert solver or additional dependency is used at inference.
"""
import numpy as np

FEATURE_VERSION = 5
OBSERVATION_COLUMNS = ("x", "y", "vx", "vy", "theta", "omega", "fuel_mass",
                       "actual_thrust", "actual_gimbal", "wind_x", "wind_y", "air_density")
MIRROR_ACTIONS = np.array([0, 3, 2, 1, 6, 5, 4, 9, 8, 7])


class Controller:
    def __init__(self, learning_rate=1.0, epochs=1000, l2=1e-5, patience=60,
                 min_delta=1e-5, basis="physics_rbf", n_centres=160,
                 class_weight_power=0.75, class_weight_cap=6.0,
                 symmetry=True, random_state=42):
        if (not np.isfinite(learning_rate) or learning_rate <= 0 or int(epochs) != epochs
                or epochs < 1 or not np.isfinite(l2) or l2 < 0 or patience < 1
                or min_delta < 0 or basis not in ("physics", "physics_rbf")
                or n_centres < 0 or not 0 <= class_weight_power <= 1 or class_weight_cap < 1):
            raise ValueError("Invalid training parameters.")
        self.learning_rate, self.epochs, self.l2 = learning_rate, int(epochs), l2
        self.patience, self.min_delta = int(patience), min_delta
        self.basis, self.n_centres = basis, int(n_centres)
        self.class_weight_power, self.class_weight_cap = class_weight_power, class_weight_cap
        self.symmetry, self.random_state = bool(symmetry), int(random_state)
        self.weights = None
        self.train_loss_history, self.validation_loss_history = [], []

    @staticmethod
    def _observations(X):
        X = np.asarray(X, dtype=float)
        if X.ndim != 2 or X.shape[1] != 12 or len(X) == 0 or not np.all(np.isfinite(X)):
            raise ValueError("Expected a nonempty matrix of 12 finite observation values per row.")
        return X

    @staticmethod
    def mirror_observations(X):
        mirrored = np.asarray(X, dtype=float).copy()
        mirrored[:, [0, 2, 4, 5, 8, 9]] *= -1
        return mirrored

    @staticmethod
    def _softmax(scores):
        exp_scores = np.exp(scores - np.max(scores, axis=1, keepdims=True))
        return exp_scores / exp_scores.sum(axis=1, keepdims=True)

    @staticmethod
    def cross_entropy_loss(y_true, y_pred, sample_weight=None):
        losses = -np.sum(y_true * np.log(np.clip(y_pred, 1e-12, 1)), axis=1)
        return float(np.average(losses, weights=sample_weight))

    @staticmethod
    def ground_clearance(X):
        """Minimum rotated hull/foot clearance above a flat pad (not terrain)."""
        X = np.asarray(X, dtype=float)
        fuel = np.clip(X[:, 6], 0, 411000)
        centre = (28000 * 23 + fuel * (5 + 39 * fuel / (2 * 411000))) / (28000 + fuel)
        theta = X[:, 4]
        points = np.array([[-1.83, 1.60], [1.83, 1.60], [1.83, 43.60],
                           [1.65, 45.20], [1.65, 48.768], [-1.65, 48.768],
                           [-1.65, 45.20], [-1.83, 43.60], [-9, 0], [9, 0]])
        offsets = (np.sin(theta)[:, None] * points[:, 0]
                   + np.cos(theta)[:, None] * (points[:, 1] - centre[:, None]))
        return np.maximum(X[:, 1] + offsets.min(axis=1), 0)

    @staticmethod
    def _accelerations(X):
        """Instantaneous accelerations using the exercise's rocket calibration."""
        vx_air, vy_air = X[:, 2] - X[:, 9], X[:, 3] - X[:, 10]
        theta, omega, density = X[:, 4], X[:, 5], X[:, 11]
        fuel = np.clip(X[:, 6], 0.0, 411000.0)
        mass = 28000.0 + fuel
        fuel_height = 39.0 * fuel / 411000.0
        fuel_centre = 5.0 + fuel_height / 2.0
        centre = (28000.0 * 23.0 + fuel * fuel_centre) / mass
        inertia = (5.60e6 + 28000.0 * (23.0 - centre)**2
                   + fuel * (3 * 1.78**2 + fuel_height**2) / 12.0
                   + fuel * (fuel_centre - centre)**2)

        speed = np.hypot(vx_air, vy_air)
        tail_x, tail_y = np.sin(theta), -np.cos(theta)
        alpha = np.arctan2(tail_x * vy_air - tail_y * vx_air,
                           tail_x * vx_air + tail_y * vy_air)
        cd = 0.65 + 15.0 * np.sin(alpha)**2
        cl = -0.60 * np.sin(2.0 * alpha)
        # q_area / speed remains zero when airspeed is zero.
        factor = 0.5 * density * 10.5209 * speed
        aero_x = factor * (-cd * vx_air - cl * vy_air)
        aero_y = factor * (-cd * vy_air + cl * vx_air)
        thrust = np.where(fuel > 0, X[:, 7], 0.0)
        thrust_x = -thrust * np.sin(theta + X[:, 8])
        thrust_y = thrust * np.cos(theta + X[:, 8])
        ax = (thrust_x + aero_x) / mass
        ay = (thrust_y + aero_y) / mass - 9.80665

        # Cross products of the force vectors with their body-axis lever arms.
        aero_arm = 37.0 - centre
        thrust_arm = 1.0 - centre
        aero_torque = aero_arm * (-np.sin(theta) * aero_y - np.cos(theta) * aero_x)
        thrust_torque = thrust_arm * (-np.sin(theta) * thrust_y - np.cos(theta) * thrust_x)
        q_area = 0.5 * density * speed**2 * 10.5209
        damping = -q_area * 48.768**2 * 0.60 * omega / (2.0 * np.maximum(speed, 1.0))
        angular_accel = (aero_torque + thrust_torque + damping) / inertia
        return ax, ay, angular_accel

    def _physics_features(self, X):
        """Natural scales bound extrapolation; feature construction is stateless."""
        x, _, vx, vy, theta, omega, fuel, thrust, gimbal, wx, wy, rho = X.T
        fuel = np.clip(fuel, 0, 411000)
        mass = 28000 + fuel
        centre = (28000 * 23 + fuel * (5 + 39 * fuel / (2 * 411000))) / mass
        gap = self.ground_clearance(X)
        down = np.maximum(-vy, 0)
        unpowered = X.copy()
        unpowered[:, 7] = 0
        aero_ax, coast_ay, aero_alpha = self._accelerations(unpowered)
        max_ay = coast_ay + np.where(fuel > 0, 845000 * np.cos(theta) / mass, 0)
        # Landing targets leave margin inside the published velocity limits.
        required_ay = np.maximum((down**2 - 0.8**2) / (2 * np.maximum(gap, 0.5)), 0)
        required_thrust = mass * (required_ay - coast_ay) / np.maximum(np.cos(theta), 0.25)
        time_left = np.clip(2 * gap / np.maximum(down + 0.8, 1), 0.25, 15)
        # A shrinking steering horizon discourages large tilts near contact.
        steer_time = np.maximum(time_left, 1.5)
        ax_request = np.clip(-2 * (x + vx * steer_time) / steer_time**2, -4, 4)
        theta_request = np.clip(np.arctan2(aero_ax - ax_request,
                                          np.maximum(required_ay - coast_ay, 1)), -0.25, 0.25)
        angle_error = theta - theta_request
        desired_alpha = -2 * (angle_error + omega * steer_time) / steer_time**2
        # Gimbal authority per unit thrust, with the engine below the COM.
        h = 39 * fuel / 411000
        fc = 5 + h / 2
        inertia = (5.60e6 + 28000 * (23 - centre)**2
                   + fuel * (3 * 1.78**2 + h**2) / 12 + fuel * (fc - centre)**2)
        angular_authority = (centre - 1) * 845000 * np.sin(np.deg2rad(5)) / inertia
        gimbal_request = np.clip((aero_alpha - desired_alpha) / np.maximum(angular_authority, 1e-4), -8, 8)
        sqrt_gap = np.sqrt(gap + 0.25)
        names, columns = [], []
        def add(name, value):
            names.append(name)
            columns.append(np.broadcast_to(value, gap.shape))
        for i, scale in enumerate((40, 300, 8, 50, .1, .03, 10000, 845000, .08726646, 7, 2, 1.225)):
            add(OBSERVATION_COLUMNS[i], X[:, i] / scale)
        add("clearance", gap / 150)
        add("log_clearance", np.log1p(gap) / 5)
        add("sqrt_clearance", sqrt_gap / 10)
        add("descent_speed", down / 50)
        add("coast_ay", coast_ay / 10)
        add("aero_ax", aero_ax / 2)
        add("aero_alpha", aero_alpha / .03)
        add("required_ay", required_ay / 10)
        add("required_thrust", required_thrust / 845000)
        add("time_left", time_left / 10)
        add("target_tilt", theta_request / .1)
        add("tilt_error", angle_error / .1)
        add("gimbal_request", gimbal_request)
        add("angular_momentum_error", (omega + angle_error / steer_time) / .03)
        add("projected_x", (x + vx * time_left) / 40)
        add("projected_tilt", (theta + omega * np.minimum(time_left, 3)) / .1)
        add("target_vy_error", (vy + np.sqrt(.8**2 + 2 * np.maximum(max_ay, .1) * gap)) / 30)
        add("ascent", np.maximum(vy, 0) / 3)
        add("engine_on", (thrust > 0).astype(float))
        add("sin_tilt", np.sin(theta) / .1)
        add("sin_aoa", (np.sin(theta) * (vy-wy) + np.cos(theta) * (vx-wx)) / np.maximum(np.hypot(vx-wx, vy-wy), 1))
        # Each discrete throttle gets its own stopping and switch features.
        # Low throttle still commands min_thrust + .12*(max_thrust-min_thrust).
        for label, level in (("low", .12), ("medium", .55), ("high", 1.0)):
            candidate_thrust = np.where(fuel > 0, 482000 + level * 363000, 0)
            ay = coast_ay + candidate_thrust * np.cos(theta) / mass
            energy_margin = 2 * ay * gap - np.maximum(down**2 - .8**2, 0)
            speed_margin = np.sqrt(.8**2 + 2 * np.maximum(ay, 0) * gap) - down
            add(label + "_energy_margin", np.sign(energy_margin) * np.log1p(np.abs(energy_margin) / 100))
            add(label + "_speed_margin", speed_margin / 20)
            add(label + "_thrust_error", (required_thrust - candidate_thrust) / 363000)
            add(label + "_cannot_brake", (ay <= 0).astype(float))
        # Smooth phase gates allow different decision boundaries during approach
        # and touchdown, while preserving a linear learned output layer.
        interactions = [("vx", vx/8), ("tilt", theta/.1), ("omega", omega/.03),
                        ("x", x/40), ("gimbal", gimbal_request),
                        ("thrust_request", required_thrust/845000), ("vy", vy/50)]
        for height in (5, 20, 80):
            gate = height / (gap + height)
            add("near_" + str(height), gate)
            for label, value in interactions:
                add(label + "_near_" + str(height), np.clip(value, -8, 8) * gate)
        # Polynomial interactions capture coupled vertical and attitude control.
        core = np.column_stack((x/40, vx/8, vy/50, theta/.1, omega/.03,
                                required_thrust/845000, gimbal_request,
                                np.log1p(gap)/5, thrust/845000, time_left/10))
        core = np.clip(core, -4, 4)
        for i in range(core.shape[1]):
            for j in range(i, core.shape[1]):
                add("interaction_%d_%d" % (i, j), core[:, i] * core[:, j])
        features = np.clip(np.column_stack(columns), -12, 12)
        # RBF distance uses control-relevant coordinates, without previous action
        # dominating neighbours. Its statistics/centres are fitted on training only.
        descriptor = np.column_stack((x/40, vx/8, vy/50, theta/.1, omega/.03,
                                      np.log1p(gap)/5, required_thrust/845000,
                                      gimbal_request/3, fuel/10000, (vx-wx)/20))
        return features, np.clip(descriptor, -6, 6), names

    def _create_design_matrix(self, X, fit_normalization=False, y=None):
        X = self._observations(X)
        features, descriptor, names = self._physics_features(X)
        if fit_normalization:
            self.X_mean_ = features.mean(axis=0)
            self.X_std_ = np.maximum(features.std(axis=0), 0.05)
            self.descriptor_mean_ = descriptor.mean(axis=0)
            self.descriptor_std_ = np.maximum(descriptor.std(axis=0), 0.15)
            self.rbf_centres_ = np.empty((0, descriptor.shape[1]))
            self.rbf_width_ = 1.0
            if self.basis == "physics_rbf" and self.n_centres:
                z = (descriptor - self.descriptor_mean_) / self.descriptor_std_
                rng = np.random.default_rng(self.random_state)
                # Cover rare actions rather than spending all centres on low thrust.
                labels = np.unique(y)
                chosen = []
                for label in labels:
                    pool = np.flatnonzero(y == label)
                    chosen.extend(rng.choice(pool, min(len(pool), max(1, self.n_centres // len(labels))), replace=False))
                self.rbf_centres_ = z[chosen].copy()
                distances = np.sum((self.rbf_centres_[:, None] - self.rbf_centres_[None, :])**2, axis=2)
                k = min(5, len(chosen)-1)
                self.rbf_width_ = max(float(np.sqrt(np.median(np.sort(distances, axis=1)[:, k]))), .5)
            self.feature_names_ = ["bias"] + names + ["rbf_%d" % i for i in range(len(self.rbf_centres_))]
        scaled = np.clip((features - self.X_mean_) / self.X_std_, -20, 20).astype(np.float32)
        if len(self.rbf_centres_):
            z = (descriptor - self.descriptor_mean_) / self.descriptor_std_
            distances = (np.sum(z*z, axis=1)[:, None] + np.sum(self.rbf_centres_**2, axis=1)[None, :]
                         - 2 * z @ self.rbf_centres_.T)
            rbf = np.exp(-np.maximum(distances, 0) / (2 * self.rbf_width_**2)).astype(np.float32)
            scaled = np.column_stack((scaled, rbf))
        return np.column_stack((np.ones(len(X), dtype=np.float32), scaled))

    def decision_function(self, X):
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        X = self._observations(X)
        # Bound peak memory for large offline predictions and browser evaluation.
        if len(X) > 4096:
            return np.concatenate([self.decision_function(X[i:i+4096]) for i in range(0, len(X), 4096)])
        scores = self._create_design_matrix(X) @ self.weights
        if self.symmetry:
            reflected = self._create_design_matrix(self.mirror_observations(X)) @ self.weights
            scores = .5 * (scores + reflected[:, MIRROR_ACTIONS])
        return scores

    def predict_proba(self, X):
        return self._softmax(self.decision_function(X))

    def predict(self, X):
        X = self._observations(X)
        scores = self.decision_function(X)
        actions = np.argmax(scores, axis=1)
        # An exactly centred, motionless lateral state has no preferred gimbal
        # direction. Resolve a left/right score tie with centred gimbal.
        centred = np.max(np.abs(X[:, [0, 2, 4, 5, 8, 9]]), axis=1) < 1e-10
        powered = centred & (actions > 0)
        actions[powered] = 2 + 3 * ((actions[powered] - 1) // 3)
        actions[X[:, 6] <= 0] = 0
        return actions

    def predict_action(self, observation):
        observation = np.asarray(observation, dtype=float)
        if observation.shape != (12,):
            raise ValueError("Expected one observation with 12 values.")
        return int(self.predict(observation[None, :])[0])

    @staticmethod
    def _checked_weights(weights, n):
        weights = np.ones(n) if weights is None else np.asarray(weights, dtype=float)
        if (weights.shape != (n,) or not np.all(np.isfinite(weights))
                or np.any(weights < 0) or weights.sum() <= 0):
            raise ValueError("Weights must be finite, nonnegative and have a positive sum.")
        return weights / weights.mean()

    def fit(self, train_X, train_y, validation_X=None, validation_y=None,
            sample_weight=None, validation_sample_weight=None):
        X = self._observations(train_X)
        y = np.asarray(train_y)
        if y.shape != (len(X),) or not np.all(np.isin(y, np.arange(10))):
            raise ValueError("Labels must be action integers from 0 to 9.")
        y = y.astype(int)
        if (validation_X is None) != (validation_y is None):
            raise ValueError("Provide both validation_X and validation_y, or neither.")
        if validation_X is None and validation_sample_weight is not None:
            raise ValueError("Validation weights require validation data.")
        self.classes_ = np.arange(10)
        sw = self._checked_weights(sample_weight, len(X))
        # Class balance is fitted once from training labels; validation frequencies
        # never determine the class weights. Extra sample weights multiply these.
        if self.symmetry:
            X = np.vstack((X, self.mirror_observations(X)))
            y = np.concatenate((y, MIRROR_ACTIONS[y]))
            sw = np.tile(sw, 2)
        counts = np.bincount(y, minlength=10)
        class_weights = np.minimum((len(y) / (10 * np.maximum(counts, 1)))**self.class_weight_power, self.class_weight_cap)
        self.class_weights_ = class_weights
        sw = sw * class_weights[y]
        sw /= sw.sum()
        design = self._create_design_matrix(X, fit_normalization=True, y=y)
        del X
        if validation_X is not None:
            val_X = self._observations(validation_X)
            val_y = np.asarray(validation_y)
            if val_y.shape != (len(val_X),) or not np.all(np.isin(val_y, np.arange(10))):
                raise ValueError("Validation labels must be action integers from 0 to 9.")
            val_y = val_y.astype(int)
            vw = self._checked_weights(validation_sample_weight, len(val_y)) * class_weights[val_y]
            vw /= vw.sum()
            val_design = self._create_design_matrix(val_X)
            val_mirror = self._create_design_matrix(self.mirror_observations(val_X)) if self.symmetry else None
        self.weights = np.zeros((design.shape[1], 10), dtype=np.float32)
        self.train_loss_history, self.validation_loss_history = [], []
        self.best_epoch_, self.n_iter_, self.stop_reason_ = None, 0, "epoch limit"
        best_loss = np.inf
        patience_loss = np.inf
        best_weights = None
        stale = 0
        row = np.arange(len(y))

        def objective(flat):
            weights = flat.reshape(self.weights.shape).astype(np.float32)
            scores = design @ weights
            scores -= scores.max(axis=1, keepdims=True)
            exponentials = np.exp(scores)
            sums = exponentials.sum(axis=1)
            loss = float(np.dot(sw, np.log(sums) - scores[row, y]))
            probabilities = exponentials / sums[:, None]
            probabilities[row, y] -= 1
            probabilities *= sw[:, None]
            gradient = design.T @ probabilities
            gradient[1:] += self.l2 * weights[1:]
            loss += .5 * self.l2 * float(np.sum(weights[1:]**2))
            return loss, gradient.astype(float).ravel()

        # Limited-memory BFGS uses curvature information to resolve correlated
        # physics features much faster than fixed-step gradient descent.
        flat = self.weights.astype(float).ravel()
        loss, gradient = objective(flat)
        history = []
        for epoch in range(self.epochs):
            direction = gradient.copy()
            alphas = []
            for step, delta, reciprocal in reversed(history):
                alpha = reciprocal * np.dot(step, direction)
                alphas.append(alpha)
                direction -= alpha * delta
            if history:
                step, delta, _ = history[-1]
                direction *= np.dot(step, delta) / max(np.dot(delta, delta), 1e-20)
            for (step, delta, reciprocal), alpha in zip(history, reversed(alphas)):
                direction += step * (alpha - reciprocal * np.dot(delta, direction))
            direction *= -1
            slope = float(np.dot(direction, gradient))
            if slope >= 0:
                direction = -gradient
                slope = -float(np.dot(gradient, gradient))
                history.clear()
            if np.max(np.abs(gradient)) < 1e-6:
                self.stop_reason_ = "gradient tolerance"
                break
            rate = self.learning_rate
            accepted = False
            for _ in range(20):
                trial = flat + rate * direction
                new_loss, new_gradient = objective(trial)
                if np.isfinite(new_loss) and new_loss <= loss + 1e-4 * rate * slope:
                    accepted = True
                    break
                rate *= .5
            if not accepted:
                self.stop_reason_ = "line search converged"
                break
            step, delta = trial - flat, new_gradient - gradient
            curvature = float(np.dot(step, delta))
            if curvature > 1e-12:
                history.append((step, delta, 1 / curvature))
                history = history[-12:]
            flat, loss, gradient = trial, new_loss, new_gradient
            self.weights = flat.reshape(self.weights.shape).astype(np.float32)
            self.train_loss_history.append(loss)
            monitored = loss
            if validation_X is not None:
                scores = val_design @ self.weights
                if self.symmetry:
                    scores = .5 * (scores + (val_mirror @ self.weights)[:, MIRROR_ACTIONS])
                scores -= scores.max(axis=1, keepdims=True)
                monitored = float(np.dot(vw, np.log(np.exp(scores).sum(axis=1)) - scores[np.arange(len(val_y)), val_y]))
                self.validation_loss_history.append(monitored)
            if monitored < best_loss:
                best_loss, best_weights, self.best_epoch_ = monitored, self.weights.copy(), epoch + 1
            if monitored < patience_loss - self.min_delta:
                patience_loss, stale = monitored, 0
            else:
                stale += 1
            self.n_iter_ = epoch + 1
            if epoch == 0 or (epoch + 1) % 25 == 0:
                print(f"Iteration {epoch+1}/{self.epochs}: train objective={loss:.4f}, monitored loss={monitored:.4f}", flush=True)
            if validation_X is not None and stale >= self.patience:
                self.stop_reason_ = "validation patience"
                break
        if best_weights is not None:
            self.weights = best_weights
        print(f"Stopped after {self.n_iter_} iterations ({self.stop_reason_}); restored iteration {self.best_epoch_}.", flush=True)
        return self

    def save(self, path):
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        params = {name: getattr(self, name) for name in (
            "learning_rate", "epochs", "l2", "patience", "min_delta", "basis", "n_centres",
            "class_weight_power", "class_weight_cap", "symmetry", "random_state")}
        with open(path, "wb") as target:
            np.savez_compressed(target, feature_version=FEATURE_VERSION, weights=self.weights,
                                classes=self.classes_, mean=self.X_mean_, std=self.X_std_,
                                descriptor_mean=self.descriptor_mean_, descriptor_std=self.descriptor_std_,
                                rbf_centres=self.rbf_centres_, rbf_width=self.rbf_width_,
                                class_weights=self.class_weights_, feature_names=np.asarray(self.feature_names_),
                                train_loss_history=self.train_loss_history,
                                validation_loss_history=self.validation_loss_history,
                                best_epoch=self.best_epoch_ or 0, n_iter=self.n_iter_,
                                stop_reason=self.stop_reason_, **params)

    def load(self, path):
        with np.load(path, allow_pickle=False) as saved:
            if "feature_version" not in saved or int(saved["feature_version"]) != FEATURE_VERSION:
                raise ValueError("Saved weights use incompatible features; retrain with this mymodel.py.")
            for name in ("learning_rate", "epochs", "l2", "patience", "min_delta", "basis", "n_centres",
                         "class_weight_power", "class_weight_cap", "symmetry", "random_state"):
                setattr(self, name, saved[name].item())
            self.weights, self.classes_ = saved["weights"], saved["classes"]
            self.X_mean_, self.X_std_ = saved["mean"], saved["std"]
            self.descriptor_mean_, self.descriptor_std_ = saved["descriptor_mean"], saved["descriptor_std"]
            self.rbf_centres_, self.rbf_width_ = saved["rbf_centres"], float(saved["rbf_width"])
            self.class_weights_ = saved["class_weights"]
            self.feature_names_ = saved["feature_names"].tolist()
            self.train_loss_history = saved["train_loss_history"].tolist()
            self.validation_loss_history = saved["validation_loss_history"].tolist()
            self.best_epoch_, self.n_iter_ = int(saved["best_epoch"]), int(saved["n_iter"])
            self.stop_reason_ = str(saved["stop_reason"])
        return self
