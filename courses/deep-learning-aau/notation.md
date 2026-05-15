# Appendix B — Notation Reference
*Machine Learning & Deep Learning — Masters Level Reference Text*

---

## 1. Sets & General Math

### Sets
| Symbol | Meaning |
|--------|---------|
| ℝ | Real numbers |
| ℝⁿ | Real n-dimensional space |
| ℤ | Integers |
| ℕ | Natural numbers |
| 𝒳 | Input space (calligraphic for general sets) |
| 𝒴 | Output space |
| x ∈ 𝒳 | x is a member of set 𝒳 |
| \|𝒮\| | Cardinality of set 𝒮 |

### Intervals & Ranges
| Symbol | Meaning |
|--------|---------|
| [a, b] | Closed interval |
| (a, b) | Open interval |
| [n] | Shorthand for {1, ..., n} |

### General Math
| Symbol | Meaning |
|--------|---------|
| := | Equality by definition |
| ∝ | Proportional to |
| ≈ | Approximately equal |
| 𝟙[condition] | Indicator function, e.g. 𝟙[y = 1] |

### Norms
| Symbol | Meaning |
|--------|---------|
| ‖x‖₁ | L1 norm |
| ‖x‖₂ or ‖x‖ | L2 norm |
| ‖x‖ₚ | Lp norm |
| ‖A‖_F | Frobenius norm |

### Functions
| Symbol | Meaning |
|--------|---------|
| f : 𝒳 → 𝒴 | Function f mapping from 𝒳 to 𝒴 |
| f ∘ g | Composition of f and g |
| arg max | Argument of the maximum |
| arg min | Argument of the minimum |

---

## 2. Data & Indexing

### Sample & Dimensionality
| Symbol | Meaning |
|--------|---------|
| n | Number of training samples |
| d | Input dimensionality |
| K | Number of classes |
| L | Number of layers |

### Samples & Features
| Symbol | Meaning |
|--------|---------|
| x ∈ ℝᵈ | A single input vector |
| y | A single output / label |
| xᵢ | The i-th training sample |
| x_{i,j} | The j-th feature of sample i |
| 𝒟 = {(xᵢ, yᵢ)}ⁿᵢ₌₁ | The full dataset |

### The Design Matrix
| Symbol | Meaning |
|--------|---------|
| X ∈ ℝⁿˣᵈ | Design matrix — rows are samples, columns are features |
| xᵢᵀ | The i-th row of X (one sample) |
| xⱼ | The j-th column of X (one feature) |

### Indexing Conventions
| Symbol | Meaning |
|--------|---------|
| i | Indexes samples (i = 1, ..., n) |
| j | Indexes features (j = 1, ..., d) |
| k | Indexes classes (k = 1, ..., K) |
| t | Indexes time steps |
| l | Indexes layers |

---

## 3. Linear Algebra

### Typesetting Conventions
| Symbol | Meaning |
|--------|---------|
| a, x, λ | Scalar — lowercase italic |
| **x**, **w**, **b** | Vector — lowercase bold |
| **X**, **W**, **A** | Matrix — uppercase bold |
| 𝒯 | Tensor — uppercase calligraphic |

### Operations
| Symbol | Meaning |
|--------|---------|
| **A**ᵀ | Transpose |
| **A**⁻¹ | Inverse |
| **A**⁺ | Pseudoinverse (Moore-Penrose) |
| det(**A**) or \|**A**\| | Determinant |
| tr(**A**) | Trace |
| **x**ᵀ**y** or ⟨**x**, **y**⟩ | Dot product |
| **x** ⊙ **y** | Element-wise (Hadamard) product |
| **A** ⊗ **B** | Kronecker product |

### Eigendecomposition & SVD
| Symbol | Meaning |
|--------|---------|
| λ | Eigenvalue |
| **v** | Eigenvector |
| **A** = **V**Λ**V**ᵀ | Eigendecomposition |
| σ₁ ≥ σ₂ ≥ ... ≥ 0 | Singular values in descending order |
| **A** = **U**Σ**V**ᵀ | Singular value decomposition |

### Shapes & Subspaces
| Symbol | Meaning |
|--------|---------|
| ℝⁿˣᵈ | Shape of a matrix — n rows, d columns |
| rank(**A**) | Rank of matrix **A** |
| col(**A**) | Column space of **A** |
| null(**A**) | Null space of **A** |

---

## 4. Probability

### Random Variables & Distributions
| Symbol | Meaning |
|--------|---------|
| X, Y | Random variable — uppercase |
| x, y | Realisation of a random variable — lowercase |
| P(X = x) | Probability of an event |
| p(x) | Probability density function |
| P(x) | Probability mass function |
| p(x, y) | Joint distribution |
| p(y \| x) | Conditional distribution |
| p(x) = ∫ p(x, y) dy | Marginal distribution |

