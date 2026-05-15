# Machine Learning & Deep Learning — Textbook Outline
*Masters Level Reference Text*

---

## Purpose
A comprehensive reference textbook for a masters-level ML/DL course. Written as a self-contained reference — each chapter is a mini textbook entry, not a lecture companion. Chapters can be assigned selectively depending on the course structure in any given year.

---

## Structure

- **Part 1 — Foundations**
- **Part 2 — Core ML**
- **Part 3 — Deep Learning Foundations**
- **Part 4 — Modern Deep Learning**
- **Part 5 — Critical Perspectives**
- **Extended Reference Chapters**

---

## Part 1 — Foundations

### Chapter 1: The Statistical Learning Framework
**Key Ideas**
1. Learning is approximating an unknown data generating process
2. The choice of loss function encodes real-world priorities
3. The bias-variance tradeoff is a theme, not a one-time result

**Content**
- What is learning? The data generating process, inputs and outputs
- Loss functions — squared error, cross-entropy, 0-1 loss and why it's hard
- Empirical risk minimization
- The bias-variance tradeoff — introduced as a theme, not derived fully yet
- Prediction vs inference — a distinction that runs through the whole text
- Overfitting and underfitting intuitively
- The train/test split as a philosophical commitment
- Parametric vs nonparametric models
- A map of the whole landscape — supervised, unsupervised, RL

**Prerequisites:** Probability & statistics basics, calculus
**Cross-references:** Ch 2 (regression), Ch 3 (classification), Ch 5 (model selection)

---

### Chapter 2: Data
**Key Ideas**
1. Data quality determines model quality — no algorithm rescues bad data
2. Every data decision encodes an assumption — making them explicit is half the battle
3. Practitioners spend more time on data than models — this chapter reflects that reality

**Content**

*Part A — Data Collection & Measurement*
- Where data comes from — observational, experimental, synthetic
- Measurement error and its consequences
- Sampling bias — when your data doesn't represent the population you care about
- Label quality — annotation errors, inter-annotator agreement

*Part B — Exploratory Data Analysis*
- Summary statistics — means, medians, variances, and when they mislead
- Visualisation for EDA — distributions, correlations, outliers
- Anscombe's quartet and the limits of summary statistics
- Understanding your data before modelling it

*Part C — Feature Engineering*
- Transformations — log, sqrt, Box-Cox, standardisation, normalisation
- Encoding categorical variables — one-hot, ordinal, target encoding
- Interaction terms and derived features
- Domain knowledge as a feature engineering guide
- Feature engineering vs feature learning — when deep learning changes the game

*Part D — Missing Data*
- Types of missingness — MCAR, MAR, MNAR — the taxonomy matters
- Complete case analysis — when it's okay and when it isn't
- Imputation strategies — mean, median, model-based, multiple imputation
- Missing as a feature — when missingness itself is informative

*Part E — Class Imbalance*
- Why imbalance is a problem — the accuracy paradox
- Resampling strategies — SMOTE, oversampling, undersampling
- Cost-sensitive learning — reweighting the loss
- Evaluation under imbalance — back to precision, recall, AUC

*Part F — Data Splitting & Leakage*
- Train, validation, test — what each is for and why all three are needed
- Temporal splits — why random splits fail for time series data
- Data leakage — the most common way to get optimistic results
- Leakage from preprocessing — why scalers must be fit on training data only

*Part G — Data at Scale*
- When data doesn't fit in memory
- Data versioning — why reproducibility requires treating data like code
- Annotation pipelines — labelling at scale, active learning as a strategy
- Synthetic data — when and why to generate it

**Prerequisites:** Ch 1, basic statistics
**Cross-references:** Ch 3 (class imbalance and evaluation), Ch 5 (leakage and cross-validation), Ch 19 (sampling bias and causal inference), Ch 21 (data pipelines at scale)

---

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

### Chapter 5: Regularization
**Key Ideas**
1. Regularization is bias traded deliberately for variance reduction
2. L1 and L2 penalties have fundamentally different geometric stories
3. Every penalty term has a Bayesian interpretation as a prior

**Content**

*Part A — The Problem*
- Overfitting revisited — why complex models fail on new data
- The bias-variance tradeoff derived properly here for the first time
- Why OLS breaks down in high dimensions

*Part B — Ridge Regression (L2)*
- Penalty term, shrinkage, the ridge solution in matrix form
- Three motivations — constraint, penalty, and prior (Gaussian prior on coefficients)
- Effect on coefficients — shrinks but never zeros
- The ridge trace

*Part C — Lasso (L1)*
- L1 penalty, sparsity, why Lasso zeros coefficients where Ridge doesn't
- Geometric intuition — corners of the L1 ball
- Coordinate descent as the fitting algorithm
- When to prefer Lasso over Ridge

*Part D — Elastic Net*
- Combining L1 and L2
- When it's needed — correlated predictors, p >> n settings

*Part E — Cross-Validation for Tuning*
- K-fold cross-validation derived properly
- The lambda path
- One standard error rule

*Part F — Regularization Beyond Regression*
- L2 in logistic regression
- Connection to SVM margins (signpost to Chapter 10)
- Regularization as a universal principle

**Prerequisites:** Ch 1, Ch 2, Ch 3
**Cross-references:** Ch 5 (model selection), Ch 7 (Bayesian methods), Ch 10 (SVMs)

---

### Chapter 6: Model Selection & Generalization
**Key Ideas**
1. Generalisation is the only thing that matters — training performance is a means not an end
2. Cross-validation done wrongly is worse than not doing it — leakage is everywhere
3. Double descent breaks the classical intuition and is worth understanding

**Content**

*Part A — What Are We Actually Optimising For?*
- Training error vs test error — why they diverge
- The optimism of training error
- In-sample vs out-of-sample performance

*Part B — Cross-Validation*
- K-fold properly — what each fold is actually estimating
- Leave-one-out cross-validation and its relationship to AIC
- Stratification, data leakage, and common mistakes
- Nested cross-validation for simultaneous tuning and evaluation

*Part C — Information Criteria*
- AIC — derivation and intuition
- BIC — the Bayesian argument for stronger penalisation
- When they agree, when they don't, and which to trust

*Part D — The Bias-Variance Tradeoff Unified*
- Formal decomposition of expected test error
- How model complexity moves bias and variance
- The double descent phenomenon — when more complexity helps again

*Part E — Hyperparameter Tuning Strategies*
- Grid search, random search, Bayesian optimisation
- Early stopping as implicit regularization

*Part F — A Framework for Model Comparison*
- Statistical tests for comparing models
- Practical significance vs statistical significance
- Building a model selection pipeline

**Prerequisites:** Ch 1, Ch 2, Ch 3, Ch 4
**Cross-references:** Ch 4 (regularization), Ch 8 (ensemble methods), Ch 12 (training deep networks)

---

### Chapter 7: Unsupervised Learning
**Key Ideas**
1. Unsupervised learning is about finding structure — but structure is in the eye of the beholder
2. PCA is not just a preprocessing step — it's a model with assumptions
3. Visualisation methods like t-SNE distort — knowing what they preserve matters

**Content**

*Part A — What Changes Without Labels?*
- The unsupervised setting — no outcome, no loss function in the traditional sense
- What we're looking for — structure, compression, density
- Evaluation is harder — why that matters

*Part B — Clustering*
- K-means — algorithm, objective, limitations
- Hierarchical clustering — linkage methods, dendrograms
- Gaussian Mixture Models — soft assignments, EM algorithm
- How to choose k — elbow method, silhouette scores, BIC for GMMs

*Part C — Dimensionality Reduction*
- PCA — variance maximisation, eigendecomposition, connection to regression geometry
- How many components — scree plots, explained variance
- t-SNE — perplexity, crowding problem, what it preserves and what it distorts
- UMAP — topological motivation, when to prefer it over t-SNE

*Part E — Autoencoders*
- Autoencoders as unsupervised representation learning — encoder, bottleneck, decoder
- The reconstruction loss
- What the latent space learns — compression vs representation
- Denoising autoencoders — robustness through corruption
- Limitations — why a regular autoencoder latent space doesn't generate well, signpost to VAEs in Chapter 17

*Part F — Density Estimation*
- Histograms and their limitations
- Kernel density estimation
- Connection to generative models (signpost to Chapter 17)

