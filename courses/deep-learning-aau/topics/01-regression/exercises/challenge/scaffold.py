import numpy as np

# DO NOT CHANGE THE NAME OF THE CLASS IF YOU WANT TO SUBMIT 
# TO THE BENCHMARK ONLINE.
class Regression:
    def __init__(self):
        self.theta = None # The parameters (weights) of the model
    
    def fit(self, X, y):
        """
        X: numpy array of shape (n_samples, n_features)
        y: numpy array of shape (n_samples,)
        """
        # TODO: your code here
        return self

    def predict(self, X):
        """
        X: numpy array of shape (n_samples, n_features)

        Return:
            numpy array or list of shape (n_samples,)
        """
        # TODO: your code here
        return np.zeros(X.shape[0])