import numpy as np


class Classification:
    def fit(self, X, y):
        """Fit the classifier using NumPy arrays X and y."""
        raise NotImplementedError("Implement model fitting here")

    def predict(self, X):
        """Return one hard class label (0 or 1) per row in X."""
        raise NotImplementedError("Implement class predictions here")
