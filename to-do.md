# Goal: Write and Implement Section 5 — Backpropagation

You are working on an existing **Machine Learning and Deep Learning course website**, which contains structured teaching notes for a Master's-level university course.

Your task is to **write and implement all notes pages for Section 5: Backpropagation**, based primarily on Chapter 8 of Christopher M. Bishop and Hugh Bishop's _Deep Learning: Foundations and Concepts_.

This is a complete content-writing and website-integration task. You must create the finished notes, not merely an outline, summary, or collection of placeholders.

**The most important requirements are:**

1. Match the **writing style, mathematical depth, explanatory approach, notation, and structure of all previous course notes**.
2. Match the **existing website's styling, layout, navigation, typography, mathematical formatting, and reusable components**.
3. Teach the material rigorously but accessibly, building intuition before developing mathematical derivations.
4. Cover all the important material in Bishop's Chapter 8, with appropriate emphasis on the fundamental concepts.
5. Produce complete, polished, connected notes pages that students can use independently.

---

# 1. First: Study the Existing Website and Notes

**Do not begin writing or implementing new notes until you have thoroughly inspected the existing project.**

Explore the repository and identify:

- All existing notes sections and their individual pages.
- The writing style used throughout Sections 1–4.
- How concepts are introduced, explained, derived, and illustrated.
- The mathematical notation and terminology already established.
- The typical length and depth of individual notes pages.
- How mathematical examples, worked calculations, definitions, important observations, and summaries are presented.
- How equations are formatted, numbered, and referenced.
- How sections and subsections are organized and linked together.
- How the existing website renders Markdown, LaTeX, figures, diagrams, tables, code, and interactive elements.
- The existing page templates, layouts, components, CSS, typography, colours, spacing, borders, and responsive behaviour.
- How navigation, the sidebar, table of contents, previous/next page links, and section numbering work.

Read **all existing notes pages**, not just one representative page. The goal is to identify the consistent writing conventions used throughout the course, including any small differences between introductory explanations, mathematical derivations, and worked examples.

Use these conventions as the authoritative reference.

## Writing style requirements

The new material must read as though it was written by the same author as the existing notes.

In particular:

- Use clear, professional academic English.
- Write in connected, explanatory prose rather than relying heavily on bullet points.
- Explain why a mathematical result matters before or alongside deriving it.
- Develop mathematical arguments logically, without unexplained jumps.
- Define every new symbol and quantity before using it.
- Explain the meaning of equations, not just their derivation.
- Include intuitive interpretations where they improve understanding.
- Use worked examples to reinforce important ideas.
- Maintain mathematical precision without introducing unnecessary complexity.
- Avoid excessive formality, unnecessary jargon, and repetitive explanations.
- Avoid generic AI-style introductions, motivational filler, and statements that add no educational value.
- Do not repeatedly restate material already covered in earlier sections.
- Refer students to relevant earlier notes where appropriate.
- Ensure that explanations flow naturally from one concept to the next.

**Do not invent a new writing style. Infer and reproduce the existing one.**

The notes must be substantial enough for independent study. They should resemble carefully written textbook material, not presentation slides, revision flashcards, or a compressed summary.

## Website styling requirements

Use the existing website's visual design exactly.

- Reuse existing page components, layouts, and styling conventions.
- Preserve the current typography, heading hierarchy, and mathematical rendering.
- Use existing components for definitions, notes, warnings, examples, figures, code blocks, and tables wherever applicable.
- Follow existing conventions for spacing around paragraphs, equations, and illustrations.
- Ensure all pages support the existing light/dark themes, if applicable.
- Ensure layouts work on desktop, tablet, and mobile.
- Preserve the existing sidebar and page navigation functionality.
- Do not introduce a second design system.
- Do not add dependencies unless they are genuinely necessary.
- Do not make unrelated changes to the website.

If the project has existing diagramming or visualization utilities, use those rather than introducing an inconsistent alternative.

The new pages should be visually indistinguishable from the previous sections.

---

# 2. Source Material and Scope

The primary source is:

**Christopher M. Bishop and Hugh Bishop, _Deep Learning: Foundations and Concepts_, Chapter 8: Backpropagation, pp. 233–252.**

Read the full chapter carefully before writing the notes.

The relevant material is:

