import numpy as np

# This is the version number so you can align your saved weights and expected features.
# You don't have to change this.
FEATURE_VERSION = 1

# DO NOT CHANGE THE CLASS NAME
# It is required by the online evaluation
class Controller:
    """
    This is the scaffold class for your controller.
    
    It is complete for a linear model with softmax output. You must make at least 2 informed changes to the class:
    - This could be polynomial features
    - It could be lag features (and as such you may need to store a history of observations)
    - It could be RBF features or even custom physics-informed features
    
    Note: Normalisation, regularisation do not count as informed changes.
    """
    # The __init__ method can contain any parameters you want to save or use later.
    # Be aware that the online evaluation will call the default constructor, so any parameters you want to use must have default values.
    # For example, if you find that you need 1000 epochs then you must set this as the default if you intend to train it in the browser.
    def __init__(self, learning_rate=0.1, epochs=10):
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.weights = None
        self.train_loss_history = []
        self.validation_loss_history = []

    def save(self, path):
        """
        Save trained parameters for later evaluation.
        The usage is like this:
            model.save("controller.npz") 
        Then you can upload the file to the online evaluation.
        """
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        with open(path, "wb") as target:
            # Add anything your model needs to save here. 
            # You can add more fields to the np.savez_compressed call if you need to save more parameters.
            np.savez_compressed(
                target, 
                feature_version=FEATURE_VERSION, 
                weights=self.weights, 
                classes=self.classes_,
                learning_rate=self.learning_rate, 
                epochs=self.epochs,
                train_loss_history=self.train_loss_history,
                validation_loss_history=self.validation_loss_history,
                mean=self.X_mean_, 
                std=self.X_std_
            )

    def load(self, path):
        """
        Restore a saved model. The usage is like this:
            model.load("controller.npz")
        """
        with np.load(path, allow_pickle=False) as saved:
            if 'feature_version' not in saved or int(saved['feature_version']) != FEATURE_VERSION:
                raise ValueError('Saved weights use an incompatible feature version; retrain and save the model again.')
            # Again if you add more fields you need to save you must update this to load them as well.
            self.weights = saved["weights"]
            self.classes_ = saved["classes"] if "classes" in saved else np.arange(self.weights.shape[1])
            self.learning_rate = float(saved["learning_rate"])
            self.epochs = int(saved["epochs"])
            self.train_loss_history = saved["train_loss_history"].tolist()
            self.validation_loss_history = saved["validation_loss_history"].tolist()
            self.X_mean_ = saved["mean"]
            self.X_std_ = saved["std"]
        return self
    
    # Softmax function to convert raw scores to probabilities
    @staticmethod
    def _softmax(scores):
        shifted = scores - np.max(scores, axis=1, keepdims=True)
        exp_scores = np.exp(shifted)
        return exp_scores / np.sum(exp_scores, axis=1, keepdims=True)
    
    def decision_function(self, X):
        if self.weights is None:
            raise ValueError("Model has not been trained yet.")
        return np.dot(self._create_design_matrix(X), self.weights)
    
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
        features = self._create_design_matrix(observation[None, :])
        action = int(self.classes_[np.argmax(features @ self.weights, axis=1)[0]])
        return action
    
    # See: https://archie-c.github.io/courses/deep-learning-aau/topics/02-classification/multiclass-classification-and-softmax/
    # You can adjust this if you want, there may be improvements to be found in the loss function.
    def cross_entropy_loss(self, y_true, y_pred):
        eps = 1e-12
        y_pred = np.clip(y_pred, eps, 1.0)
        return -np.mean(np.sum(y_true * np.log(y_pred), axis=1))

    def _create_design_matrix(self, X):
        X = np.asarray(X, dtype=float)
        # Add the features before adding the bias term. For example, if you want to add polynomial features, you can do it here.
        
        self.X_mean_ = np.mean(X, axis=0)
        self.X_std_ = np.std(X, axis=0)
        X = (X - self.X_mean_) / (self.X_std_ + 1e-12)  # Normalize features to have mean 0 and std 1
        
        X = np.column_stack((np.ones(X.shape[0]), X))  # Add bias term
        return X
    
    def _one_hot_encode(self, y):
        y = np.asarray(y)
        self.classes_, labels = np.unique(y, return_inverse=True)
        n_classes = len(self.classes_)
        return n_classes, np.eye(n_classes)[labels]
    
    def fit(self, train_X, train_y, validation_X=None, validation_y=None):
        
        # Build the design matrix
        train_X = self._create_design_matrix(train_X)
        n_samples, n_features = train_X.shape
        
        # Convert the class labels to one-hot encoding
        n_classes, train_targets = self._one_hot_encode(train_y)
        
        # Initialise the weights
        self.weights = np.zeros(
            (n_features, n_classes)
        )
        
        # As we are using gradient descent, it's useful to keep track of the loss history for both training and validation
        # It can help us see if a model is overfitting or underfitting, and can also be used to implement early stopping if desired.
        if validation_X is not None and validation_y is not None:
            validation_X = self._create_design_matrix(validation_X)
            validation_y = np.asarray(validation_y)
            if not np.all(np.isin(validation_y, self.classes_)):
                raise ValueError("Validation labels must also appear in the training data.")
            validation_targets = (validation_y[:, None] == self.classes_).astype(float)
            
        # Reset the histories even if we aren't using the validation so its not carried over from a previous call.
        self.train_loss_history = []
        self.validation_loss_history = []
        
        # In this case, we are using the whole training set for each epoch.
        # If you are limited by memory you can modify this to use mini-batches.    
        for epoch in range(self.epochs):
            
            # Generate some probabilities for the training set
            probabilities = self._softmax(train_X @ self.weights)
            # Use the cross-entropy loss to evaluate the model's performance
            self.train_loss_history.append(
                self.cross_entropy_loss(train_targets, probabilities)
            )
            # If we have validation data, we can also evaluate the model's performance on that set
            if validation_X is not None and validation_y is not None:
                val_probabilities = self._softmax(validation_X @ self.weights)
                self.validation_loss_history.append(
                    self.cross_entropy_loss(validation_targets, val_probabilities)
                )
            progress = f"Epoch {epoch + 1}/{self.epochs} Train Loss: {self.train_loss_history[-1]:.4f}"
            if self.validation_loss_history:
                progress += f" Validation Loss: {self.validation_loss_history[-1]:.4f}"
            print(progress, end="\r")
            # Compute the update from the gradient of the loss function with respect to the weights
            error = probabilities - train_targets
            dw = train_X.T @ error / n_samples
            self.weights -= self.learning_rate * dw

        return self