**Prerequisites:** Ch 1, linear algebra, probability
**Cross-references:** Ch 2 (PCA connects to regression geometry), Ch 7 (Bayesian view of GMMs), Ch 17 (generative models)

---

### Chapter 8: Probabilistic & Bayesian Methods
**Key Ideas**
1. MAP estimation is just regularized likelihood — Bayes and penalization are the same thing
2. Uncertainty quantification is as important as point prediction
3. Gaussian processes are the natural Bayesian nonparametric regression model

**Content**

*Part A — The Bayesian Worldview*
- Probability as degree of belief vs frequency
- Bayes' theorem revisited — prior, likelihood, posterior
- The Bayesian vs frequentist divide — not a religious war, a practical choice

*Part B — Bayesian Inference*
- Conjugate priors — Beta-Binomial, Gaussian-Gaussian
- Posterior predictive distribution
- Maximum a posteriori (MAP) estimation — connection back to regularization
- Credible intervals vs confidence intervals

*Part C — Approximate Inference*
- When posteriors are intractable
- MCMC — Metropolis-Hastings, Gibbs sampling, intuition without full derivation
- Variational inference — ELBO, mean field, signpost to VAEs in Chapter 17

*Part D — Gaussian Processes*
- From parametric to non-parametric Bayesian models
- The GP prior over functions
- Kernels and covariance functions
- GP regression — posterior mean and variance, uncertainty quantification
- Computational challenges and approximations

*Part E — Bayesian Model Comparison*
- Marginal likelihood, Bayes factors
- Occam's razor as a mathematical consequence
- Connection back to AIC/BIC from Chapter 5

**Prerequisites:** Ch 1, Ch 4, probability and statistics
**Cross-references:** Ch 4 (MAP as regularization), Ch 5 (model comparison), Ch 10 (kernels), Ch 17 (variational inference and VAEs)

---

---

> **Note on reordering:** Optimization (originally Ch 9) moved to Ch 8, Ensemble Methods (originally Ch 8) moved to Ch 9, to ensure gradient descent machinery is in place before gradient boosting is introduced.

---

### Chapter 9: Optimization
**Key Ideas**
1. The learning rate is the most important hyperparameter — understanding why requires understanding the loss surface
2. SGD's noise is a feature not a bug in non-convex settings
3. Adam is not magic — knowing when it fails makes you a better practitioner

**Content**

*Part A — What Are We Optimising?*
- Loss surfaces — what they look like, why they're hard
- Convex vs non-convex problems
- Local minima, saddle points, flat regions — the real landscape of deep learning loss surfaces

*Part B — Gradient Descent*
- The gradient as direction of steepest ascent
- Gradient descent derived — step size, the learning rate
- Convergence conditions for convex problems
- Batch gradient descent — exact but slow

*Part C — Stochastic & Mini-Batch Gradient Descent*
- SGD — why noise helps escape local minima
- Mini-batch as a compromise — computational and statistical efficiency
- The gradient as a noisy estimate — variance and bias tradeoffs

*Part D — Adaptive & Momentum Methods*
- Momentum — smoothing the trajectory
- RMSProp — adaptive learning rates per parameter
- Adam — combining momentum and adaptive rates, why it dominates in practice
- AdamW — decoupled weight decay, why L2 regularization and weight decay are not the same thing in Adam, why AdamW is now the default in most modern training
- When Adam/AdamW fails and SGD with momentum wins

*Part E — Learning Rate Strategies*
- Learning rate schedules — step decay, cosine annealing
- Warm-up and its importance for transformers
- Learning rate finders

*Part F — Second Order Methods*
- Newton's method — curvature, the Hessian
- Why second order methods are rarely used in deep learning
- L-BFGS as a practical quasi-Newton method

*Part H — Gradient-Free Optimization*
- When gradients aren't available — non-differentiable loss surfaces
- Genetic algorithms — populations, selection, crossover, mutation
- Evolution strategies — CMA-ES, neuroevolution
- Particle swarm optimization
- When gradient-free methods win — combinatorial problems, neural architecture search
- Why gradient-based methods usually dominate in deep learning
- Signpost to further reading for students who want to go deeper

**Prerequisites:** Ch 1, calculus, linear algebra
**Cross-references:** Ch 9 (gradient boosting), Ch 10 (SVMs and KKT), Ch 11 (backpropagation), Ch 12 (training deep networks)

---

### Chapter 10: Ensemble & Gradient Boosting Methods
**Key Ideas**
1. Bagging reduces variance, boosting reduces bias — they solve different problems
2. Random forests embody a specific statistical principle, not just better trees
3. Gradient boosting is gradient descent in function space — now that Chapter 8 is in place, this should feel inevitable

**Content**

*Part A — Why Ensembles?*
- The wisdom of crowds analogy
- Bias-variance decomposition revisited — what ensembles actually fix
- Independence as the key ingredient

*Part B — Bagging*
- Bootstrap sampling — what it does and why it works
- Bagging as variance reduction
- Out-of-bag error as a free cross-validation estimate

*Part C — Random Forests*
- Feature randomness on top of bagging — why it helps
- Variable importance — permutation importance, Gini importance
- Hyperparameters that matter — number of trees, max features, max depth
- When random forests fail

*Part D — Boosting*
- The boosting philosophy — sequential error correction vs parallel averaging
- AdaBoost — reweighting misclassified examples, the exponential loss
- Gradient boosting — boosting as gradient descent in function space, now properly motivated by Chapter 8
- XGBoost/LightGBM — regularization, second order approximation, practical dominance on tabular data

*Part E — Stacking & Model Blending*
- Stacking as meta-learning
- When blending beats any individual model
- Leakage risks in stacking

**Prerequisites:** Ch 3 (decision trees), Ch 5 (cross-validation), Ch 8 (optimization)
**Cross-references:** Ch 3 (decision trees), Ch 8 (gradient descent), Ch 20 (interpretability — variable importance)

---

### Chapter 11: Support Vector Machines & Kernel Methods
**Key Ideas**
1. The margin principle is a beautiful geometric idea with deep statistical justification
2. The kernel trick is a fundamental insight — you never need to compute the feature map explicitly
3. Kernels connect SVMs, Gaussian processes, and deep learning into a unified story

**Content**

*Part A — Maximum Margin Classification*
- The margin intuition — why maximising margin generalises better
- Hard margin SVM — the primal problem
- Support vectors — why only a few points determine the boundary
- Connection to regularization — the hinge loss and L2 penalty

*Part B — Soft Margin SVM*
- When data isn't linearly separable
- Slack variables, the C hyperparameter
- The bias-variance tradeoff in SVM terms — C as complexity control

*Part C — The Dual Problem & KKT Conditions*
- Lagrangian duality — primal vs dual
- KKT conditions — connects back to Chapter 8
- Why the dual formulation only depends on inner products — the kernel trick motivation

*Part D — Kernel Methods*
- The kernel trick — implicit feature maps, infinite dimensional spaces
- Common kernels — linear, polynomial, RBF, Matérn
- Connection to Gaussian processes from Chapter 7
- Kernel selection and hyperparameter tuning

*Part E — SVMs for Regression*
- Support vector regression — the epsilon insensitive loss
- When SVR beats linear regression

*Part F — Limitations & When to Use SVMs*
- Computational scaling — why SVMs struggle with large datasets
- When SVMs still win — small data, high dimensional, clear margin problems
- The rise of deep learning and what SVMs lost

**Prerequisites:** Ch 3 (classification), Ch 4 (regularization), Ch 8 (optimization and KKT)
**Cross-references:** Ch 7 (Gaussian processes and kernels), Ch 8 (KKT conditions), Ch 11 (neural networks as feature learners)

---

### Chapter 12: Neural Networks & Backpropagation
**Key Ideas**
1. Backpropagation is just the chain rule applied to a computation graph — not magic
2. Initialization and activation functions are not implementation details — they determine whether training works at all
3. Depth buys representational efficiency — not just capacity

**Content**

*Part A — From Linear Models to Neural Networks*
- The limitation of linear models — XOR as the canonical example
- Hidden layers as learned feature representations
- The universal approximation theorem — what it says and what it doesn't

*Part B — The MLP Architecture*
- Neurons, layers, weights, biases
- Forward pass — computation as a directed graph