| Bishop subsection | Topic                                  |
| ----------------- | -------------------------------------- |
| 8.1               | Evaluation of Gradients                |
| 8.1.1             | Single-layer Networks                  |
| 8.1.2             | General Feed-forward Networks          |
| 8.1.3             | A Simple Example                       |
| 8.1.4             | Numerical Differentiation              |
| 8.1.5             | The Jacobian Matrix                    |
| 8.1.6             | The Hessian Matrix                     |
| 8.2               | Automatic Differentiation              |
| 8.2.1             | Forward-mode Automatic Differentiation |
| 8.2.2             | Reverse-mode Automatic Differentiation |

Use Bishop as the main mathematical reference, but reorganize the material according to the teaching structure specified below.

You may use supplementary mathematical knowledge where this improves understanding, particularly for additional worked examples or modern automatic differentiation implementations. However, distinguish any substantive extension from the textbook's treatment.

Do not copy extended passages of the textbook verbatim. Write original explanations and derivations.

## Relationship to previous course sections

The students have already encountered topics including:

- Linear and nonlinear models.
- Regression and classification.
- Neural networks and their architectures.
- Weights, biases, layers, and activation functions.
- Forward propagation.
- Loss functions.
- Gradient descent and optimization.

Inspect the actual earlier notes to determine precisely which concepts, formulas, and conventions have been introduced.

You should use this knowledge as the starting point.

For example, gradient descent has already been covered. Consequently, the purpose of this section is not to reteach gradient descent, but to explain **how the gradients required by gradient descent are calculated efficiently in neural networks**.

Use links to the relevant earlier pages where helpful.

---

# 3. Overall Section Structure

Create the following seven notes pages under **Section 5: Backpropagation**.

Use the existing project's routing, naming, metadata, sidebar, and numbering conventions.

Do not force a particular filename or URL structure if the website already has an established convention.

The pages must appear in this order:

1. **5.1 Why Do We Need Backpropagation?**
2. **5.2 The Chain Rule and Local Gradients**
3. **5.3 Backpropagation Through Multiple Layers**
4. **5.4 A Complete Worked Example**
5. **5.5 Numerical Differentiation and Gradient Checking**
6. **5.6 Automatic Differentiation**
7. **5.7 Jacobians, Hessians, and Higher-Order Derivatives**

Create or update the Section 5 overview/index page if the existing website uses section landing pages.

The ordering is deliberately different from the textbook. It introduces backpropagation first, then builds toward its practical generalization in automatic differentiation, before discussing more advanced derivatives.

Each page must have a clear teaching purpose and build naturally on the material introduced in the preceding pages.

---

# 4. Detailed Page Requirements

## 5.1 — Why Do We Need Backpropagation?

**Objective:** Motivate backpropagation and establish the distinction between calculating predictions, calculating gradients, and updating parameters.

Start with a neural network and an error function:

$$
E(\mathbf{w})
$$

Explain that training requires the derivatives of this function with respect to every learnable weight and bias.

Recall the gradient descent update:

$$
\mathbf{w}^{(\tau+1)}
=
\mathbf{w}^{(\tau)}
-
\eta\nabla E(\mathbf{w}^{(\tau)})
$$

Explain what information the gradient contains and why calculating it is challenging for a network consisting of multiple layers of nonlinear transformations.

Introduce the two directions of computation:

**Forward propagation:** Inputs are transformed through the network to produce predictions and evaluate the loss.

**Backward propagation:** Derivative information is propagated from the loss towards earlier layers, allowing gradients to be calculated.

Explain carefully that backpropagation is an algorithm for computing derivatives. It is not itself a parameter-update algorithm. Gradient descent uses the gradients that backpropagation produces.

Include a simple neural network diagram illustrating both directions.

Introduce the idea that the same intermediate calculations can be reused when computing derivatives, making backpropagation substantially more efficient than separately differentiating the loss with respect to every parameter.

Do not derive the full algorithm yet.

Finish by motivating the chain rule, which is the mathematical foundation of the next page.

## 5.2 — The Chain Rule and Local Gradients

**Objective:** Establish the mathematical principles required to understand backpropagation.

Begin with the chain rule for two composed scalar functions.

For example:

$$
z=f(x),\qquad y=g(z)
$$

and derive:

$$
\frac{dy}{dx}
=
\frac{dy}{dz}\frac{dz}{dx}
$$