### Expectations & Moments
| Symbol | Meaning |
|--------|---------|
| 𝔼[X] | Expectation of X |
| 𝔼_{x~p}[f(x)] | Expectation of f(x) under distribution p |
| Var(X) or σ² | Variance |
| σ | Standard deviation |
| Cov(X, Y) | Covariance between X and Y |
| **Σ** | Covariance matrix |

### Common Distributions
| Symbol | Meaning |
|--------|---------|
| 𝒩(μ, σ²) | Univariate Gaussian with mean μ and variance σ² |
| 𝒩(**μ**, **Σ**) | Multivariate Gaussian with mean **μ** and covariance **Σ** |
| Bern(p) | Bernoulli distribution with parameter p |
| Cat(**π**) | Categorical distribution with probabilities **π** |
| Dir(**α**) | Dirichlet distribution with concentration **α** |
| Beta(α, β) | Beta distribution with parameters α, β |

### Information Theory
| Symbol | Meaning |
|--------|---------|
| H(X) or H(p) | Entropy of X or distribution p |
| H(p, q) | Cross-entropy between p and q |
| D_KL(p ‖ q) | KL divergence from q to p |
| I(X; Y) | Mutual information between X and Y |

---

## 5. ML Specific Notation

### Parameters & Models
| Symbol | Meaning |
|--------|---------|
| **θ** | Model parameters (general) |
| **w** | Weight vector |
| b | Bias term |
| Θ | Parameter space |
| **θ̂** | Estimated / learned parameters |
| f_**θ**(x) | Model function parameterised by **θ** |
| ℋ | Hypothesis class |

### Loss & Risk
| Symbol | Meaning |
|--------|---------|
| ℓ(ŷ, y) | Loss function |
| L(**θ**) | Empirical risk — (1/n) Σ ℓ(f_**θ**(xᵢ), yᵢ) |
| R(**θ**) | Expected risk — 𝔼[ℓ(f_**θ**(x), y)] |
| Ω(**θ**) | Regularisation term |
| λ | Regularisation strength |

### Predictions
| Symbol | Meaning |
|--------|---------|
| ŷ | Predicted output |
| y | True label |
| p̂ | Predicted probability |
| f_**θ**(x) = 0 | Decision boundary |

### Optimisation
| Symbol | Meaning |
|--------|---------|
| ∇_**θ** L(**θ**) | Gradient of loss with respect to **θ** |
| **H** or ∇²L | Hessian matrix |
| η | Learning rate |
| t | Training iteration / step |
| **θ** ← **θ** - η∇L(**θ**) | Gradient update rule |

### Regularisation
| Symbol | Meaning |
|--------|---------|
| λ‖**θ**‖² | L2 penalty |
| λ‖**θ**‖₁ | L1 penalty |
| λ | Regularisation hyperparameter |

---

## 6. Neural Network Notation

### Architecture
| Symbol | Meaning |
|--------|---------|
| L | Total number of layers |
| d_l | Width (number of units) at layer l |
| 0 | Index of input layer |
| L | Index of output layer |

### Weights & Biases
| Symbol | Meaning |
|--------|---------|
| **W**^(l) ∈ ℝ^{d_l × d_{l-1}} | Weight matrix at layer l |
| **b**^(l) ∈ ℝ^{d_l} | Bias vector at layer l |
| **θ** = {**W**^(l), **b**^(l)}^L_{l=1} | All parameters collected |

### Activations
| Symbol | Meaning |
|--------|---------|
| **z**^(l) = **W**^(l)**a**^(l-1) + **b**^(l) | Pre-activation at layer l |
| **a**^(l) = σ(**z**^(l)) | Post-activation at layer l |
| **a**^(0) = **x** | Input layer activations |
| **a**^(L) = ŷ | Output layer activations |
| σ(·) | Activation function (general) |

### Gradients in Backpropagation
| Symbol | Meaning |
|--------|---------|
| **δ**^(l) | Error signal — loss gradient w.r.t. pre-activation at layer l |
| ∂L/∂**W**^(l) | Loss gradient w.r.t. weight matrix at layer l |
| ∂L/∂**b**^(l) | Loss gradient w.r.t. bias vector at layer l |

### Attention & Transformers
| Symbol | Meaning |
|--------|---------|
| **Q** | Query matrix |
| **K** | Key matrix |
| **V** | Value matrix |
| **A** = softmax(**QK**ᵀ/√d_k) | Attention scores |
| d_k | Dimension of keys and queries |
| H | Number of attention heads |

---

## 7. Reinforcement Learning Notation

### Core RL Objects
| Symbol | Meaning |
|--------|---------|
| s ∈ 𝒮 | State from state space 𝒮 |
| a ∈ 𝒜 | Action from action space 𝒜 |
| r ∈ ℝ | Reward |
| t | Time step |
| τ = (s₀, a₀, r₀, s₁, a₁, r₁, ...) | Trajectory / episode |

### Policy
| Symbol | Meaning |
|--------|---------|
| π(a \| s) | Stochastic policy — probability of action a in state s |
| a = π(s) | Deterministic policy |
| π* | Optimal policy |