*Part C — Activation Functions*
- Why non-linearity is necessary — without it deep networks collapse to linear models
- Sigmoid and tanh — historical context, saturation problem
- ReLU — why it changed everything, dying ReLU problem
- Leaky ReLU, ELU, PReLU — fixing dying ReLU
- GELU, SiLU, Swish — modern activations used in transformers and why
- How to choose — practical guidance

*Part D — The Computational Graph & Backpropagation*
- Computation graphs — nodes, edges, local gradients
- The chain rule as the engine of backprop
- Backpropagation derived properly — not as an algorithm handed down, but as automatic differentiation through the graph
- Numerical gradient checking

*Part E — Initialization*
- Why initialization matters — symmetry breaking
- Xavier/Glorot initialization
- He initialization for ReLU networks
- The vanishing and exploding gradient problem introduced here

*Part F — Neural Networks as Feature Learners*
- Each layer as a learned representation
- Connection back to kernel methods — neural tangent kernel signpost
- Why depth matters — what deep networks can express that shallow networks can't efficiently

**Prerequisites:** Ch 1, Ch 8 (optimization), Ch 10 (feature representations), linear algebra, calculus
**Cross-references:** Ch 8 (optimization), Ch 10 (kernel methods), Ch 12 (training deep networks), Ch 15 (attention and transformers)

---

### Chapter 13: Training Deep Networks
**Key Ideas**
1. Most training failures are diagnosable — loss curves tell a story if you know how to read them
2. Batch normalisation and residual connections are not tricks — they solve specific, well-defined problems
3. The practical craft of training is as important as the theory

**Content**

*Part A — The Training Loop*
- Forward pass, loss computation, backward pass, parameter update — the full cycle
- Epochs, iterations, batch size — what each controls
- Monitoring training — loss curves, what healthy and unhealthy training looks like

*Part B — Normalisation*
- Why internal covariate shift is a problem
- Batch normalisation — algorithm, where to place it, effect on training dynamics
- Layer normalisation — why it replaced batch norm in transformers
- Group normalisation, instance normalisation — when each is appropriate

*Part C — Regularization in Deep Networks*
- Dropout — the ensemble interpretation, where to apply it
- Weight decay — connection back to L2 regularization and AdamW from Chapter 8
- Data augmentation as implicit regularization
- Early stopping revisited — now with loss curves

*Part D — The Vanishing & Exploding Gradient Problem*
- Full treatment here — introduced in Chapter 11, solved here
- Gradient clipping — exploding gradients
- Residual connections — skip connections as a gradient highway, motivation for ResNet
- Careful initialization revisited

*Part E — Learning Rate Strategies*
- Warm-up, cosine annealing, cyclic learning rates
- The 1-cycle policy
- Connection back to Chapter 8 learning rate schedules — now with deep network context

*Part F — Practical Training Checklist*
- Overfit a small batch first — why this is the first debugging step
- Systematic hyperparameter tuning
- Common failure modes and diagnostics

**Prerequisites:** Ch 8 (optimization), Ch 11 (neural networks and backpropagation)
**Cross-references:** Ch 8 (AdamW, learning rate schedules), Ch 11 (vanishing gradients, initialization), Ch 13 (ResNet), Ch 15 (layer norm in transformers)

---

### Chapter 14: Convolutional Neural Networks
**Key Ideas**
1. Convolution is an inductive bias — it encodes the assumption that spatial structure is local and translation invariant
2. ResNet solved a specific problem — depth without degradation — and that solution generalised everywhere
3. Transfer learning is one of the most practically powerful ideas in deep learning

**Content**

*Part A — The Case for Convolution*
- Why MLPs fail on images — parameter explosion, no spatial prior
- Three key ideas — local connectivity, weight sharing, translation equivariance
- Convolution as a prior over spatial structure

*Part B — The Convolution Operation*
- 1D, 2D convolution derived
- Kernels, stride, padding — what each controls
- Feature maps, receptive field
- Pooling — max pooling, average pooling, what they discard and why

*Part C — CNN Architectures*
- LeNet — the origin
- AlexNet — what changed with depth and ReLU
- VGG — depth and simplicity
- ResNet — residual connections as the key innovation, connects back to Chapter 12
- EfficientNet — scaling laws for CNNs

*Part D — Transfer Learning*
- Pretrained features as general purpose representations
- Fine-tuning vs feature extraction — when to use each
- Domain shift — when transfer fails

*Part E — Beyond Classification*
- Object detection — YOLO, Faster R-CNN briefly
- Semantic segmentation — U-Net
- The general principle — CNNs as backbone feature extractors

*Part F — The Limits of CNNs*
- What convolution can't capture — long range dependencies
- Motivation for attention mechanisms — signpost to Chapter 15

**Prerequisites:** Ch 11 (neural networks), Ch 12 (training deep networks)
**Cross-references:** Ch 12 (residual connections), Ch 15 (attention as the answer to CNN limitations), Ch 17 (generative models using CNNs)

---

### Chapter 15: Sequence Models
**Key Ideas**
1. The vanishing gradient problem in RNNs is the same problem as in deep networks — time is just another form of depth
2. LSTMs don't solve the problem — they mitigate it through gating
3. The parallelisation failure of RNNs is what attention was invented to fix

**Content**

*Part A — The Sequence Modelling Problem*
- Why feedforward networks fail on sequences — no notion of order or memory
- The canonical tasks — language modelling, time series, speech
- What a good sequence model needs — variable length input, long range dependencies, efficient training

*Part B — Recurrent Neural Networks*
- The RNN unrolled — shared weights across time
- Forward pass, backpropagation through time (BPTT)
- The vanishing gradient problem in time — why RNNs forget
- The exploding gradient problem — gradient clipping revisited

*Part C — LSTMs & GRUs*
- The LSTM — gates as learned memory management, cell state as the highway
- Input, forget, output gates derived
- GRU — simplified gating, fewer parameters
- When LSTMs win over vanilla RNNs — empirical reality

*Part D — Bidirectional & Deep RNNs*
- Bidirectional RNNs — reading sequences forwards and backwards
- Stacked RNNs — depth in sequence models
- Practical limitations — sequential computation, parallelisation problem

*Part E — The Parallelisation Problem*
- Why RNNs are slow to train — sequential dependency
- Convolutional sequence models as a partial fix
- The fundamental motivation for attention — signpost to Chapter 15

**Prerequisites:** Ch 11 (neural networks), Ch 12 (training deep networks)
**Cross-references:** Ch 12 (vanishing gradients), Ch 15 (attention as the solution to RNN limitations)

---

### Chapter 16: Attention & Transformers
**Key Ideas**
1. Attention is a content-based retrieval mechanism — not just a weighting scheme
2. The transformer's power comes from combining attention, residual connections, and layer norm — each solving a specific problem
3. The O(n²) complexity is the central unsolved challenge — every variant is an attempt to address it

**Content**

*Part A — The Attention Idea*
- The core intuition — not all context is equally relevant
- Attention as soft retrieval — queries, keys, values
- Scaled dot-product attention derived — why the scaling factor matters
- Attention as a weighted average — the probabilistic interpretation

*Part B — Multi-Head Attention*
- Why single head attention is limited — one representation subspace
- Multi-head attention — parallel attention heads, concatenation, projection
- What different heads learn in practice

*Part C — The Transformer Architecture*
- Encoder block — multi-head attention, layer norm, feed-forward, residual connections
- Positional encoding — why attention is permutation invariant and why that's a problem
- Sinusoidal vs learned positional encodings
- Decoder block — masked self-attention, cross-attention
- Encoder-decoder vs encoder-only vs decoder-only — when each is used

*Part D — Training Transformers*
- The original seq2seq framing — machine translation
- Teacher forcing
- Masking — padding masks, causal masks
- Computational complexity — O(n²) in sequence length, why this matters

*Part E — Scaling & Variants*
- Vision Transformer (ViT) — patches as tokens, CNNs vs transformers on images
- Sparse attention — Longformer, BigBird — tackling the quadratic problem
- Relative positional encodings — RoPE, ALiBi
- Pre-norm vs post-norm — a subtle but important architectural choice

