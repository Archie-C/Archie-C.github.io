Create the next course note, titled **Outputs and Loss Functions**, following the existing notes on Multilayer Neural Networks, Activation Functions, and Why Deep Networks?

Match the writing style of the existing course material: straightforward, conversational explanations aimed at Master's students, building mathematical concepts progressively and connecting new ideas to material already introduced. Use the existing HTML structure, mathematical notation, and visual styling.

Students have already studied linear regression, logistic regression, maximum likelihood estimation and binary cross-entropy. Build on this knowledge rather than teaching these concepts from scratch.

The central question this note should answer is:

**How do we turn a neural network's outputs into predictions, and how do we measure whether those predictions are correct?**

Include the following content in this order:

### 1. From hidden representations to predictions

- Briefly recap that the hidden layers of a neural network learn representations of the input.
- Explain that the final layer must transform these representations into an output appropriate for the prediction task.
- Introduce the final affine transformation:

\[
\mathbf{a}^{(L)}
=
\mathbf{W}^{(L)}\mathbf{z}^{(L-1)}
+
\mathbf{b}^{(L)}
\]

- Explain that these values are called **logits** or output pre-activations, although the term *logits* is most commonly used in classification.
- Explain that the output transformation depends on what we are trying to predict.
- Distinguish the raw output of the final affine layer from the final prediction.
- Emphasise that the network architecture is not inherently a regression or classification model. Much of the distinction comes from its output layer and loss function.

### 2. Regression

- Begin with a familiar regression task, such as predicting house prices from property features.
- Explain that regression with an unrestricted real-valued target typically uses an identity output activation:

\[
\hat{y}=a^{(L)}
\]

- Introduce mean squared error:

\[
\mathcal{L}_{\mathrm{MSE}}
=
\frac{1}{N}
\sum_{n=1}^{N}
(y_n-\hat{y}_n)^2
\]

- Connect this to students' previous study of linear regression.
- Explain that MSE penalises larger errors more heavily because the errors are squared.
- Briefly connect MSE to maximum likelihood estimation under an independent Gaussian noise model with constant variance.
- Make clear that Gaussian noise is a modelling assumption, not something automatically guaranteed by using MSE.
- Mention mean absolute error as an alternative, but do not explore regression losses extensively.
- Explain that adding hidden layers changes how the prediction is constructed, but does not require us to abandon familiar regression loss functions.

### 3. Binary classification

- Use a familiar binary classification problem, such as predicting whether an email is spam.
- Explain that the output layer produces a single real-valued score.
- Apply the sigmoid function to obtain a probability:

\[
p(C_1\mid\mathbf{x})
=
\sigma(a^{(L)})
\]

- Explain the interpretation of the output as a probability between 0 and 1.
- Recall binary cross-entropy:

\[
\mathcal{L}_{\mathrm{BCE}}
=
-\frac{1}{N}
\sum_{n=1}^{N}
\left[
y_n\log(p_n)
+
(1-y_n)\log(1-p_n)
\right]
\]

- Connect BCE directly to the Bernoulli likelihood and maximum likelihood estimation from the previous classification notes.
- Explain why confident incorrect predictions receive a larger penalty than uncertain predictions.
- Provide a short numerical comparison of a correct prediction, an uncertain prediction and a confidently incorrect prediction.
- Explain that a decision threshold such as 0.5 is used to convert probabilities into class predictions, but the loss function evaluates probabilities rather than thresholded decisions.
- Avoid re-deriving the complete Bernoulli likelihood, since this has already been covered.

### 4. Multiclass classification

- Explain the distinction between binary classification and classification with more than two mutually exclusive classes.
- Use handwritten digit recognition as an example, where each image belongs to exactly one of ten classes.
- Explain that the network produces one output score for each class:

\[
\mathbf{a}^{(L)}\in\mathbb{R}^{K}
\]

- Explain why simply applying sigmoid independently to every output does not ensure the resulting probabilities sum to one.
- Introduce softmax:

\[
p_k=
\frac{\exp(a_k)}
{\sum_{j=1}^{K}\exp(a_j)}
\]

- Explain how softmax converts a vector of scores into a probability distribution over mutually exclusive classes.
- Show that the probabilities are non-negative and sum to one.
- Include a simple numerical example using three class scores, calculating their softmax probabilities.
- Explain that the predicted class is normally the class with the highest probability, equivalently the highest logit.
- Introduce categorical cross-entropy:

\[
\mathcal{L}_{\mathrm{CE}}
=
-\frac{1}{N}
\sum_{n=1}^{N}
\sum_{k=1}^{K}
y_{nk}\log(p_{nk})
\]

- Explain one-hot encoded targets and why the loss reduces to the negative logarithm of the probability assigned to the correct class.
- Briefly connect this loss to maximum likelihood estimation using a categorical distribution.

