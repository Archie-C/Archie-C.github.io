(() => {
  'use strict';

  const inputs = [0, 1, 2].map(i => document.getElementById(`logit-${i}`));
  const controls = document.getElementById('logit-controls');
  const readout = document.getElementById('softmax-readout');
  const sigmoid = a => {
    if (a >= 0) return 1 / (1 + Math.exp(-a));
    const exponential = Math.exp(a);
    return exponential / (1 + exponential);
  };
  const format = value => value.toFixed(3);

  function render() {
    const logits = inputs.map(input => Number(input.value));
    const maximum = Math.max(...logits);
    // Subtract the largest logit before exponentiating to avoid overflow.
    const exponentials = logits.map(a => Math.exp(a - maximum));
    const denominator = exponentials.reduce((total, value) => total + value, 0);
    const softmax = exponentials.map(value => value / denominator);
    const sigmoids = logits.map(sigmoid);

    for (let i = 0; i < logits.length; i += 1) {
      document.getElementById(`logit-value-${i}`).textContent = logits[i].toFixed(1);
      inputs[i].setAttribute('aria-valuetext', `${logits[i].toFixed(1)}; sigmoid probability ${format(sigmoids[i])}; softmax probability ${format(softmax[i])}`);
      for (const [kind, probabilities] of [['sigmoid', sigmoids], ['softmax', softmax]]) {
        document.getElementById(`${kind}-bar-${i}`).setAttribute('width', (210 * probabilities[i]).toFixed(3));
        document.getElementById(`${kind}-value-${i}`).textContent = format(probabilities[i]);
      }
    }

    const sigmoidTotal = sigmoids.reduce((total, value) => total + value, 0);
    const softmaxTotal = softmax.reduce((total, value) => total + value, 0);
    document.getElementById('sigmoid-total').textContent = `Probability total: ${format(sigmoidTotal)}`;
    document.getElementById('softmax-total').textContent = `Probability total: ${format(softmaxTotal)}`;
    document.getElementById('sigmoid-title').textContent = `Separate sigmoid probabilities for scores ${logits.join(', ')}`;
    document.getElementById('softmax-title').textContent = `Softmax probabilities for scores ${logits.join(', ')}`;
    document.getElementById('sigmoid-desc').textContent = `Probabilities ${sigmoids.map(format).join(', ')}. Total ${format(sigmoidTotal)}; no sum-to-one constraint.`;
    document.getElementById('softmax-desc').textContent = `Probabilities ${softmax.map(format).join(', ')}. Total ${format(softmaxTotal)}.`;

    const winners = logits.flatMap((a, i) => a === maximum ? [i + 1] : []);
    const prediction = winners.length === 1 ? `Predict class ${winners[0]}` : `Tie between classes ${winners.join(', ')}`;
    // Evaluate CE for the illustrative correct class 2 directly from logits.
    const loss = (maximum - logits[1]) + Math.log(denominator);
    readout.textContent = `Softmax: (${softmax.map(format).join(', ')}). ${prediction}. If class 2 is correct, its loss is ${loss.toFixed(4)}.`;
  }

  render();
  controls.hidden = false;
  inputs.forEach(input => input.addEventListener('input', render));
})();