Explain this first intuitively and then mathematically.

Extend the explanation to functions containing several successive transformations.

Next, introduce a computational graph.

Explain how each node represents a calculation and how local derivatives can be combined to determine the derivative of the final output.

Importantly, include a branching example where one variable influences the result through multiple paths. Demonstrate why the derivatives along those paths must be added.

Then introduce a single-layer neural network:

$$
y_j=\sum_i w_{ji}x_i
$$

with squared-error loss:

$$
E=\frac12\sum_j(y_j-t_j)^2
$$

Derive:

$$
\frac{\partial E}{\partial w_{ji}}
=
(y_j-t_j)x_i
$$

Show every important step using the chain rule.

Explain the local structure of the result:

- The activation entering the connection.
- The error signal at the output of the connection.
- Their product, which gives the weight gradient.

Demonstrate the derivation with a small numerical example.

Conclude by explaining how the same principle generalizes to networks with hidden layers, where the error signal is no longer directly available from the target.

## 5.3 — Backpropagation Through Multiple Layers

**Objective:** Derive the general backpropagation algorithm rigorously and explain how it works.

This should be one of the most mathematically detailed pages.

Begin with the general feed-forward equations:

$$
a_j=\sum_i w_{ji}z_i
$$

$$
z_j=h(a_j)
$$

Define the quantities involved, including pre-activation, activation, weights, and biases.

Explain how the equations apply both to layered networks and more general feed-forward computational graphs.

Introduce the error signal:

$$
\delta_j\equiv\frac{\partial E}{\partial a_j}
$$

Derive the relationship between the error signal and a weight gradient:

$$
\boxed{
\frac{\partial E}{\partial w_{ji}}
=
\delta_jz_i
}
$$

Then derive the error signals for hidden units.

Use the multivariable chain rule to show why a hidden unit must receive contributions from every downstream unit to which it connects.

Derive:

$$
\boxed{
\delta_j
=
h'(a_j)\sum_k w_{kj}\delta_k
}
$$

Explain each part of this formula in prose.

Explicitly discuss:

- Why the computation proceeds backwards.
- Why the weights appear in the recursion.
- Why the activation derivative is required.
- Why multiple downstream contributions are summed.
- How biases are handled.
- How error signals are initialized at the output layer.
- How the process applies to networks with multiple hidden layers.

Be careful with output-layer derivatives.

The simplification

$$
\delta_k=y_k-t_k
$$

holds for appropriate matched output activations and loss functions, including linear outputs with squared error, sigmoid outputs with binary cross-entropy, and softmax outputs with categorical cross-entropy. Explain the relevant assumptions rather than presenting the result as universally true.

Then derive the matrix form for a layered network.

Using notation consistent with the existing notes, present the equivalent relationships:

$$
\boldsymbol{\delta}^{(l)}
=
\left(
(W^{(l+1)})^T
\boldsymbol{\delta}^{(l+1)}
\right)
\odot h'(\mathbf{a}^{(l)})
$$

and

$$
\frac{\partial E}{\partial W^{(l)}}
=
\boldsymbol{\delta}^{(l)}
(\mathbf{z}^{(l-1)})^T
$$

Include the corresponding bias gradient.

Define the dimensions of the matrices and vectors and explain why the transpose and outer product appear.

Explain the use of the elementwise product.

Use the conventions of the previous notes if their layer indexing differs.

Conclude with a complete algorithm summary:

1. Evaluate the network output using forward propagation.
2. Calculate the loss.
3. Calculate the output-layer error signals.
4. Propagate error signals backwards through the hidden layers.
5. Calculate gradients for all weights and biases.
6. Pass the resulting gradients to the optimization algorithm.

Also explain how gradients are accumulated or averaged over mini-batches, with careful attention to the loss reduction convention.

Include a well-designed network diagram showing the forward and backward computations.

## 5.4 — A Complete Worked Example

**Objective:** Make backpropagation concrete by performing every calculation on a small neural network.

This is a particularly important teaching page.

Use a small fully connected network consisting of:

- Two inputs.
- Two hidden neurons.
- One scalar output.
- One hidden layer.
- A nonlinear hidden activation, preferably tanh as in Bishop's worked example.
- A linear output activation.
- Squared-error loss.

Choose simple numerical values so the calculation is manageable by hand.