### 5. Multilabel classification

- Explain that multiclass and multilabel classification are different problems.
- In multiclass classification, exactly one class is correct. In multilabel classification, several labels may be correct simultaneously.
- Use an example where an image can contain a dog, a person and a bicycle at the same time.
- Explain why softmax is inappropriate for representing multiple independently selectable labels.
- Instead, use one sigmoid output per label:

\[
p_k=\sigma(a_k)
\]

- Explain that the network can assign high probabilities to several labels simultaneously.
- Introduce binary cross-entropy applied separately to each label, then aggregated across labels and observations.
- Explain that this corresponds to modelling the label outcomes as conditionally independent Bernoulli variables given the input.
- Make clear that the predictions can still be statistically dependent through their shared learned representation.
- Include an example comparing multiclass and multilabel output vectors.

### 6. Logits, probabilities and numerical stability

- Explain the distinction between logits and probabilities.
- Discuss why many deep-learning libraries combine the output transformation and loss calculation into a single operation.
- Explain that calculating sigmoid or softmax probabilities explicitly before computing logarithms can create numerical stability problems.
- Introduce the ideas behind:
  - Binary cross-entropy with logits.
  - Softmax cross-entropy directly from logits.
- Explain that these implementations are mathematically equivalent to the corresponding probability-based losses but use more stable calculations.
- Briefly introduce the log-sum-exp trick at an intuitive level, without requiring a detailed numerical analysis.
- Explain why a model's final layer may return raw logits during training, even though probabilities are useful for interpreting its predictions.
- Avoid requiring detailed knowledge of any particular deep-learning framework.

### 7. Choosing the correct output and loss function

- Bring together the previous sections in a comparison table.
- Include regression, binary classification, multiclass classification and multilabel classification.
- Compare:
  - Prediction target.
  - Number of output neurons.
  - Output activation.
  - Typical loss function.
  - Interpretation of the output.
- Explain that selecting an appropriate output representation and loss is part of defining the machine-learning problem.
- Clarify that these are common choices, not universal requirements for every possible model.
- Briefly distinguish a **loss function**, used to define the training objective, from an **evaluation metric**, used to assess model performance.
- For example, classification accuracy is useful for evaluation but does not replace the need for an appropriate differentiable training objective in standard gradient-based learning.

### 8. Worked example: Same network, different tasks

- Consider a network with a shared hidden representation of dimension 8.
- Show how changing only the output layer and loss allows the same hidden architecture to address different prediction tasks.
- Use three examples:
  - Predicting a single continuous value.
  - Predicting one of three mutually exclusive classes.
  - Predicting three independent binary labels.
- Specify the output weight-matrix dimensions for each case.
- Show the final output values and explain how each should be interpreted.
- Include a small numerical loss calculation for at least two of the tasks.
- Keep the example manageable without requiring programming or backpropagation.

### 9. Check your understanding

Include approximately five questions testing:

- Why regression and classification typically use different output activations.
- Why BCE is appropriate for Bernoulli targets.
- Why softmax is appropriate for mutually exclusive classes.
- The difference between multiclass and multilabel classification.
- Why libraries often calculate cross-entropy directly from logits.

Include at least one question in which students must choose the output-layer architecture and loss function for a new problem, rather than simply recalling a definition.

### Visualisations

- Include a diagram showing a shared hidden network connected to different output heads for regression, binary classification and multiclass classification.
- Include a simple visual comparison of sigmoid outputs and softmax outputs.
- Include a plot illustrating how binary cross-entropy changes with the predicted probability for a positive and negative target.
- Consider an interactive example where students adjust the logits for three classes and observe how the softmax probabilities change.
- Follow the existing SVG, `chart-card`, typography and colour conventions used throughout the course.
- Ensure mathematical visualisations are accurate and directly support the written explanation.

### Additional requirements

- Preserve consistent notation with the previous neural-network notes.
- Reuse the students' existing understanding of maximum likelihood, Gaussian regression, logistic regression and cross-entropy.
- Do not extensively repeat material already covered in the previous Activation Functions note.
- Explain the distinction between output transformations and loss functions clearly.
- Keep the mathematical definitions precise, including whether a loss is summed or averaged.
- Make the connection between probability distributions and loss functions explicit.
- Do not suggest that every neural network must output probabilities.
- Do not introduce optimisation algorithms, gradient descent or backpropagation.
- Do not introduce mixture density networks or other advanced probabilistic output architectures.
- Keep the focus on the relationship between the prediction task, the output layer and the loss function.
- End with a concise summary explaining that a neural network learns a mapping from inputs to predictions, while the loss function defines what it means for those predictions to be good.
- Transition naturally to the next note, **Representation Learning**, which will examine what the hidden layers learn and how those representations can be reused across tasks.