**Prerequisites:** Ch 11 (neural networks), Ch 12 (training), Ch 14 (sequence models)
**Cross-references:** Ch 12 (layer norm, residual connections), Ch 14 (RNN limitations), Ch 16 (LLMs built on transformers)

---

### Chapter 17: Large Language Models
**Key Ideas**
1. LLMs are trained to predict tokens — everything else is an emergent consequence of doing that at scale
2. RLHF is an engineering solution to an alignment problem — it works but imperfectly
3. The field moves fast and many claims outrun the evidence — research literacy matters here more than anywhere

**Content**

*Part A — From Transformers to LLMs*
- The scaling hypothesis — what happens as you increase parameters, data, compute
- Emergent capabilities — what they are, why they're surprising, why they're contested
- The three paradigms — encoder-only (BERT), decoder-only (GPT), encoder-decoder (T5)

*Part B — Pretraining*
- Self-supervised learning — the labels are in the data itself
- Masked language modelling — BERT style
- Causal language modelling — GPT style, next token prediction
- Data at scale — what goes into a pretraining corpus, quality vs quantity

*Part C — Tokenisation*
- Why characters and words both fail
- Byte pair encoding (BPE) — algorithm and intuition
- SentencePiece, WordPiece
- Why tokenisation is a bigger deal than it looks — arithmetic, multilingual, code

*Part D — Fine-tuning & Adaptation*
- Full fine-tuning — when you have enough data
- Parameter efficient fine-tuning — LoRA, prefix tuning, adapters
- Instruction tuning — teaching models to follow directions
- Catastrophic forgetting — the problem fine-tuning creates

*Part E — Alignment & RLHF*
- Why pretraining alone isn't enough — helpful, harmless, honest
- Reinforcement learning from human feedback — reward model, PPO
- Direct preference optimisation (DPO) — a cleaner alternative
- The alignment tax — capability vs safety tradeoffs

*Part F — Prompting & In-Context Learning*
- Zero-shot, few-shot prompting
- Chain of thought — why asking models to reason step by step works
- The mystery of in-context learning — what the model is actually doing
- Prompt sensitivity — a known fragility

*Part G — Retrieval Augmented Generation*
- The motivation — LLMs hallucinate facts, retrieval grounds them
- The RAG pipeline — retriever, reader, generator
- Dense vs sparse retrieval — BM25 vs embedding based search
- When RAG beats fine-tuning and when it doesn't
- Limitations — retrieval quality, context window constraints

*Part H — What We Don't Understand*
- Why scaling works — no satisfying theory
- Emergent capabilities — genuine phase transitions or measurement artefacts
- Hallucination — causes, mitigations, open problem
- The honest frontier — what the field knows vs what it claims

**Prerequisites:** Ch 11 (neural networks), Ch 15 (transformers), Ch 18 (RL for RLHF context)
**Cross-references:** Ch 15 (transformer architecture), Ch 18 (reinforcement learning and RLHF), Ch 20 (interpretability of LLMs)

---

### Chapter 18: Generative Models
**Key Ideas**
1. VAEs, GANs, and diffusion models are three different solutions to the same problem — each with principled tradeoffs
2. The ELBO is the same object as in Chapter 7 — variational inference and VAEs are the same idea
3. Diffusion models won because training stability matters as much as sample quality

**Framing Note**
Decoder-only transformers are generative in the sense that they model p(x) — addressed explicitly at the start of this chapter with a connection back to Chapter 16. Modern image and video generation (Stable Diffusion, DALL-E, Sora) combines diffusion models with transformers — students should leave seeing how Chapters 16 and 17 connect.

**Content**

*Part A — The Generative Modelling Problem*
- What does it mean to learn a distribution?
- Explicit vs implicit density models
- Evaluation — how do you know if a generative model is good? FID, IS, likelihood

*Part B — Variational Autoencoders*
- Autoencoders first — compression as representation learning
- The VAE problem — why a regular autoencoder latent space doesn't generate well
- The variational bound — ELBO derived properly, connects back to Chapter 7 (variational inference)
- The reparameterisation trick — why it's necessary for backprop
- The latent space — interpolation, disentanglement

*Part C — Generative Adversarial Networks*
- The adversarial idea — generator vs discriminator as a minimax game
- GAN training — why it's unstable, mode collapse
- Wasserstein GAN — a more principled loss, connects back to Chapter 8
- Progressive growing, StyleGAN — what made high quality image generation work
- The decline of GANs — why diffusion models replaced them

*Part D — Diffusion Models*
- The core idea — learn to reverse a noisy process
- Forward process — gradually adding noise, the Gaussian diffusion chain
- Reverse process — denoising score matching, the score function
- DDPM derived — training objective, sampling
- DDIM — faster sampling
- Classifier free guidance — how you condition generation on text or class
- Why diffusion models won — stability, diversity, quality

*Part E — Connections & Comparisons*
- VAEs — fast sampling, blurry outputs, interpretable latents
- GANs — sharp outputs, unstable training, mode collapse
- Diffusion — best quality, slow sampling, computationally expensive
- The unified view — all three are learning to model p(x)

**Prerequisites:** Ch 7 (variational inference), Ch 11 (neural networks), Ch 15 (transformers)
**Cross-references:** Ch 7 (ELBO and variational inference), Ch 16 (transformers as generative models), Ch 18 (RL and RLHF connects back here)

---

### Chapter 19: Reinforcement Learning
**Key Ideas**
1. RL is a different learning paradigm — the data is generated by the agent's own behaviour
2. The Bellman equation is to RL what the normal equations are to regression — the core recursive insight
3. PPO is the bridge between classical RL and modern LLM alignment — understanding it properly requires this whole chapter

**Content**

*Part A — The RL Framework*
- Agent, environment, state, action, reward — the core vocabulary
- The Markov Decision Process — formal definition, the Markov property
- Episodes, trajectories, returns
- Discounting — why future rewards are worth less, the discount factor γ
- The exploration-exploitation tradeoff — the central tension in RL

*Part B — Value Functions*
- The value function V(s) — expected return from a state
- The action-value function Q(s,a) — expected return from a state-action pair
- The Bellman equations — recursive definition, the engine of RL
- Optimal value functions and optimal policies

*Part C — Model-Free Prediction & Control*
- Monte Carlo methods — learning from complete episodes
- Temporal difference learning — learning from incomplete episodes, TD(0)
- Q-learning — off-policy TD control, convergence guarantees
- SARSA — on-policy TD control
- The difference between on and off policy — why it matters

*Part D — Deep Reinforcement Learning*
- The DQN breakthrough — Q-learning with neural networks
- Experience replay — breaking temporal correlations
- Target networks — stabilising training
- From Atari to general game playing

*Part E — Policy Gradient Methods*
- The policy gradient theorem derived
- REINFORCE — the simplest policy gradient algorithm
- Baseline subtraction — reducing variance
- Actor-critic methods — combining value functions and policy gradients
- PPO — proximal policy optimisation, why it's the workhorse of modern RL

*Part F — RL and LLMs*
- RLHF revisited — now with full RL machinery from this chapter
- The reward model as the environment
- PPO for language model alignment — connects back to Chapter 16
- The open questions — reward hacking, specification gaming

**Prerequisites:** Ch 1, Ch 8 (optimization), Ch 11 (neural networks)
**Cross-references:** Ch 8 (optimization), Ch 16 (RLHF), Ch 20 (fairness and alignment)

---

---

> **Scope Notes:**
> - **Monte Carlo** — covered as a component within Ch 7 (MCMC) and Ch 18 (RL), not a standalone chapter
> - **MCMC** — intuition and algorithm covered in Ch 7, full rigorous treatment (detailed balance, convergence proofs, mixing times) deliberately omitted
> - **Measure Theory** — excluded from the main text; students who proceed to PhD will pick it up then
> - **Mathematical Prerequisites Appendix** — to be written covering probability, statistics, linear algebra, and calculus at the level of rigour the course operates at. Students who are shaky on prerequisites are directed here.

---

### Chapter 20: Causal Inference
**Key Ideas**
1. Prediction and causation are different goals — a model can predict perfectly and tell you nothing causal
2. DAGs make causal assumptions explicit — that's their power
3. Causal inference is not just for economists — it matters whenever you act on model outputs

**Content**

*Part A — The Limits of Correlation*
- Why predictive models don't answer causal questions
- Simpson's paradox — the canonical example
- The fundamental problem of causal inference — you can never observe both potential outcomes