Use one consistent set of parameters throughout the entire example.

Work through the following stages.

### Forward propagation

Calculate the hidden-layer pre-activations, hidden activations, output, and loss.

Show the individual arithmetic as well as the corresponding matrix equations.

### Output error signal

Calculate the derivative of the loss with respect to the output pre-activation.

### Hidden-layer error signals

Apply the backpropagation recursion to calculate the error signals for both hidden neurons.

### Parameter gradients

Calculate the derivatives of the loss with respect to every weight and bias in both layers.

Show how each derivative follows from the corresponding activation and error signal.

### Gradient descent update

Perform one parameter update using a specified learning rate.

Keep this part brief because gradient descent has already been taught.

### Interpretation

Explain what the gradients mean and how the calculation would generalize to larger neural networks.

Use a consistent diagram throughout the worked example, annotating the values as they are calculated.

Include a table summarizing the relevant intermediate quantities and gradients.

Check all numerical calculations, signs, dimensions, and rounding.

The example must be complete enough that students can reproduce every result themselves.

## 5.5 — Numerical Differentiation and Gradient Checking

**Objective:** Explain why backpropagation is efficient and how its results can be checked.

Introduce numerical differentiation using finite differences:

$$
f'(x)\approx\frac{f(x+\epsilon)-f(x)}{\epsilon}
$$

Then introduce central differences:

$$
f'(x)\approx
\frac{f(x+\epsilon)-f(x-\epsilon)}{2\epsilon}
$$

Explain the approximation errors:

- Forward differences: $O(\epsilon)$.
- Central differences: $O(\epsilon^2)$.

Use a short Taylor expansion to explain why central differences have smaller leading-order truncation error.

Discuss the trade-off between truncation error and floating-point round-off error.

Explain why choosing an arbitrarily small $\epsilon$ does not necessarily improve accuracy.

Compare computational complexity.

For a neural network with $W$ parameters, explain why:

- A forward evaluation typically costs $O(W)$.
- Backpropagation calculates the full gradient in $O(W)$ time for a standard feed-forward network.
- Computing every parameter derivative independently with finite differences requires $O(W^2)$ time.

Explain the assumptions behind these statements.

Then introduce **gradient checking**.

Describe how numerical derivatives can be compared with those obtained from backpropagation or automatic differentiation.

Provide a practical example showing how to perform a gradient check on the network developed in Section 5.4.

Include a suitable relative-error measure and discuss reasonable floating-point tolerances and common implementation pitfalls.

Use a graph illustrating numerical derivative error against $\epsilon$, similar in purpose to Figure 8.2 of Bishop.

## 5.6 — Automatic Differentiation

**Objective:** Explain how modern deep learning frameworks automatically calculate derivatives, and why backpropagation is an instance of reverse-mode automatic differentiation.

Begin by distinguishing four approaches to obtaining derivatives:

1. Manually derived analytical derivatives.
2. Numerical differentiation.
3. Symbolic differentiation.
4. Automatic differentiation.

Explain their important differences.

In particular, emphasize that automatic differentiation is neither numerical finite-difference approximation nor simply symbolic manipulation.

Introduce the idea of decomposing a function into elementary operations and recording those operations as an evaluation trace or computational graph.

Use Bishop's example as a reference:

$$
f(x_1,x_2)
=
x_1x_2+\exp(x_1x_2)-\sin(x_2)
$$

Introduce intermediate variables and show how the function can be evaluated one elementary operation at a time.

### Forward-mode automatic differentiation

Explain primal variables and tangent variables.

Show how derivatives can be propagated alongside ordinary calculations using the chain rule.

Walk through a small example numerically.

Explain that a forward-mode pass can calculate a Jacobian–vector product.

Describe why forward mode is particularly effective when the number of inputs is relatively small compared with the number of outputs.

### Reverse-mode automatic differentiation

Introduce adjoint variables.

Explain how derivative information is propagated backwards through the evaluation graph.

Use the same function as in the forward-mode example so that students can compare the two approaches directly.

Demonstrate how reverse mode calculates derivatives of a scalar output with respect to multiple inputs in a single backward pass.

Relate this explicitly to the backpropagation equations derived in Section 5.3.

Explain why reverse mode is particularly well suited to neural network training, where there are many parameters but usually a scalar loss.

