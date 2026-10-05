### Chapter 3: Linear Regression
**Key Ideas**
1. Regression is projection — the geometry underlies everything
2. Coefficients are partial effects — interpretation requires care
3. Assumptions are hypotheses — diagnostics are how you test them

**Content**

*Part A — Scalar Form*
- Simple linear regression with one predictor
- OLS derivation by minimizing sum of squared residuals — calculus, no matrices
- Geometric intuition — fitting a line, residuals as vertical distances
- R², goodness of fit, residual standard error
- Inference — standard errors, t-tests, confidence and prediction intervals

*Part B — Matrix Form*
- Motivation — why scalar form breaks down with many predictors
- Design matrix, normal equations, OLS solution derived
- Geometric interpretation revisited — projection onto column space
- Gauss-Markov in matrix language

*Part C — Multiple Regression*
- Partial effects and interpretation
- Multicollinearity, VIF
- Categorical predictors and contrast coding
- F-tests, adjusted R²

*Part D — Diagnostics & Assumptions*
- Heteroskedasticity, autocorrelation, influential points
- Cook's distance, leverage
- Remedies

*Part E — Flexible Regression*
- Polynomial regression — extending linearity, overfitting risk
- Splines — piecewise polynomials, knots, natural splines
- A brief introduction to GAMs — signpost to extended reference

*Part F — Bridge to GLMs*
- Exponential family, link functions
- Logistic and Poisson as previews

**Prerequisites:** Ch 1, linear algebra, calculus
**Cross-references:** Ch 3 (classification), Ch 4 (regularization), Ch 10 (causal inference)

---
### Chapter 4: Classification
**Key Ideas**
1. Classification is probabilistic — outputs are distributions, not just labels
2. Metric choice encodes real-world priorities
3. Generative and discriminative are two fundamentally different stances toward the same problem

**Content**

*Part A — From Regression to Classification*
- Why linear regression breaks down for categorical outcomes
- The decision boundary idea
- Introducing the Bernoulli likelihood

*Part B — Logistic Regression*
- Log-odds, the sigmoid, cross-entropy loss
- Multinomial extension and softmax
- Inference and coefficient interpretation

*Part C — Evaluating Classifiers*
- Confusion matrices, precision, recall, F1
- ROC curves and AUC
- Calibration — why a confident model isn't always a good one
- Why accuracy is often the wrong metric

*Part D — Generative vs Discriminative*
- Naïve Bayes, LDA/QDA
- Modelling the joint vs conditional distribution
- When generative models win

*Part E — K-Nearest Neighbours*
- The KNN algorithm — decision boundaries from local majority vote
- The role of k — bias-variance tradeoff in nonparametric terms
- Distance metrics and their assumptions
- The curse of dimensionality — why KNN breaks in high dimensions

*Part F — Decision Trees*
- Entropy, Gini impurity, information gain
- Splitting criteria, pruning, overfitting
- Signpost to Chapter 8 — limitations of single trees and how ensembles address them

**Prerequisites:** Ch 1, Ch 2, probability
**Cross-references:** Ch 4 (regularization), Ch 8 (ensemble methods), Ch 11 (neural networks)

---