*Part B — Potential Outcomes Framework*
- Counterfactuals — what would have happened
- Average treatment effect (ATE), average treatment effect on the treated (ATT)
- The ignorability assumption — when observational data is enough

*Part C — Directed Acyclic Graphs*
- DAGs as a language for causal assumptions
- Confounders, mediators, colliders — the three structures that matter
- d-separation — reading conditional independence from a graph
- Backdoor and frontdoor criteria

*Part D — Causal Identification Strategies*
- Randomised controlled trials — the gold standard and why it's not always possible
- Instrumental variables — finding natural experiments
- Difference-in-differences — exploiting time and treatment variation
- Regression discontinuity — exploiting arbitrary thresholds
- Propensity score matching

*Part E — Causal ML*
- Double machine learning — using ML for nuisance estimation
- Heterogeneous treatment effects — CATE estimation
- Causal forests
- The connection back to prediction — when does causality matter for ML?

**Prerequisites:** Ch 1, Ch 2 (regression), Ch 3 (classification), probability
**Cross-references:** Ch 2 (regression and confounding), Ch 9 (random forests — causal forests extension), Ch 20 (fairness — causal fairness criteria)

---

### Chapter 21: Interpretability & Fairness
**Key Ideas**
1. Interpretability methods explain model behaviour — they don't explain the world
2. No fairness criterion is neutral — choosing one encodes a value judgement
3. The impossibility results are real — you cannot have everything simultaneously

**Content**

*Part A — Why Interpretability Matters*
- The black box problem — when prediction isn't enough
- The interpretability-accuracy tradeoff — is it real?
- Stakeholder needs — regulators, practitioners, affected individuals
- Intrinsically interpretable models vs post-hoc explanation

*Part B — Local Explanation Methods*
- LIME — approximating a black box locally with a simple model
- SHAP — Shapley values from cooperative game theory, what they actually measure
- Individual conditional expectation (ICE) plots
- The limits of local explanations — locally faithful, globally misleading

*Part C — Global Explanation Methods*
- Partial dependence plots
- Permutation feature importance — connects back to Chapter 9 (random forests)
- Global surrogate models
- When global and local explanations conflict

*Part D — Explaining Neural Networks*
- Saliency maps — gradients as explanations
- Grad-CAM — localising what a CNN looks at
- Attention as explanation — why this is more complicated than it looks
- Probing classifiers — what do representations encode?

*Part E — Fairness*
- What is fairness? — the definitional problem
- Fairness metrics — demographic parity, equalised odds, calibration
- The impossibility theorems — you cannot satisfy all fairness criteria simultaneously
- Sources of bias — data, model, deployment
- Mitigation strategies — pre-processing, in-processing, post-processing
- Causal fairness — connecting back to Chapter 19

*Part F — The Honest Limits*
- Explanations can be gamed
- Fairness criteria encode value judgements — there is no neutral choice
- Interpretability and fairness as ongoing research areas not solved problems

**Prerequisites:** Ch 1, Ch 3, Ch 9, Ch 11
**Cross-references:** Ch 9 (feature importance), Ch 13 (CNN explanations), Ch 15 (attention), Ch 19 (causal fairness)

---

### Chapter 22: Scalability & Systems
**Key Ideas**
1. A model that works in a notebook is not a deployed system — the gap is large and mostly engineering
2. Efficiency at inference is a different problem to efficiency at training
3. Distribution shift is the silent killer of deployed models

**Content**

*Part A — Why Scale Changes Everything*
- The gap between a working model and a working system
- Computational bottlenecks — memory, compute, communication
- The hardware landscape — CPUs, GPUs, TPUs, what each is good for

*Part B — Distributed Training*
- Data parallelism — splitting batches across devices
- Model parallelism — splitting the model across devices
- Pipeline parallelism — overlapping computation
- Gradient synchronisation — all-reduce, parameter servers
- Mixed precision training — FP16, BF16, why it matters

*Part C — Efficient Inference*
- The training-inference asymmetry — different bottlenecks
- Quantisation — reducing numerical precision post training
- Pruning — removing weights, structured vs unstructured
- Knowledge distillation — training a small model to mimic a large one
- Speculative decoding — faster LLM inference

*Part D — Data Pipelines*
- Data at scale — storage, loading, preprocessing bottlenecks
- Feature stores — serving features consistently between training and inference
- Data versioning and reproducibility

*Part E — Deployment & Monitoring*
- Serving models — latency, throughput, batching
- Distribution shift — when the world changes after deployment
- Model monitoring — what to track, when to retrain
- A/B testing models in production

*Part F — MLOps*
- Experiment tracking
- Model registries and versioning
- CI/CD for ML — why software engineering practices matter
- The full ML lifecycle

**Prerequisites:** Ch 11, Ch 12, Ch 15, Ch 16
**Cross-references:** Ch 12 (training deep networks), Ch 16 (LLMs at scale), Ch 18 (RL deployment challenges)

---

## Extended Reference Chapters
*Written as standalone reference material. Not core curriculum but available for further reading and dissertation work. Each chapter is self-contained and can be read independently of the core curriculum with the listed prerequisites.*

---

### R1: Gaussian Processes in Depth
**Key Ideas**
1. A Gaussian process is a distribution over functions — not a distribution over parameters
2. The kernel encodes everything you assume about the function's structure
3. GP regression gives exact uncertainty quantification — a rare and valuable property

**Content**

*Part A — Recap & Motivation*
- GP regression from Chapter 8 revisited — going beyond the introduction
- Why GPs matter — exact uncertainty, principled nonparametric inference
- The function space view — what it means to place a prior over functions

*Part B — Kernels in Depth*
- Stationary vs non-stationary kernels — what each assumes about the function
- Common kernels — squared exponential, Matérn, periodic, linear
- Kernel composition — adding and multiplying kernels to encode structure
- Spectral mixture kernels — learning kernel structure from data
- The connection between kernels and smoothness — Sobolev spaces intuitively

*Part C — Hyperparameter Optimisation*
- Marginal likelihood as the objective — integrating out function values
- Optimising the marginal likelihood — gradient based methods
- The Bayesian model comparison interpretation — Occam's razor built in
- Pitfalls — local optima, length scale identifiability

*Part D — GP Classification*
- Why GP regression doesn't directly apply to classification
- The Laplace approximation — a Gaussian approximation to the posterior
- Expectation propagation — a more accurate but expensive alternative
- Practical comparison — when each approximation is appropriate

*Part E — Sparse GPs*
- The O(n³) problem — why exact GPs don't scale
- Inducing points — a low rank approximation to the full GP
- Sparse GP regression — FITC, VFE formulations
- Stochastic variational GPs — scaling to large datasets
- Computational scaling — from O(n³) to O(nm²)

*Part F — Deep Kernel Learning*
- Combining GPs with neural networks — learned feature representations
- Neural network as a kernel — the deep kernel
- Deep GPs — hierarchical compositions of GPs
- When deep kernel learning wins over vanilla GPs

*Part G — When to Use GPs*
- Small data with uncertainty requirements
- Interpretable covariance structure
- When GPs lose — large datasets, high dimensions, non-smooth functions
- Practical guidance — software, implementation considerations

**Prerequisites:** Ch 8 (Bayesian methods, GP introduction), Ch 11 (kernel methods)
**Cross-references:** Ch 8 (variational inference for GP classification), R2 (variational inference)

---

### R2: Variational Inference
**Key Ideas**
1. Variational inference turns integration into optimisation — a fundamental trade
2. The ELBO is the same object as in VAEs — this chapter makes that precise
3. Mean field is a strong assumption — knowing when it breaks matters

**Content**

*Part A — The Problem*
- Why posterior inference is intractable in general
- The two approaches — sampling (MCMC) vs optimisation (VI)
- When to prefer VI over MCMC — speed, scalability, gradient availability
- The variational family — the space of approximations we search over

*Part B — KL Divergence*
- Definition and properties — non-negativity, asymmetry
- Forward vs reverse KL — what each minimises and what it means geometrically
- Mass covering vs mode seeking — the practical consequence of KL direction
- Why reverse KL is used in VI

