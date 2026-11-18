"""Standalone NumPy softmax controller. See README for the staged comparison."""
import numpy as np

STAGE = 7
FEATURE_VERSION = 100 + STAGE


class Controller:
    def __init__(self, learning_rate=0.1, epochs=10, random_state=42):
        self.learning_rate, self.epochs, self.random_state = learning_rate, int(epochs), int(random_state)
        self.weights = None
        self.train_loss_history, self.validation_loss_history = [], []

    @staticmethod
    def _softmax(scores):
        scores = scores - scores.max(axis=1, keepdims=True)
        exp = np.exp(scores)
        return exp / exp.sum(axis=1, keepdims=True)

    @staticmethod
    def cross_entropy_loss(y_true, y_pred, sample_weight=None):
        losses = -np.sum(y_true * np.log(np.clip(y_pred, 1e-12, 1)), axis=1)
        return float(np.average(losses, weights=sample_weight))

    @staticmethod
    def _observations(X):
        X = np.asarray(X, dtype=float)
        if X.ndim != 2 or X.shape[1] != 12 or len(X) == 0 or not np.isfinite(X).all():
            raise ValueError('Expected a nonempty matrix of 12 finite observations per row.')
        return X

    def _basis(self, X):
        X = self._observations(X)
        if STAGE < 4:
            return X
        # Sample a short state-dependent trajectory at 1, 2 and 3 seconds.
        # The observed thrust and gimbal are held fixed, not the future action.
        h, vy, theta, omega = (X[:, i].copy() for i in (1, 3, 4, 5))
        vx = X[:, 2].copy()
        fuel = np.clip(X[:, 6], 0, 411000)
        mass = 28000 + fuel
        fh = 39 * fuel / 411000
        fc = 5 + fh / 2
        centre = (28000 * 23 + fuel * fc) / mass
        inertia = (5.60e6 + 28000 * (23-centre)**2
                   + fuel * (3*1.78**2 + fh**2)/12 + fuel*(fc-centre)**2)
        # Flat-pad first-contact estimate from the calibrated hull and feet.
        points = np.array([[-1.83,1.60],[1.83,1.60],[1.83,43.60],
                           [1.65,45.20],[1.65,48.768],[-1.65,48.768],
                           [-1.65,45.20],[-1.83,43.60],[-9,0],[9,0]])
        def clearance(y, angle):
            offsets = (np.sin(angle)[:, None] * points[:, 0]
                       + np.cos(angle)[:, None] * (points[:, 1] - centre[:, None]))
            return y + offsets.min(axis=1)
        active = clearance(h, theta) > 0
        columns = [X]
        dt = .25
        for step in range(12):
            ay = np.full(len(X), -9.80665 if STAGE >= 5 else 0.0)
            ax, angular = np.zeros(len(X)), np.zeros(len(X))
            if STAGE >= 6:
                rx, ry = vx-X[:, 9], vy-X[:, 10]
                speed = np.hypot(rx, ry)
                # Simulator's angle-dependent drag coefficient; no lift or damping.
                tail_x, tail_y = np.sin(theta), -np.cos(theta)
                aoa = np.arctan2(tail_x*ry-tail_y*rx, tail_x*rx+tail_y*ry)
                cd = .65 + 15*np.sin(aoa)**2
                factor = .5 * np.maximum(X[:, 11], 0) * 10.5209 * cd * speed
                fx, fy = -factor*rx, -factor*ry
                ax += fx/mass
                ay += fy/mass
                angular += (37-centre)*(-np.sin(theta)*fy-np.cos(theta)*fx)/inertia
            if STAGE >= 7:
                thrust = np.where(fuel > 0, np.maximum(X[:, 7], 0), 0)
                gimbal = X[:, 8]
                ax += -thrust*np.sin(theta+gimbal)/mass
                ay += thrust*np.cos(theta+gimbal)/mass
                angular += (1-centre)*thrust*np.sin(gimbal)/inertia
            # Approximate first contact by interpolating across this integration step.
            nh = h + vy*dt + .5*ay*dt**2
            nt = theta + omega*dt + .5*angular*dt**2
            old_gap, new_gap = clearance(h, theta), clearance(nh, nt)
            fraction = np.ones(len(X))
            hit = active & (new_gap <= 0)
            fraction[hit] = np.clip(old_gap[hit] / (old_gap[hit]-new_gap[hit]), 0, 1)
            duration = dt*fraction*active
            h += vy*duration + .5*ay*duration**2
            theta += omega*duration + .5*angular*duration**2
            vx += ax*duration
            vy += ay*duration
            omega += angular*duration
            active &= ~hit
            if step in (3, 7, 11):
                columns.append(np.column_stack((h.copy(), vy.copy(), theta.copy(), omega.copy())))
        return np.column_stack(columns)

    def _create_design_matrix(self, X, fit_normalization=False):
        features = self._basis(X)
        if fit_normalization:
            self.X_mean_ = features.mean(axis=0)
            self.X_std_ = features.std(axis=0)
        return np.column_stack((np.ones(len(features)), (features-self.X_mean_)/(self.X_std_+1e-12)))

    def fit(self, train_X, train_y, validation_X=None, validation_y=None, run_ids=None):
        train_X = self._observations(train_X)
        train_y = np.asarray(train_y)
        if train_y.shape != (len(train_X),):
            raise ValueError('Expected one label per observation.')
        if (validation_X is None) != (validation_y is None):
            raise ValueError('Provide both validation_X and validation_y, or neither.')
        if run_ids is not None:
            ids = np.asarray(run_ids)
            if ids.shape != (len(train_X),):
                raise ValueError('Expected one run ID per observation.')
            if validation_X is not None:
                raise ValueError('Use either run_ids or explicit validation data.')
            unique = np.unique(ids)
            if len(unique) < 2:
                raise ValueError('At least two flights are required for a flight-level split.')
            shuffled = np.random.default_rng(self.random_state).permutation(unique)
            n_val = max(1, int(round(.2*len(unique))))
            val_mask = np.isin(ids, shuffled[:n_val])
            self.training_run_ids_, self.validation_run_ids_ = shuffled[n_val:], shuffled[:n_val]
            validation_X, validation_y = train_X[val_mask], train_y[val_mask]
            train_X, train_y = train_X[~val_mask], train_y[~val_mask]
        self.classes_, labels = np.unique(train_y, return_inverse=True)
        targets = np.eye(len(self.classes_))[labels]
        counts = np.bincount(labels)
        self.class_weights_ = len(labels)/(len(counts)*counts) if STAGE >= 3 else np.ones(len(counts))
        sample_weight = self.class_weights_[labels]
        design = self._create_design_matrix(train_X, fit_normalization=True)
        self.weights = np.zeros((design.shape[1], len(self.classes_)))
        val_design, val_targets = None, None
        if validation_X is not None:
            validation_y = np.asarray(validation_y)
            val_design = self._create_design_matrix(validation_X)
            if validation_y.shape != (len(val_design),) or not np.isin(validation_y, self.classes_).all():
                raise ValueError('Validation labels must be present in training and match observations.')
            val_targets = (validation_y[:, None] == self.classes_).astype(float)
        self.train_loss_history, self.validation_loss_history = [], []
        for _ in range(self.epochs):
            probabilities = self._softmax(design @ self.weights)
            self.train_loss_history.append(self.cross_entropy_loss(targets, probabilities, sample_weight))
            if val_design is not None:
                # Unweighted validation loss makes the metric comparable across models.
                self.validation_loss_history.append(self.cross_entropy_loss(val_targets, self._softmax(val_design @ self.weights)))
            error = (probabilities-targets)*sample_weight[:, None]
            self.weights -= self.learning_rate*(design.T @ error)/sample_weight.sum()
        return self

    def decision_function(self, X):
        if self.weights is None:
            raise ValueError('Model has not been trained yet.')
        return self._create_design_matrix(X) @ self.weights

    def predict_proba(self, X):
        return self._softmax(self.decision_function(X))

    def predict(self, X):
        return self.classes_[np.argmax(self.predict_proba(X), axis=1)]

    def predict_action(self, observation):
        return int(self.predict(np.asarray(observation, dtype=float)[None, :])[0])

    def save(self, path):
        if self.weights is None:
            raise ValueError('Model has not been trained yet.')
        with open(path, 'wb') as target:
            np.savez_compressed(target, feature_version=FEATURE_VERSION, weights=self.weights,
                                classes=self.classes_, mean=self.X_mean_, std=self.X_std_,
                                class_weights=self.class_weights_, learning_rate=self.learning_rate,
                                epochs=self.epochs, random_state=self.random_state,
                                train_loss_history=self.train_loss_history,
                                validation_loss_history=self.validation_loss_history)

    def load(self, path):
        with np.load(path, allow_pickle=False) as saved:
            if int(saved['feature_version']) != FEATURE_VERSION:
                raise ValueError('Weights belong to a different model stage; retrain this model.')
            self.weights, self.classes_ = saved['weights'], saved['classes']
            self.X_mean_, self.X_std_ = saved['mean'], saved['std']
            self.class_weights_ = saved['class_weights']
            self.learning_rate, self.epochs = float(saved['learning_rate']), int(saved['epochs'])
            self.random_state = int(saved['random_state'])
            self.train_loss_history = saved['train_loss_history'].tolist()
            self.validation_loss_history = saved['validation_loss_history'].tolist()
        return self
