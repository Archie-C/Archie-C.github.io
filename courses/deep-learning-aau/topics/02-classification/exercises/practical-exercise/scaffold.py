import numpy as np


class Classification:
    def __init__(self):
        self.learning_rate = None
        self.epochs = None
        self.weights = None
        self.bias = None
        self.loss_history = None
    
    def fit(self, X, y):
        """Fit the classifier using NumPy arrays X and y."""
        return self

    def predict(self, X):
        """Return one hard class label (0 or 1) per row in X."""
        return np.zeros(X.shape[0], dtype=int)