*Part C — The ELBO*
- Evidence lower bound derived rigorously from KL divergence
- The ELBO as a tractable surrogate — decomposition into reconstruction and regularisation
- Tightness — when the ELBO equals the log evidence
- Connection to VAEs — the ELBO in Chapter 18 is exactly this object

*Part D — Mean Field Variational Inference*
- The mean field assumption — fully factorised posterior
- Coordinate ascent variational inference (CAVI) — the algorithm
- Worked example — Bayesian mixture of Gaussians
- When mean field fails — strong posterior correlations

*Part E — Stochastic Variational Inference*
- Scaling mean field to large datasets — subsampling the ELBO
- The reparameterisation trick — enabling gradient based optimisation
- Black box variational inference — a general purpose algorithm
- Variance reduction — control variates, Rao-Blackwellisation

*Part F — More Expressive Variational Families*
- The expressiveness problem — mean field misses posterior correlations
- Normalising flows — invertible transformations of simple distributions
- Real NVP, RealNVP, coupling layers
- Importance weighted autoencoders — tighter bounds with more samples

*Part G — Connections Across the Text*
- VAEs as amortised variational inference — the encoder as a variational family
- Variational EM — connecting VI to the EM algorithm from Chapter 7
- Bayesian deep learning — VI as a tool for uncertainty in neural networks
- Signpost to R5 (Bayesian Deep Learning)

**Prerequisites:** Ch 8 (Bayesian methods), Ch 12 (neural networks), probability
**Cross-references:** Ch 8 (MCMC as an alternative), Ch 18 (VAEs), R1 (GP approximate inference), R5 (Bayesian deep learning)

---

### R3: Graph Neural Networks
**Key Ideas**
1. Graphs are the natural data structure when relationships between entities matter as much as the entities themselves
2. Convolution generalises from grids to graphs — the same inductive bias, different geometry
3. Message passing is the unifying framework — most GNN variants are special cases

**Content**

*Part A — Graph Fundamentals*
- Nodes, edges, adjacency matrix, degree matrix
- Directed vs undirected, weighted vs unweighted
- The graph Laplacian — definition, properties, intuition
- Graph signal processing — signals on graphs, smooth vs rough signals
- Why standard neural networks fail on graphs — no fixed input size, no spatial ordering, permutation invariance required

*Part B — Spectral Graph Convolutions*
- The graph Fourier transform — eigenvectors of the Laplacian as a basis
- Spectral convolution — filtering in the frequency domain
- ChebNet — polynomial approximation, avoiding full eigendecomposition
- Limitations of spectral methods — not transferable across graphs

*Part C — Spatial Graph Convolutions & Message Passing*
- The message passing framework — aggregate, update, readout
- Graph Convolutional Networks (GCN) — the canonical spatial architecture
- The normalisation trick — why symmetric normalisation matters
- GraphSAGE — inductive learning, neighbourhood sampling for large graphs
- Message passing neural networks (MPNN) — the general framework

*Part D — Attention on Graphs*
- Graph Attention Networks (GAT) — attention coefficients over neighbourhoods
- Multi-head attention on graphs
- How GAT differs from transformer attention — local vs global
- When attention helps over fixed aggregation

*Part E — Graph Level Tasks*
- Node level, edge level, graph level — three different prediction targets
- Readout functions — sum, mean, max pooling over nodes
- Hierarchical pooling — DiffPool, graph coarsening
- Set2Set — order invariant readout with attention

*Part F — Applications*
- Molecular property prediction — atoms as nodes, bonds as edges
- Social network analysis — community detection, link prediction
- Knowledge graphs — entity and relation embeddings
- Recommender systems — user-item interaction graphs
- Traffic and spatial forecasting

*Part G — Limitations & Open Problems*
- Over-smoothing — why deep GNNs lose discriminative power
- Over-squashing — information bottlenecks in graph topology
- Expressive power — the connection to the Weisfeiler-Leman graph isomorphism test
- Scalability — neighbourhood explosion, sampling strategies

**Prerequisites:** Ch 12 (neural networks), Ch 16 (attention mechanisms), linear algebra
**Cross-references:** Ch 16 (attention), Ch 20 (causal graphs and DAGs)

---

### R4: Self-Supervised & Contrastive Learning
**Key Ideas**
1. Self-supervised learning creates labels from the data itself — no human annotation required
2. Contrastive learning teaches representations by comparison — similar things close, different things far
3. These methods explain how large models learn such powerful representations from raw data

**Content**

*Part A — The Labelling Bottleneck*
- Why supervised learning at scale is expensive — annotation cost, domain expertise
- The promise of self-supervised learning — labels hidden in the data itself
- A taxonomy — generative, predictive, and contrastive self-supervised methods
- Historical context — word2vec as an early self-supervised method

*Part B — Pretext Tasks*
- The pretext task idea — an auxiliary task whose solution requires useful representations
- Image pretext tasks — predicting rotations, solving jigsaw puzzles, inpainting
- The limitation of pretext tasks — representations tied to the pretext, not the downstream task
- Masked autoencoders (MAE) — BERT for images, high masking ratios
- Connection to LLM pretraining in Chapter 17 — masked language modelling as a pretext task

*Part C — Contrastive Learning*
- The contrastive idea — pull similar pairs together, push dissimilar pairs apart
- Positive and negative pairs — how they are constructed
- The InfoNCE loss — derivation and intuition, connection to mutual information
- The role of negative samples — why more negatives help, the false negative problem

*Part D — Contrastive Architectures*
- SimCLR — data augmentation as the source of positives, large batch sizes
- MoCo — momentum encoder, memory bank as a queue of negatives
- BYOL — no negative pairs, the collapse problem and how it is avoided
- SimSiam — stop gradient as the key to avoiding collapse
- Why each architecture makes different tradeoffs

*Part E — Beyond Images*
- CLIP — contrastive learning across modalities, image and text pairs
- Self-supervised for graphs — GraphCL, signpost to R3
- Self-supervised for tabular data — SCARF, corruption based pretraining
- Audio and speech — wav2vec, HuBERT

*Part F — Evaluation & Transfer*
- Linear probing — freezing the encoder, training only a linear head
- Fine-tuning — full model adaptation downstream
- Few-shot evaluation — how well do representations transfer with limited labels
- Why self-supervised representations sometimes beat supervised ones

*Part G — Why It Works*
- The uniformity-alignment framework — two properties of good representations
- Connection to information theory — mutual information maximisation
- Open questions — what makes an augmentation good, the role of architecture

**Prerequisites:** Ch 12 (neural networks), Ch 13 (CNNs), Ch 17 (LLM pretraining)
**Cross-references:** Ch 13 (transfer learning), Ch 17 (masked language modelling), R3 (graph self-supervision), R5 (Bayesian deep learning and representation quality)

---

### R5: Bayesian Deep Learning
**Key Ideas**
1. Standard neural networks are point estimates — Bayesian deep learning asks what the uncertainty is
2. Approximate inference is unavoidable — the question is which approximation to use
3. Uncertainty matters in deployment — knowing when a model doesn't know is as valuable as knowing when it does

**Content**

*Part A — The Problem with Point Estimates*
- Neural networks as point estimates — a single set of weights
- What uncertainty means in deep learning — epistemic vs aleatoric uncertainty
- When uncertainty matters — safety critical applications, out-of-distribution detection
- The Bayesian neural network — a prior over weights, a posterior after data

*Part B — Why Exact Inference is Intractable*
- The curse of dimensionality in weight space — millions of parameters
- The posterior is not Gaussian — it has complex multimodal structure
- Why MCMC is impractical for large networks
- The landscape of approximate methods

*Part C — Laplace Approximation*
- Fitting a Gaussian to the posterior at the MAP estimate
- The Hessian as the precision matrix — computing and approximating it
- Last layer Laplace — a practical compromise
- Limitations — unimodal approximation misses the multimodal posterior

*Part D — Variational Inference for BNNs*
- Bayes by backprop — the reparameterisation trick applied to weight distributions
- Mean field assumption over weights — fully factorised posterior
- The ELBO for BNNs — connects to R2
- Limitations — mean field underestimates uncertainty, high variance gradients

*Part E — Monte Carlo Dropout*
- Dropout at test time as approximate Bayesian inference — the Gal & Ghahramani result
- How to implement MC dropout — multiple forward passes, variance as uncertainty
- Practical strengths — no change to training, easy to implement
- Limitations — not a principled posterior, overconfident on OOD data

