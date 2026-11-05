import numpy as np

class Controller():
    """Multinomial logistic regression on nonlinear observation features."""
    def __init__(self, learning_rate=0.01, epochs=1000):
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.weights = None
        self.bias = None
        self.loss_history = []
    
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
        return int(self.predict(observation.reshape(1, -1))[0])
    
    def cross_entropy_loss(self, y_true, y_pred):
        eps = 1e-12
        y_pred = np.clip(y_pred, eps, 1.0)
        correct = y_pred[np.arange(len(y_true)), y_true]
        return -np.mean(np.log(correct))
    
    def _basis_functions(self, X):
        # Normalize raw observations before forming powers and interactions.
        z = (np.asarray(X, dtype=float) - self.mean_) / self.scale_
        i, j = np.triu_indices(z.shape[1])
        # Quadratic interactions model effects such as position × velocity and
        # tilt × angular velocity; magnitudes capture symmetric responses.
        return np.column_stack((z, np.abs(z), z * np.abs(z), z[:, i] * z[:, j]))

    def create_design_matrix(self, X):
        features = self._basis_functions(X)
        return (features - self.basis_mean_) / self.basis_scale_
    
    def fit(self, X, y):
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
        self.mean_ = X.mean(axis=0)
        self.scale_ = X.std(axis=0)
        self.scale_[self.scale_ == 0] = 1.0
        basis = self._basis_functions(X)
        self.basis_mean_ = basis.mean(axis=0)
        self.basis_scale_ = basis.std(axis=0)
        self.basis_scale_[self.basis_scale_ < 1e-12] = 1.0
        X = self.create_design_matrix(X)
        n_samples, n_features = X.shape
        self.classes_, labels = np.unique(y, return_inverse=True)
        n_classes = len(self.classes_)
        targets = np.eye(n_classes)[labels]

        self.weights = np.zeros(
            (n_features, n_classes)
        )
        self.bias = np.zeros(n_classes)
        self.loss_history = []

        for _ in range(self.epochs):
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
