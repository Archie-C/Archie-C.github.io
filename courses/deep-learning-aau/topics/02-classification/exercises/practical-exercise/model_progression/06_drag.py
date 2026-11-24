"""Standalone NumPy softmax controller, stage 06: adds drag, wind and drag torque to the projection.

See README.md for the staged comparison. Every stage is generated from the same template; only the
switches below differ.
"""
import numpy as np

STAGE = 6
FEATURE_VERSION = 200 + STAGE
CLASS_WEIGHTS = True   # inverse-frequency class weights in the training loss
OPTIMIZER = 'lbfgs'      # 'gd' (fixed-step gradient descent) or 'lbfgs'
PROJECTION = True     # add the state projected 1, 2 and 3 seconds ahead
GRAVITY = True        # projection includes gravity
DRAG = True           # projection includes drag, wind and drag torque
THRUST = False         # projection holds the current thrust and gimbal fixed
HORIZONTAL = False     # projection also reports x and vx


class Controller:
    optimizer = OPTIMIZER

    def __init__(self, learning_rate=0.1, epochs=1000, random_state=42, patience=None,
                 min_delta=0.0, l2=0.0):
        # learning_rate is only used by gradient descent; L-BFGS chooses its own step sizes.
        # epochs is the maximum number of weight updates (L-BFGS iterations for OPTIMIZER == 'lbfgs').
        self.learning_rate, self.epochs, self.random_state = learning_rate, int(epochs), int(random_state)
        # Early stopping: stop after `patience` epochs without the validation loss improving by
        # more than `min_delta`, then restore the best weights. None disables it.
        self.patience, self.min_delta = patience, float(min_delta)
        # L2 penalty 0.5 * l2 * ||W||^2 on every weight except the bias row.
        self.l2 = float(l2)
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
        if not PROJECTION:
            return X
        # Sample a short state-dependent trajectory at 1, 2 and 3 seconds.
        # The observed thrust and gimbal are held fixed, not the future action.
        x, h, vy, theta, omega = (X[:, i].copy() for i in (0, 1, 3, 4, 5))
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
            ay = np.full(len(X), -9.80665 if GRAVITY else 0.0)
            ax, angular = np.zeros(len(X)), np.zeros(len(X))
            if DRAG:
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
            if THRUST:
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
            x += vx*duration + .5*ax*duration**2
            h += vy*duration + .5*ay*duration**2
            theta += omega*duration + .5*angular*duration**2
            vx += ax*duration
            vy += ay*duration
            omega += angular*duration
            active &= ~hit
            if step in (3, 7, 11):
                state = (x, vx, h, vy, theta, omega) if HORIZONTAL else (h, vy, theta, omega)
                columns.append(np.column_stack([value.copy() for value in state]))
        return np.column_stack(columns)

    @staticmethod
    def classification_metrics(y_true, y_pred):
        """Accuracy, macro F1 and per-class F1 over every label seen in y_true or y_pred."""
        y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
        per_class = {}
        for label in np.union1d(y_true, y_pred):
            tp = np.sum((y_pred == label) & (y_true == label))
            fp = np.sum((y_pred == label) & (y_true != label))
            fn = np.sum((y_pred != label) & (y_true == label))
            per_class[label.item()] = float(2*tp/(2*tp+fp+fn)) if 2*tp+fp+fn else 0.
        return {'accuracy': float(np.mean(y_pred == y_true)),
                'macro_f1': float(np.mean(list(per_class.values()))),
                'per_class_f1': per_class, 'rows': len(y_true)}

    def _create_design_matrix(self, X, fit_normalization=False):
        features = self._basis(X)
        if fit_normalization:
            self.X_mean_ = features.mean(axis=0)
            self.X_std_ = features.std(axis=0)
        return np.column_stack((np.ones(len(features)), (features-self.X_mean_)/(self.X_std_+1e-12)))

    def _objective(self, flat, design, targets, sample_weight):
        """Weighted cross-entropy + L2 penalty, its gradient, and the cross-entropy on its own."""
        weights = flat.reshape(design.shape[1], -1)
        probabilities = self._softmax(design @ weights)
        data_loss = self.cross_entropy_loss(targets, probabilities, sample_weight)
        gradient = design.T @ ((probabilities-targets)*sample_weight[:, None]) / sample_weight.sum()
        penalised = weights.copy()
        penalised[0] = 0  # the bias is not regularised
        loss = data_loss + .5*self.l2*np.sum(penalised**2)
        return loss, (gradient + self.l2*penalised).ravel(), data_loss

    @staticmethod
    def _lbfgs_direction(gradient, steps, changes):
        """Two-loop recursion: approximate inverse-Hessian @ gradient from the last few updates."""
        q = gradient.copy()
        alphas = []
        for s, y in reversed(list(zip(steps, changes))):
            rho = 1/(y @ s)
            alpha = rho*(s @ q)
            q -= alpha*y
            alphas.append((rho, alpha))
        if steps:
            q *= (steps[-1] @ changes[-1]) / (changes[-1] @ changes[-1])
        for (s, y), (rho, alpha) in zip(zip(steps, changes), reversed(alphas)):
            q += s*(alpha - rho*(y @ q))
        return q

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
        self.class_weights_ = len(labels)/(len(counts)*counts) if CLASS_WEIGHTS else np.ones(len(counts))
        sample_weight = self.class_weights_[labels]
        design = self._create_design_matrix(train_X, fit_normalization=True)
        shape = (design.shape[1], len(self.classes_))
        val_design, val_targets = None, None
        if validation_X is not None:
            validation_y = np.asarray(validation_y)
            val_design = self._create_design_matrix(validation_X)
            if validation_y.shape != (len(val_design),) or not np.isin(validation_y, self.classes_).all():
                raise ValueError('Validation labels must be present in training and match observations.')
            val_targets = (validation_y[:, None] == self.classes_).astype(float)

        self.train_loss_history, self.validation_loss_history = [], []
        best = {'loss': np.inf, 'weights': None, 'epoch': None}
        state = {'wait': 0, 'stopped_epoch': None}

        def monitor(epoch, flat, data_loss):
            """Record the losses of these weights; return True when early stopping triggers."""
            self.train_loss_history.append(data_loss)
            if val_design is None:
                return False
            # Unweighted validation loss makes the metric comparable across models.
            val_loss = self.cross_entropy_loss(val_targets, self._softmax(val_design @ flat.reshape(shape)))
            self.validation_loss_history.append(val_loss)
            if val_loss < best['loss'] - self.min_delta:
                best.update(loss=val_loss, weights=flat.copy(), epoch=epoch)
                state['wait'] = 0
            else:
                state['wait'] += 1
                if self.patience is not None and state['wait'] >= self.patience:
                    state['stopped_epoch'] = epoch
                    return True
            return False

        # Losses are recorded for the starting weights and after every update, so a run of
        # `epochs` updates has epochs + 1 entries.
        flat = np.zeros(np.prod(shape))
        loss, gradient, data_loss = self._objective(flat, design, targets, sample_weight)
        stop_reason = 'max_epochs'
        steps, changes = [], []
        for epoch in range(self.epochs + 1):
            if monitor(epoch, flat, data_loss):
                stop_reason = 'early_stopping'
                break
            if epoch == self.epochs:
                break
            if OPTIMIZER == 'gd':
                flat = flat - self.learning_rate*gradient
                loss, gradient, data_loss = self._objective(flat, design, targets, sample_weight)
                continue
            # L-BFGS: quasi-Newton direction, then backtrack until the loss falls enough (Armijo).
            if np.max(np.abs(gradient)) < 1e-6:
                stop_reason = 'converged'
                break
            direction = -self._lbfgs_direction(gradient, steps, changes)
            slope = gradient @ direction
            if slope >= 0:  # not a descent direction: forget the history and use the gradient
                steps, changes = [], []
                direction, slope = -gradient, -(gradient @ gradient)
            step = 1.0 if steps else 1/max(1.0, np.linalg.norm(gradient))
            while True:
                new_flat = flat + step*direction
                new_loss, new_gradient, new_data_loss = self._objective(new_flat, design, targets, sample_weight)
                if new_loss <= loss + 1e-4*step*slope or step < 1e-10:
                    break
                step *= .5
            if new_loss > loss:
                stop_reason = 'converged'  # no step reduces the loss any further
                break
            s, y = new_flat - flat, new_gradient - gradient
            if s @ y > 1e-10:
                steps.append(s)
                changes.append(y)
                if len(steps) > 10:
                    steps.pop(0)
                    changes.pop(0)
            flat, loss, gradient, data_loss = new_flat, new_loss, new_gradient, new_data_loss

        # With early stopping on, return the best validation weights; otherwise the final ones.
        best_epoch = len(self.train_loss_history) - 1
        if val_design is not None and self.patience is not None:
            flat, best_epoch = best['weights'], best['epoch']
        self.weights = flat.reshape(shape)
        validation_metrics = None
        if val_design is not None:
            validation_metrics = self.classification_metrics(
                validation_y, self.classes_[np.argmax(val_design @ self.weights, axis=1)])
        self.history_ = {'train_loss': list(self.train_loss_history),
                         'validation_loss': list(self.validation_loss_history),
                         'validation_metrics': validation_metrics,
                         'best_epoch': best_epoch, 'stopped_epoch': state['stopped_epoch'],
                         'stop_reason': stop_reason}
        return self.history_

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
                                epochs=self.epochs, random_state=self.random_state, l2=self.l2,
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
            self.random_state, self.l2 = int(saved['random_state']), float(saved['l2'])
            self.train_loss_history = saved['train_loss_history'].tolist()
            self.validation_loss_history = saved['validation_loss_history'].tolist()
        return self