*Part F — Deep Ensembles*
- Training multiple networks from different initialisations
- Why ensembles work — diversity captures epistemic uncertainty
- Empirical performance — often beats principled Bayesian methods
- Computational cost and practical considerations

*Part G — Calibration & Uncertainty Quality*
- Epistemic vs aleatoric uncertainty revisited — what each method captures
- Calibration metrics — expected calibration error, reliability diagrams
- Out-of-distribution detection — how uncertainty should behave on unseen data
- Temperature scaling as a post-hoc calibration fix

*Part H — Applications*
- Active learning — using uncertainty to query labels efficiently, signpost to R9
- Medical imaging — when uncertainty quantification is clinically critical
- Reinforcement learning — exploration via uncertainty
- Continual learning — detecting distribution shift

**Prerequisites:** Ch 8 (Bayesian methods), Ch 12 (neural networks), Ch 13 (training), R2 (variational inference)
**Cross-references:** Ch 8 (Bayesian inference), R2 (variational inference for BNNs), R9 (active learning)

---

### R6: Time Series Methods
**Key Ideas**
1. Time series data violates the i.i.d. assumption — the order of observations matters
2. Classical and deep learning methods solve different parts of the problem
3. Forecasting, anomaly detection, and classification are three distinct tasks that need different approaches

**Content**

*Part A — The Time Series Setting*
- What makes time series different — temporal dependence, non-i.i.d. data
- Stationarity — definition, why it matters, the augmented Dickey-Fuller test
- Autocorrelation and partial autocorrelation — ACF and PACF plots
- Decomposition — trend, seasonality, remainder
- Evaluation — why train/test splits must respect time, backtesting, walk-forward validation

*Part B — Classical Methods*
- Autoregressive models (AR) — predicting from own past values
- Moving average models (MA) — predicting from past errors
- ARMA and ARIMA — combining AR and MA, differencing for non-stationarity
- Seasonal ARIMA (SARIMA) — handling seasonal patterns
- Exponential smoothing — Holt-Winters, state space formulation

*Part C — State Space Models*
- The state space formulation — hidden state, observation model
- The Kalman filter — exact inference for linear Gaussian models
- The extended and unscented Kalman filter — nonlinear extensions
- Structural time series models — trend, seasonality, regression components
- Connection to Bayesian methods from Chapter 8

*Part D — Deep Learning for Time Series*
- Why classical methods struggle — nonlinearity, multivariate dependencies
- Temporal CNNs — dilated causal convolutions, WaveNet
- LSTMs for forecasting — connects back to Chapter 15
- Sequence to sequence models — encoder decoder for multi-step forecasting
- Teacher forcing and its pitfalls in time series

*Part E — Transformers for Time Series*
- Adapting transformers to time series — patching, positional encoding choices
- Temporal Fusion Transformer — handling multiple input types
- PatchTST — patch-based tokenisation for long sequences
- Limitations — do transformers actually beat simpler baselines on time series?

*Part F — Probabilistic Forecasting*
- Point forecasts vs prediction intervals — why intervals matter
- Quantile regression for time series
- Conformal prediction — distribution-free coverage guarantees
- Deep probabilistic models — DeepAR, normalising flows for time series

*Part G — Anomaly Detection*
- Statistical approaches — control charts, CUSUM
- Reconstruction based anomaly detection — autoencoders for time series
- Forecasting based anomaly detection — residuals as anomaly scores
- Evaluation challenges — rare events, labelling difficulty

*Part H — Multivariate Time Series*
- Cross-series dependencies — when variables influence each other
- Vector autoregression (VAR)
- Graph-based methods for multivariate time series — signpost to R3
- Practical considerations — missing data, irregular sampling

**Prerequisites:** Ch 1, Ch 3 (regression), Ch 15 (sequence models), probability
**Cross-references:** Ch 15 (LSTMs, sequence models), Ch 16 (transformers), R3 (graph-based multivariate methods), R5 (probabilistic forecasting and uncertainty)

---

### R7: Survival Analysis
**Key Ideas**
1. Survival analysis handles time-to-event data where not all events have been observed yet — censoring changes everything
2. Classical survival models are interpretable and widely used in medicine and industry
3. Deep learning extends survival analysis to high-dimensional, complex data

**Content**

*Part A — The Survival Setting*
- Time-to-event data — what makes it different from standard regression
- Censoring — right censoring, left censoring, interval censoring
- Why standard regression fails — censored observations are not missing observations
- The survival function S(t) — probability of surviving past time t
- The hazard function h(t) — instantaneous risk at time t
- The cumulative hazard H(t) — relationship between survival and hazard

*Part B — Nonparametric Methods*
- The Kaplan-Meier estimator — nonparametric survival curves from censored data
- The log-rank test — comparing survival curves between groups
- Nelson-Aalen estimator — nonparametric cumulative hazard estimation
- Visualisation — survival curves, confidence bands

*Part C — The Cox Proportional Hazards Model*
- The Cox model — semiparametric, no distributional assumption on baseline hazard
- The proportional hazards assumption — what it means and how to test it
- Partial likelihood — estimating coefficients without estimating the baseline hazard
- Interpreting hazard ratios — the practical output of Cox regression
- Model diagnostics — Schoenfeld residuals, martingale residuals

*Part D — Parametric Survival Models*
- Accelerated failure time models — an alternative to proportional hazards
- Common distributions — Weibull, exponential, log-normal
- When parametric models are preferred — extrapolation, full likelihood

*Part E — Competing Risks*
- When multiple events are possible — death vs discharge, churn vs upgrade
- The cause-specific hazard — modelling each event separately
- The subdistribution hazard — Fine-Gray model
- Cumulative incidence functions — the right estimand under competing risks

*Part F — Deep Survival Models*
- DeepSurv — Cox model with a neural network for the hazard
- DeepHit — direct prediction of the survival distribution, handles competing risks
- Survival transformers — attention for longitudinal patient data
- Handling time-varying covariates — landmark models, dynamic prediction

*Part G — Evaluation*
- Concordance index (C-index) — discrimination ability of a survival model
- Brier score — calibration of survival probability predictions
- Time-dependent AUC — discrimination at specific time horizons
- Integrated Brier score — overall calibration across all time points

*Part H — Applications*
- Clinical trials — treatment effect estimation, regulatory context
- Churn prediction — customer lifetime modelling
- Predictive maintenance — time to failure of equipment
- Credit risk — time to default

**Prerequisites:** Ch 1, Ch 3 (regression), Ch 4 (classification), probability
**Cross-references:** Ch 3 (regression and GLMs), Ch 8 (Bayesian survival models), Ch 12 (neural networks for DeepSurv)

---

### R8: Multi-Task & Transfer Learning
**Key Ideas**
1. Tasks that share structure can be learned better together than separately
2. Transfer learning is already everywhere — most practitioners use it without calling it that
3. Negative transfer is real — sharing always has a cost, knowing when not to share matters

**Content**

*Part A — The Multi-Task Learning Idea*
- Learning multiple tasks simultaneously — shared representations, task-specific heads
- Why it helps — regularisation effect, data augmentation across tasks, inductive transfer
- Hard parameter sharing — shared layers with task-specific output heads
- Soft parameter sharing — separate networks with similarity constraints
- When to use multi-task learning — related tasks, limited data per task

*Part B — Task Relationships*
- Measuring task similarity — gradient alignment, task affinity
- Positive transfer — when tasks improve each other
- Negative transfer — when tasks hurt each other, and why
- Task grouping — finding subsets of tasks to train together

*Part C — Loss Balancing*
- The multi-task loss — weighted sum of individual task losses
- The weighting problem — manually tuned vs learned weights
- Uncertainty weighting — Kendall et al. approach
- Gradient normalisation — GradNorm
- PCGrad — projecting conflicting gradients

*Part D — Transfer Learning Taxonomy*
- Feature extraction — frozen pretrained backbone, trained head only
- Fine-tuning — full model adaptation, learning rate scheduling for layers
- Domain adaptation — covariate shift, distribution matching
- Domain generalisation — training for robustness to unseen domains
- Zero-shot transfer — no target domain data at all