### Value Functions
| Symbol | Meaning |
|--------|---------|
| V^π(s) | State value function under policy π |
| Q^π(s, a) | Action value function under policy π |
| V*(s) | Optimal state value function |
| Q*(s, a) | Optimal action value function |
| A^π(s, a) = Q^π(s, a) - V^π(s) | Advantage function |

### Returns & Discounting
| Symbol | Meaning |
|--------|---------|
| Gₜ = rₜ + γrₜ₊₁ + γ²rₜ₊₂ + ... | Discounted return |
| γ ∈ [0, 1] | Discount factor |
| δₜ = rₜ + γV(sₜ₊₁) - V(sₜ) | Temporal difference (TD) error |

### Environment
| Symbol | Meaning |
|--------|---------|
| p(s' \| s, a) | Transition dynamics |
| r(s, a) | Reward function |
| T | Finite horizon |
| α | Learning rate for value function updates (RL convention) |

---

## Quick Reference — Symbol Index

*A flat alphabetical index of all symbols for fast lookup.*

| Symbol | Meaning | Section |
|--------|---------|---------|
| 𝒜 | Action space | 7 |
| **a**^(l) | Post-activation at layer l | 6 |
| A^π(s, a) | Advantage function | 7 |
| **A** | Attention scores | 6 |
| α | RL learning rate for value updates | 7 |
| **b**^(l) | Bias vector at layer l | 6 |
| b | Bias term (general) | 5 |
| Bern(p) | Bernoulli distribution | 4 |
| Beta(α, β) | Beta distribution | 4 |
| Cat(**π**) | Categorical distribution | 4 |
| col(**A**) | Column space of **A** | 3 |
| Cov(X, Y) | Covariance | 4 |
| d | Input dimensionality | 2 |
| 𝒟 | Dataset | 2 |
| d_k | Dimension of keys/queries | 6 |
| d_l | Width of layer l | 6 |
| **δ**^(l) | Error signal at layer l | 6 |
| δₜ | TD error | 7 |
| det(**A**) | Determinant | 3 |
| Dir(**α**) | Dirichlet distribution | 4 |
| D_KL(p ‖ q) | KL divergence | 4 |
| 𝔼[X] | Expectation | 4 |
| f_**θ**(x) | Model function | 5 |
| γ | Discount factor | 7 |
| Gₜ | Discounted return | 7 |
| H | Number of attention heads | 6 |
| H(p) | Entropy | 4 |
| H(p, q) | Cross-entropy | 4 |
| **H** | Hessian matrix | 5 |
| ℋ | Hypothesis class | 5 |
| η | Learning rate (general) | 5 |
| i | Sample index | 2 |
| I(X; Y) | Mutual information | 4 |
| j | Feature index | 2 |
| k | Class index | 2 |
| **K** | Key matrix | 6 |
| K | Number of classes | 2 |
| l | Layer index | 2 |
| L | Number of layers | 2, 6 |
| L(**θ**) | Empirical risk | 5 |
| ℓ(ŷ, y) | Loss function | 5 |
| λ | Regularisation strength | 5 |
| n | Number of training samples | 2 |
| 𝒩(μ, σ²) | Univariate Gaussian | 4 |
| null(**A**) | Null space of **A** | 3 |
| Ω(**θ**) | Regularisation term | 5 |
| π(a \| s) | Policy | 7 |
| π* | Optimal policy | 7 |
| p(x) | Probability density function | 4 |
| P(x) | Probability mass function | 4 |
| **Q** | Query matrix | 6 |
| Q^π(s, a) | Action value function | 7 |
| r | Reward | 7 |
| R(**θ**) | Expected risk | 5 |
| rank(**A**) | Rank of **A** | 3 |
| s ∈ 𝒮 | State | 7 |
| 𝒮 | State space | 7 |
| σ | Standard deviation | 4 |
| σ(·) | Activation function | 6 |
| **Σ** | Covariance matrix | 4 |
| t | Time step / training iteration | 2, 7 |
| T | Finite horizon | 7 |
| τ | Trajectory | 7 |
| Θ | Parameter space | 5 |
| **θ** | Model parameters | 5 |
| **θ̂** | Estimated parameters | 5 |
| tr(**A**) | Trace | 3 |
| **V** | Value matrix (attention) | 6 |
| V^π(s) | State value function | 7 |
| Var(X) | Variance | 4 |
| **w** | Weight vector | 5 |
| **W**^(l) | Weight matrix at layer l | 6 |
| x ∈ ℝᵈ | Input vector | 2 |
| **X** | Design matrix | 2 |
| xᵢ | i-th training sample | 2 |
| 𝒳 | Input space | 1 |
| y | True label | 2 |
| ŷ | Predicted output | 5 |
| 𝒴 | Output space | 1 |
| **z**^(l) | Pre-activation at layer l | 6 |

---

*Notation reference complete. 7 sections, full symbol index.*
