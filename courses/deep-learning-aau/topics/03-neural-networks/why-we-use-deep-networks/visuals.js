(() => {
  'use strict';

  const slider = document.getElementById('hidden-width');
  const curve = document.getElementById('network-curve');
  const knots = document.getElementById('interpolation-knots');
  const count = document.getElementById('width-value');
  const readout = document.getElementById('approximation-error');
  const description = document.getElementById('approx-desc');
  const controls = document.getElementById('approximation-controls');
  const target = x => 0.55 * Math.sin(2 * Math.PI * x) + 0.3 * x;
  const relu = x => Math.max(0, x);
  const screenX = x => 54 + 592 * x;
  const screenY = y => 250 - (y + 0.6) / 1.4 * 226;

  function render() {
    const width = Number(slider.value);
    const values = Array.from({ length: width + 1 }, (_, j) => target(j / width));
    const slopes = Array.from({ length: width }, (_, j) => (values[j + 1] - values[j]) * width);
    // Exactly M ReLU units: the initial ramp at zero and M - 1 interior hinges.
    // Output coefficients are slope changes, as derived in the note.
    function predict(x) {
      let y = values[0] + slopes[0] * relu(x);
      for (let j = 1; j < width; j += 1) {
        y += (slopes[j] - slopes[j - 1]) * relu(x - j / width);
      }
      return y;
    }

    const path = [];
    const points = document.createDocumentFragment();
    for (let j = 0; j <= width; j += 1) {
      const x = j / width;
      const px = screenX(x).toFixed(2);
      const py = screenY(predict(x)).toFixed(2);
      path.push(`${j === 0 ? 'M' : 'L'} ${px} ${py}`);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', py);
      dot.setAttribute('r', '3');
      points.appendChild(dot);
    }
    curve.setAttribute('d', path.join(' '));
    knots.replaceChildren(points);

    let maxError = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const x = i / 1000;
      maxError = Math.max(maxError, Math.abs(target(x) - predict(x)));
    }
    count.textContent = String(width);
    readout.textContent = `${width} hidden ${width === 1 ? 'neuron' : 'neurons'} · sampled maximum absolute error: ${maxError.toFixed(4)}`;
    description.textContent = `The smooth target is compared with the piecewise linear output of ${width} hidden ReLU ${width === 1 ? 'neuron' : 'neurons'} on the interval zero to one. The maximum absolute error on 1,001 evaluation inputs is ${maxError.toFixed(4)}.`;
  }

  render();
  controls.hidden = false;
  slider.addEventListener('input', render);
})();