*Part E — Domain Adaptation*
- Covariate shift — same labels, different input distributions
- Maximum mean discrepancy — measuring distribution distance
- Adversarial domain adaptation — domain confusion as a training objective
- CORAL — second order statistics alignment
- Self-supervised domain adaptation — using target domain unlabelled data

*Part F — Meta-Learning*
- Learning to learn — the meta-learning objective
- MAML — model-agnostic meta-learning, fast adaptation from few examples
- Prototypical networks — embedding space classification
- Relation networks — learning a similarity function
- When meta-learning beats fine-tuning — very few shots, many tasks

*Part G — Foundation Models as Extreme Transfer*
- One pretrained model, many downstream tasks
- The emergence of foundation models — scale changes the transfer paradigm
- Prompt tuning, prefix tuning, LoRA — parameter efficient adaptation revisited
- The risks — bias transfer, capability gaps, domain mismatch
- Signpost to Chapter 17 (LLMs) and Chapter 14 (CNNs and transfer learning)

*Part H — Practical Guidance*
- Decision framework — when to use multi-task vs transfer vs train from scratch
- How much data do you need to fine-tune effectively?
- Layer-wise learning rates — why earlier layers need smaller updates
- Common failure modes and diagnostics

**Prerequisites:** Ch 12 (neural networks), Ch 13 (CNNs and transfer learning), Ch 17 (LLMs)
**Cross-references:** Ch 13 (transfer learning introduction), Ch 17 (foundation models), R4 (self-supervised pretraining), R9 (active learning for low data regimes)

---

### R9: Active Learning
**Key Ideas**
1. Active learning asks which data points are most worth labelling — annotation budget is the constraint
2. Uncertainty sampling is intuitive but has failure modes — diversity matters too
3. Active learning connects Bayesian uncertainty to practical data collection

**Content**

*Part A — The Active Learning Setting*
- The annotation bottleneck — labelling is expensive, not all labels are equal
- Pool-based active learning — selecting from a fixed unlabelled pool
- Stream-based active learning — deciding whether to label as data arrives
- Membership query synthesis — generating informative queries from scratch
- The active learning loop — query, label, retrain, repeat

*Part B — Uncertainty Sampling*
- The core idea — label the points the model is least certain about
- Least confidence sampling — distance from the decision boundary
- Margin sampling — gap between top two class probabilities
- Entropy sampling — full predictive distribution uncertainty
- Limitations — uncertainty alone leads to redundant, clustered queries

*Part C — Diversity & Representativeness*
- The diversity problem — uncertain points are often similar to each other
- Core-set selection — geometric coverage of the input space
- Clustering based selection — query cluster centres
- Density weighted methods — balance uncertainty with representativeness

*Part D — Bayesian Active Learning*
- Expected model change — query the point that would change the model most
- Expected error reduction — query the point that reduces generalisation error most
- BALD — Bayesian active learning by disagreement, mutual information between predictions and model parameters
- Connection to R5 (Bayesian deep learning) — uncertainty estimates are the engine

*Part E — Batch Active Learning*
- Selecting multiple points at once — the batch query problem
- Greedy submodular optimisation — efficient approximate batch selection
- BatchBALD — extending BALD to diverse batches
- Practical batch sizes — what works in practice

*Part F — Active Learning for Deep Networks*
- The cold start problem — no model before the first labels
- Representation learning for active learning — using pretrained features for query strategies
- Dropout uncertainty for active learning — MC dropout as a practical Bayesian approximation
- Ensemble based active learning — disagreement between ensemble members

*Part G — Evaluation*
- Learning curves — labelling efficiency as the primary metric
- Area under the learning curve — a single number summary
- Comparison baselines — random sampling is harder to beat than it looks
- Experimental design — simulated vs real annotation studies

*Part H — Applications*
- Medical image annotation — expensive expert labels
- NLP labelling — named entity recognition, relation extraction
- Scientific discovery — drug discovery, materials science
- Autonomous systems — robot learning, simulation to real transfer

**Prerequisites:** Ch 1, Ch 3 (classification), Ch 5 (model evaluation)
**Cross-references:** Ch 5 (evaluation), R5 (Bayesian deep learning for uncertainty), R4 (self-supervised learning to reduce cold start), R8 (multi-task learning for low data regimes)

---

### R10: Federated Learning
**Key Ideas**
1. Federated learning trains models across decentralised data without the data ever leaving the device — privacy is the central motivation
2. The statistical and systems challenges are fundamentally different from centralised training
3. Privacy guarantees require more than just not sharing data — differential privacy and secure aggregation are the formal tools

**Content**

*Part A — The Federated Setting*
- Data on devices, model on server, never the reverse
- Why federated learning — privacy regulation, data ownership, communication constraints
- The canonical use case — mobile keyboard prediction, healthcare, finance
- Federated learning vs centralised learning — what changes and what doesn't
- The federated learning loop — local training, aggregation, global update

*Part B — FedAvg*
- The FedAvg algorithm — local SGD on each client, weighted averaging on the server
- Why simple averaging works — the convex case
- Why simple averaging fails — non-i.i.d. data, client drift
- Convergence analysis — what theory says about FedAvg under heterogeneity

*Part C — Statistical Heterogeneity*
- Non-i.i.d. data across clients — the core challenge of federated learning
- Types of heterogeneity — label skew, feature skew, quantity skew
- Client drift — why local optima diverge from the global optimum
- FedProx — proximal regularisation to limit client drift
- SCAFFOLD — variance reduction for heterogeneous clients
- How heterogeneity affects convergence — theoretical and empirical perspectives

*Part D — Systems Heterogeneity*
- Different compute — clients with different hardware capabilities
- Different availability — clients that drop in and out
- Stragglers — slow clients that bottleneck synchronous training
- Asynchronous federated learning — updating without waiting for all clients
- Partial participation — selecting a subset of clients per round

*Part E — Communication Efficiency*
- Communication as the bottleneck — bandwidth between devices and server
- Gradient compression — quantisation, sparsification, sketching
- Local update strategies — more local steps, less communication
- Knowledge distillation for federated learning — sending predictions not gradients

*Part F — Personalised Federated Learning*
- One global model vs per-client adaptation — the personalisation spectrum
- Fine-tuning the global model locally — the simplest approach
- MAML for federated learning — meta-learning for fast personalisation, connects to R8
- Mixture models — interpolating between global and local models
- Clustered federated learning — grouping clients with similar data

*Part G — Differential Privacy*
- The privacy problem — even without sharing data, models can leak information
- Differential privacy — formal definition, epsilon and delta
- DP-SGD — gradient clipping and noise addition during local training
- The privacy-utility tradeoff — stronger guarantees cost accuracy
- Composition theorems — privacy accounting across rounds

*Part H — Secure Aggregation*
- The honest but curious server — what the server can infer from updates
- Secure aggregation protocols — cryptographic guarantees on aggregation
- Homomorphic encryption — computing on encrypted gradients
- Practical tradeoffs — computational cost of cryptographic protocols

*Part I — Attacks & Robustness*
- Model inversion attacks — reconstructing training data from model updates
- Membership inference attacks — determining if a data point was used in training
- Poisoning attacks — malicious clients corrupting the global model
- Byzantine robustness — aggregation rules robust to adversarial clients
- Defences — robust aggregation, anomaly detection on updates

*Part J — Applications*
- Mobile keyboard prediction — Google's original federated learning deployment
- Healthcare — learning from hospital data without sharing patient records
- Finance — fraud detection across institutions
- Open challenges — evaluation without centralised data, fairness across clients

**Prerequisites:** Ch 9 (optimization), Ch 12 (neural networks), Ch 13 (training deep networks)
**Cross-references:** Ch 13 (distributed training), Ch 21 (scalability and systems), R5 (Bayesian uncertainty in federated settings), R8 (personalisation via meta-learning), R9 (active learning for client selection)

---

---

## Appendices

**Appendix A — Mathematical Prerequisites**
Linear algebra, calculus, probability and statistics at the level of rigour the course operates at. Students who are shaky on prerequisites are directed here before beginning Chapter 1.

**Appendix B — Notation Reference**
Unified notation used throughout the text.

**Appendix C — Further Reading**
Curated reading list per chapter — papers, textbooks, blog posts.

---

*Outline complete. 22 core chapters, 10 extended reference chapters, 3 appendices.*
