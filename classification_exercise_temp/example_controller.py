import numpy as np
from collections import deque

FEATURE_VERSION = 3

class Controller():
    """Multinomial logistic regression on nonlinear observation features."""
    def __init__(self, learning_rate=0.1, epochs=1000):
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.weights = None
        self.bias = None
        self.loss_history = []
        self.history = deque(maxlen=5)

    def save(self, path):
        """Save trained parameters for later evaluation (NumPy .npz format)."""
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        with open(path, "wb") as target:
            np.savez_compressed(target, feature_version=FEATURE_VERSION, weights=self.weights, bias=self.bias,
                                classes=self.classes_, mean=self.mean_, scale=self.scale_,
                                basis_mean=self.basis_mean_, basis_scale=self.basis_scale_,
                                learning_rate=self.learning_rate, epochs=self.epochs,
                                loss_history=self.loss_history)

    def load(self, path):
        """Restore a saved model and start with an empty flight history."""
        with np.load(path, allow_pickle=False) as saved:
            if 'feature_version' not in saved or int(saved['feature_version']) != FEATURE_VERSION:
                raise ValueError('Saved weights use an incompatible feature version; retrain and save the model again.')
            self.weights = saved["weights"]
            self.bias = saved["bias"]
            self.classes_ = saved["classes"]
            self.mean_ = saved["mean"]
            self.scale_ = saved["scale"]
            self.basis_mean_ = saved["basis_mean"]
            self.basis_scale_ = saved["basis_scale"]
            self.learning_rate = float(saved["learning_rate"])
            self.epochs = int(saved["epochs"])
            self.loss_history = saved["loss_history"].tolist()
        self.reset()
        return self

    def reset(self):
        """Start a new flight without carrying observations over from the last."""
        self.history.clear()
    
    @staticmethod
    def _softmax(scores):
        shifted = scores - np.max(scores, axis=1, keepdims=True)
        exp_scores = np.exp(shifted)
        return exp_scores / np.sum(exp_scores, axis=1, keepdims=True)
    
    def decision_function(self, X):
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        return np.dot(self.create_design_matrix(X), self.weights) + self.bias
    
    def predict_proba(self, X):
        return self._softmax(self.decision_function(X))
    
    def predict(self, X):
        proba = self.predict_proba(X)
        return self.classes_[np.argmax(proba, axis=1)]

    def predict_action(self, observation):
        observation = np.asarray(observation, dtype=float)
        if observation.shape != (12,):
            raise ValueError("Expected one observation with 12 values.")
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        previous = self.history[-1] if self.history else observation
        features = self.create_design_matrix(observation[None, :], previous[None, :])
        action = int(self.classes_[np.argmax(features @ self.weights + self.bias, axis=1)[0]])
        self.history.append(observation.copy())
        return action
    
    def cross_entropy_loss(self, y_true, y_pred):
        eps = 1e-12
        y_pred = np.clip(y_pred, eps, 1.0)
        correct = y_pred[np.arange(len(y_true)), y_true]
        return -np.mean(np.log(correct))
    
    def _basis_functions(self, X, previous=None):
        # Normalize raw observations before forming powers and interactions.
        z = (np.asarray(X, dtype=float) - self.mean_) / self.scale_
        i, j = np.triu_indices(z.shape[1])
        # Quadratic interactions model effects such as position × velocity and
        # tilt × angular velocity; magnitudes capture symmetric responses.
        basis = [z, np.abs(z), z * np.abs(z), z[:, i] * z[:, j]]
        if z.shape[1] == 12:
            # Approximate clearance on a flat pad from the fuel-dependent COM.
            fuel = np.maximum(X[:, 6], 0)
            mass = 28000.0 + fuel
            centre = (28000.0 * 23.0 + fuel * (5.0 + 39.0 * fuel / 822000.0)) / mass
            height = np.maximum(X[:, 1] - centre * np.cos(X[:, 4]) - 9.0 * np.abs(np.sin(X[:, 4])), 1.0)
            down_speed = np.maximum(-X[:, 3], 0.0)
            braking = np.maximum(845000.0 * np.maximum(np.cos(X[:, 4]), 0.0) / mass - 9.80665, 0.1)
            stopping_distance = down_speed ** 2 / (2.0 * braking)
            time_to_ground = np.minimum(height / np.maximum(down_speed, 1.0), 30.0)
            basis.append(np.column_stack((height, down_speed, braking, stopping_distance,
                stopping_distance - height, stopping_distance / height,
                time_to_ground, X[:, 0] + X[:, 2] * time_to_ground,
                X[:, 4] + X[:, 5] * time_to_ground)))
            # Continuing at the observed thrust is one possible short-horizon
            # trajectory; immediate actuators can also change it at the next decision.
            acceleration = np.where(fuel > 0, X[:, 7], 0.) * np.cos(X[:, 4] + X[:, 8]) / mass - 9.80665
            delayed_speed = np.maximum(down_speed - .2 * acceleration, 0.)
            delayed_distance = down_speed * .2 + delayed_speed ** 2 / (2. * braking)
            relative_vx = X[:, 2] - X[:, 9]
            basis.append(np.column_stack((acceleration,
                delayed_distance - height, delayed_distance / height,
                X[:, 0] + X[:, 2] * np.minimum(time_to_ground, 5.),
                relative_vx, X[:, 4] + .5 * X[:, 5], X[:, 4] + X[:, 5],
                X[:, 4] + 2. * X[:, 5], X[:, 5] * time_to_ground)))
            # Immediate-response physics: each throttle level takes effect at
            # the next 0.1 s decision boundary, with no thrust after fuel runs out.
            # Gimbal choices change horizontal acceleration and vertical braking.
            thrust_levels = np.array([0., 482000. + .12 * 363000.,
                                      482000. + .55 * 363000., 845000.])
            thrust = np.where(fuel[:, None] > 0, thrust_levels[None, :], 0.)
            vertical_acceleration = thrust * np.cos(X[:, 4, None]) / mass[:, None] - 9.80665
            speeds = np.maximum(down_speed[:, None] - .1 * vertical_acceleration, 0.)
            basis.append(np.column_stack((vertical_acceleration, speeds)))
            gimbals = np.radians(np.array([-5., 0., 5.]))
            full_thrust = np.where(fuel[:, None] > 0, 845000., 0.)
            angles = X[:, 4, None] + gimbals
            basis.append(np.column_stack((-full_thrust * np.sin(angles) / mass[:, None],
                                          full_thrust * np.cos(angles) / mass[:, None] - 9.80665)))
            # Differences estimate acceleration and actuator changes over 0.1 s.
            if previous is None:
                previous = X
            basis.append((X[:, [2, 3, 5, 7, 8]] - previous[:, [2, 3, 5, 7, 8]]) / 0.1)
        return np.column_stack(basis)

    def create_design_matrix(self, X, previous=None):
        X = np.asarray(X, dtype=float)
        features = self._basis_functions(X, previous)
        return (features - self.basis_mean_) / self.basis_scale_
    
    def fit(self, X, y, run_ids=None, steps=None):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y)
        if X.ndim != 2 or not X.shape[0] or not X.shape[1]:
            raise ValueError("X must be a nonempty matrix of observations.")
        if y.ndim != 1 or len(y) != len(X):
            raise ValueError("y must contain one action per observation.")
        if not np.all(np.isfinite(X)):
            raise ValueError("Observations must be finite.")
        if not np.issubdtype(y.dtype, np.integer) or np.any((y < 0) | (y > 9)):
            raise ValueError("Actions must be integers from 0 to 9.")
        if not np.isfinite(self.learning_rate) or self.learning_rate <= 0:
            raise ValueError("learning_rate must be positive and finite.")
        if not isinstance(self.epochs, (int, np.integer)) or self.epochs <= 0:
            raise ValueError("epochs must be a positive integer.")
        previous = X.copy()
        if run_ids is not None:
            run_ids = np.asarray(run_ids)
            if run_ids.shape != (len(X),):
                raise ValueError("run_ids must contain one ID per observation.")
            consecutive = run_ids[1:] == run_ids[:-1]
            if steps is not None:
                steps = np.asarray(steps)
                if steps.shape != (len(X),):
                    raise ValueError("steps must contain one step per observation.")
                consecutive &= steps[1:] == steps[:-1] + 1
            previous[1:][consecutive] = X[:-1][consecutive]
        self.mean_ = X.mean(axis=0)
        self.scale_ = X.std(axis=0)
        self.scale_[self.scale_ == 0] = 1.0
        basis = self._basis_functions(X, previous)
        self.basis_mean_ = basis.mean(axis=0)
        self.basis_scale_ = basis.std(axis=0)
        self.basis_scale_[self.basis_scale_ < 1e-12] = 1.0
        X = self.create_design_matrix(X, previous)
        n_samples, n_features = X.shape
        self.classes_, labels = np.unique(y, return_inverse=True)
        n_classes = len(self.classes_)
        targets = np.eye(n_classes)[labels]

        self.weights = np.zeros(
            (n_features, n_classes)
        )
        self.bias = np.zeros(n_classes)
        self.loss_history = []
        self.reset()

        for epoch in range(self.epochs):
            print(f"Epoch {epoch + 1}/{self.epochs}", end="\r")
            probabilities = self._softmax(X @ self.weights + self.bias)
            self.loss_history.append(
                self.cross_entropy_loss(labels, probabilities)
            )
            error = probabilities - targets
            dw = X.T @ error / n_samples
            db = np.mean(error, axis=0)
            self.weights -= self.learning_rate * dw
            self.bias -= self.learning_rate * db
        return self