Discuss the need to retain or reconstruct intermediate values for the backward pass and the resulting memory implications.

### Modern implementations

Give a short, clear example of automatic differentiation in PyTorch, using the existing website's code-formatting conventions.

Demonstrate how the framework constructs the computation and evaluates gradients through `backward()`.

Explain, at a conceptual level, what happens during this call.

Distinguish between computing gradients, accumulating gradients, and updating model parameters.

If helpful, show how gradients can be cleared before an optimization step.

Conclude by comparing forward-mode and reverse-mode automatic differentiation, including their computational advantages and typical use cases.

Use carefully designed computational-graph diagrams that display the actual derivative flow.

## 5.7 — Jacobians, Hessians, and Higher-Order Derivatives

**Objective:** Extend the ideas of backpropagation beyond ordinary loss gradients.

This page can be shorter than Sections 5.3, 5.4, and 5.6, but it must remain mathematically rigorous.

### The Jacobian matrix

Introduce a vector-valued function:

$$
\mathbf{y}=f(\mathbf{x})
$$

Define its Jacobian:

$$
J_{ki}=\frac{\partial y_k}{\partial x_i}
$$

Explain the dimensions and interpretation of this matrix.

Describe the Jacobian as a measure of local sensitivity.

Introduce the first-order approximation:

$$
\Delta\mathbf{y}
\approx J\Delta\mathbf{x}
$$

Provide a small example involving a function with two inputs and two outputs.

Explain Jacobian–vector products and vector–Jacobian products, relating them to forward-mode and reverse-mode automatic differentiation.

Explain when the full Jacobian might be useful and when constructing it is unnecessary.

### The Hessian matrix

Introduce the Hessian of a scalar function:

$$
H_{ij}
=
\frac{\partial^2 E}{\partial w_i\partial w_j}
$$

Explain its relationship to the curvature of the error surface and second-order optimization.

Use a simple quadratic function to illustrate the concept.

Discuss the cost of storing and calculating a full Hessian for a neural network with $W$ parameters.

Explain why the full Hessian requires $O(W^2)$ storage and is generally impractical for very large models.

### Hessian–vector products

Explain the motivation for calculating $H\mathbf{v}$ without explicitly constructing $H$.

Introduce the connection to automatic differentiation and its $O(W)$ computational scaling under the usual assumptions.

Discuss practical applications briefly.

### Hessian approximations

Provide a concise conceptual introduction to the outer-product/Gauss–Newton-style approximation discussed by Bishop.

Explain the approximation's assumptions and limitations.

Detailed derivations of second-order approximation algorithms, inverse-Hessian updates, and specialized optimization methods are not necessary.

The aim is to establish the foundational concepts, not to develop an advanced numerical optimization course.

---

# 5. Mathematical Presentation Standards

Mathematics is central to these notes.

Follow the conventions already established in the project.

Every important mathematical derivation should:

1. State the problem or result being developed.
2. Define the notation.
3. Begin with the appropriate mathematical assumptions or definitions.
4. Show the important intermediate steps.
5. Arrive at the desired result.
6. Explain what the result means.
7. Connect it to the broader concept being taught.

Avoid unexplained statements such as "applying the chain rule gives..." when the application of the chain rule is itself the concept students are learning.

Do not omit important steps just because they are algebraically straightforward to an experienced reader.

At the same time, do not expand every trivial rearrangement into a separate displayed equation.

Use good judgment to balance readability and mathematical detail.

### Notation consistency

Check all previous notes for existing conventions involving:

- $\mathbf{x}$ for inputs.
- $\mathbf{w}$ or $W$ for weights.
- Bias vectors.
- Layer superscripts.
- Pre-activations and activations.
- Loss or error functions.
- Gradient notation.
- Jacobians.
- Matrix and vector orientation.

Match these conventions consistently.

Use Bishop's notation only where it is compatible with the existing notes, or clearly introduce any necessary differences.

Ensure all matrix equations are dimensionally correct.

### Important mathematical distinctions

Be especially careful about:

- Pre-activations versus activations.
- Derivatives with respect to weights versus derivatives with respect to activations.
- Output-layer error signals versus hidden-layer error signals.
- Gradient computation versus gradient descent updates.
- Scalar derivatives versus vector and matrix derivatives.
- The derivative of a nonlinear activation.
- Loss-function and output-activation combinations.
- Gradient accumulation and mini-batch averaging.
- Full Jacobian computation versus Jacobian–vector products.
- Full Hessian computation versus Hessian–vector products.
- Numerical differentiation versus automatic differentiation.

