
import numpy as np


# DO NOT CHANGE THE CLASS NAME IF YOU WANT TO SUBMIT TO THE ONLINE BENCHMARK.
class Regression:
    """
    This model uses the exact data generating function.
    
    I was not expecting you to get this but its a good target.
    It falls back to simple regression if the data is not in time order.
    """

    A, B, C = 1.10, 0.83, 0.80
    LAG = 11

    def __init__(self):
        self.theta = None
        self.theta_flat = None
        self._ordered = False
        self._tail = None
        self._step_std = None
        self._s35_mean = 0.0

    @staticmethod
    def _is_ordered(X):
        """Check whether the rows appear to be in time order."""
        if len(X) < 30:
            return False

        changes = np.diff(X, axis=0).std(axis=0)
        overall = X.std(axis=0) + 1e-12

        return float(np.mean(changes / overall)) < 0.7

    def _continues(self, X):
        """Check whether X follows directly after the training data."""
        if self._tail is None or self._step_std is None:
            return False

        difference = np.abs(X[0] - self._tail[-1])
        scaled_difference = difference / (self._step_std + 1e-12)

        return bool(np.max(scaled_difference) < 5.0)

    def _features(self, X, seq):
        """Create the features used to make predictions."""

        # Get the seven input columns.
        x1, x2, x3, x4, x5, x6, x7 = (X[:, i] for i in range(7))

        # Calculate differences between the inputs.
        s12 = x1 - self.A * x2
        s35 = x3 - self.B * x5
        s46 = x4 - self.C * x6

        # 1 when s12 is positive, otherwise 0.
        positive = (s12 > 0).astype(float)

        # Features that do not need time information.
        features = [
            np.ones(len(X)),
            s12,
            s35,
            s46,
            s12 ** 2,
            s35 * s46,
            np.sin(0.5 * s12),
            x7 * positive,
            positive,
        ]

        if seq:
            # Calculate changes between consecutive rows.
            log1 = np.log(np.maximum(x1, 1e-9))
            log5 = np.log(np.maximum(x5, 1e-9))

            change1 = np.zeros(len(X))
            change5 = np.zeros(len(X))

            change1[1:] = np.diff(log1)
            change5[1:] = np.diff(log5)

            # Use the value of s35 from LAG rows earlier.
            past_s35 = np.full(len(X), self._s35_mean)

            if len(X) > self.LAG:
                past_s35[self.LAG:] = s35[:-self.LAG]

            # Add the two features that use time information.
            features += [
                change1 * change5,
                past_s35 * s46,
            ]

        return np.column_stack(features)

    @staticmethod
    def _solve(features, y):
        """Find the weights using least squares."""
        weights = np.linalg.lstsq(features, y, rcond=None)[0]
        return weights

    def fit(self, X, y):
        """
        Train the model.

        X: Input data, shape (n_samples, n_features)
        y: Target values, shape (n_samples,)
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).ravel()

        # Calculate values needed by the model.
        self._s35_mean = float(np.mean(X[:, 2] - self.B * X[:, 4]))
        self._ordered = self._is_ordered(X)

        # Train a basic model that does not use time information.
        basic_features = self._features(X, seq=False)
        self.theta_flat = self._solve(basic_features, y)

        # Train a second model if the data is in time order.
        if self._ordered and len(X) > 3 * self.LAG:
            features = self._features(X, seq=True)

            # Skip the first LAG rows because their history is missing.
            self.theta = self._solve(
                features[self.LAG:],
                y[self.LAG:]
            )

            # Save the last rows for future predictions.
            self._tail = X[-self.LAG:].copy()
            self._step_std = np.diff(X, axis=0).std(axis=0)

        else:
            self.theta = None
            self._tail = None

        return self

    def predict(self, X):
        """
        Predict the target values.

        X: Input data, shape (n_samples, n_features)

        Returns:
            Predictions, shape (n_samples,)
        """
        X = np.asarray(X, dtype=float)

        # Allow a single row as input.
        if X.ndim == 1:
            X = X[None, :]

        # Use the time-based model when possible.
        if self.theta is not None:

            # If X continues the training data, include its last rows.
            if self._continues(X):
                history = self._tail
                combined = np.vstack([history, X])

                features = self._features(combined, seq=True)
                features = features[len(history):]

                return features @ self.theta

            # Otherwise, use X's own time information.
            if self._is_ordered(X):
                features = self._features(X, seq=True)
                return features @ self.theta

        # Otherwise, use the basic model.
        features = self._features(X, seq=False)
        return features @ self.theta_flat