These distinctions must be explained correctly and consistently throughout the notes.

---

# 6. Diagrams, Figures, and Visual Explanations

Visual explanations are particularly useful for backpropagation.

Inspect the previous sections to determine how diagrams and figures are implemented and styled.

Follow the same conventions.

Create original diagrams rather than copying textbook artwork directly.

Important diagrams include:

| Page | Recommended diagram                                                       |
| ---- | ------------------------------------------------------------------------- |
| 5.1  | Neural network showing forward and backward information flow              |
| 5.2  | Computational graph demonstrating the chain rule                          |
| 5.3  | Multilayer network with error signals propagating backwards               |
| 5.4  | Fully labelled numerical example                                          |
| 5.5  | Error in finite-difference derivatives as a function of step size         |
| 5.6  | Computational graph showing forward-mode and reverse-mode differentiation |
| 5.7  | Jacobian sensitivity and Hessian curvature                                |

Diagrams should be accurate, clean, readable, and consistent with the existing website.

Every figure should:

- Have a clear educational purpose.
- Be positioned close to the explanation that refers to it.
- Include an appropriate caption, following existing conventions.
- Use consistent mathematical notation.
- Remain legible on mobile devices.
- Work correctly in the site's supported themes.
- Include accessible descriptions or labels where appropriate.

Where an interactive visualization would genuinely improve understanding, use the project's existing interaction and visualization infrastructure.

Do not add decorative graphics merely to fill space.

**Prioritize clarity, mathematical correctness, and consistency over visual complexity.**

---

# 7. Examples and Exercises

Worked examples are essential to this section.

Use them throughout the notes, but ensure they complement rather than interrupt the mathematical exposition.

Examples should increase in complexity as the section progresses.

At minimum, include:

- A scalar chain-rule calculation.
- A branching computational graph.
- A single-layer network gradient calculation.
- A complete multilayer network backpropagation calculation.
- A gradient-checking example.
- A forward-mode automatic differentiation example.
- A reverse-mode automatic differentiation example.
- A small Jacobian calculation.
- A small Hessian calculation.

Where possible, reuse the same function or neural network across several pages to build continuity.

Avoid introducing new notation and arbitrary numerical parameters unnecessarily.

If the existing notes contain exercises or self-check questions, follow the same conventions for including them.

Suggested exercises for the section include:

**Exercise 1 — Manual backpropagation**

Given a small neural network with specified parameters, inputs, and target, calculate the forward pass, loss, error signals, and gradients with respect to all trainable parameters.

**Exercise 2 — Implementing backpropagation**

Implement forward propagation and backpropagation using NumPy, without using automatic differentiation.

Verify the results using numerical gradient checking.

**Exercise 3 — Automatic differentiation**

Implement the same calculations using PyTorch and compare the resulting gradients.

If exercises are normally maintained in a separate part of the existing website, integrate them there instead of inventing a new exercise format.

---

# 8. Page-to-Page Continuity

The seven pages should read as one connected chapter.

Avoid treating each page as an independent article that repeats introductory definitions.

For example:

- Section 5.1 establishes the need for efficient gradient computation.
- Section 5.2 develops the chain rule needed to calculate those gradients.
- Section 5.3 applies the chain rule systematically to multilayer networks.
- Section 5.4 demonstrates the resulting algorithm in full.
- Section 5.5 explains its efficiency and how to verify its correctness.
- Section 5.6 generalizes the approach to automatic differentiation.
- Section 5.7 demonstrates how the same principles extend to other derivatives.

Use brief transitions between topics where helpful.

Refer to earlier results using the website's established linking and equation-reference conventions.

Avoid repeatedly explaining the same definitions.

Students should be able to read the section sequentially without encountering inconsistencies, missing prerequisites, or sudden changes in notation.

---

# 9. Content Depth and Quality

This material is for a Master's-level Machine Learning and Deep Learning course.

Students should be expected to understand calculus, basic linear algebra, and the machine learning concepts taught in earlier notes.

The aim is to make students genuinely understand the mathematics and mechanisms of backpropagation.

Do not oversimplify by omitting derivations.

Do not overcomplicate the material by introducing advanced theory that does not support the core learning objectives.

Allocate the greatest depth to:

1. Applying the chain rule to computational graphs.
2. Deriving the backpropagation equations.
3. Understanding the propagation of hidden-layer error signals.
4. Calculating gradients in a complete worked example.
5. Understanding reverse-mode automatic differentiation.

Provide a substantial treatment of numerical differentiation and forward-mode automatic differentiation.

Keep detailed second-order derivative approximations comparatively brief.

**Do not use arbitrary word-count targets.** Match the length and level of detail of comparable pages in the existing notes, while allowing especially important derivations and worked examples to be longer.

Every page should contain enough explanation for a student to understand the material without needing a lecturer to fill in missing steps.

---

# 10. Implementation Requirements

After inspecting the existing website, implement all seven pages using its established architecture.

Ensure that:

- Every page is created in the correct location.
- All required front matter or metadata is present.
- Section 5 appears in the main course navigation.
- All seven subsections appear in the correct order.
- Previous/next navigation works.
- Internal links resolve correctly.
- All equations render properly.
- All figures display correctly.
- Mathematical notation is consistent across pages.
- Existing styling and reusable components are preserved.
- The new material behaves correctly on mobile devices.
- The project builds without errors.

Avoid modifying earlier course notes unless a small correction or integration change is genuinely necessary.

Do not introduce a different rendering approach for the new pages if the project already has a suitable one.

If the project uses static generation, ensure all pages are included in the generated output.

If it uses route registration, metadata manifests, or content indexes, update them appropriately.

Preserve unrelated functionality.

---

# 11. Verification and Quality Assurance

After writing all pages, review the entire section as a continuous chapter.

Perform the following checks.

## Content verification

- Compare the completed material against every relevant subsection of Bishop Chapter 8.
- Ensure no essential topic has been accidentally omitted.
- Verify every mathematical derivation.
- Check all numerical examples independently.
- Check the dimensions of vectors and matrices.
- Confirm that notation is consistent.
- Confirm that results are presented with their necessary assumptions.
- Check that concepts are introduced before they are used.
- Remove unnecessary repetition across pages.
- Ensure all explanations are original and academically appropriate.

## Writing style verification

Compare every new page with the existing course notes.

Check the tone, sentence structure, paragraph organization, mathematical explanations, heading conventions, and worked-example formatting.

Revise passages that feel inconsistent with the previous material.

Do not accept content that sounds like a generic AI-produced tutorial rather than part of the existing course.

## Website verification

Run the relevant build, type-checking, linting, and other validation procedures supported by the repository.

Inspect the rendered pages wherever tooling permits.

Check:

- Mathematical rendering.
- Diagram positioning and legibility.
- Code formatting.
- Tables and captions.
- Page navigation.
- Internal links.
- Sidebar and table-of-contents behaviour.
- Responsive layouts.
- Theme compatibility.

Fix any issues you discover.

Do not claim to have completed a check unless you actually performed it.

---

# 12. Definition of Done

The task is complete only when:

1. All seven Section 5 notes pages have been fully written and implemented.
2. Their mathematical explanations are complete and accurate.
3. Their writing style is consistent with the previous course sections.
4. Their visual presentation matches the existing website.
5. Their diagrams and worked examples are fully functional and correctly displayed.
6. The section is correctly integrated into navigation and routing.
7. The complete chapter has been reviewed for continuity and repetition.
8. All available project validation checks pass, or any remaining limitations are clearly identified.

Do not stop after generating an outline or the first page.

Do not leave TODO markers, placeholder paragraphs, incomplete examples, missing figures, or unfinished mathematical derivations.

Make reasonable implementation decisions based on the patterns already established in the repository rather than asking for unnecessary clarification.

If an existing convention conflicts with a suggested implementation detail in this prompt, prefer the established project convention unless doing so would compromise mathematical accuracy or the required content.

At completion, provide a concise summary identifying the pages created, any shared components added, the integration changes made, and the validation performed.

**Final goal:** Produce Section 5 as a complete, rigorous, clearly written, and visually consistent continuation of the existing Machine Learning and Deep Learning course notes. The finished material should teach students not only how to apply backpropagation, but why the algorithm works, how it is derived, why it is computationally efficient, and how it relates to automatic differentiation in modern deep learning frameworks.
