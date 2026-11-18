/* Fit the two-location example using mean BCE + lambda * ||w||² / 2. */
(() => {
  const norm = Math.sqrt(13);
  const direction = [3 / norm, 2 / norm];
  const projected = [-5 / norm, 8 / norm];
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  const softplus = z => Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z)));

  function fit(lambda) {
    if (!(lambda > 0) || !Number.isFinite(lambda)) throw new Error('Lambda must be positive.');
    // The optimal weight is parallel to the difference between the locations.
    // Any perpendicular component adds a penalty without improving the fit.
    function state(a, b) {
      const z = projected.map(s => a * s + b);
      const p = z.map(sigmoid);
      const error = [p[0], p[1] - 1];
      const curvature = p.map(v => v * (1 - v));
      const bce = (softplus(z[0]) + 2 * softplus(-z[1])) / 3;
      const penalty = lambda * a * a / 2;
      return {
        p, bce, penalty, total: bce + penalty,
        ga: (error[0] * projected[0] + 2 * error[1] * projected[1]) / 3 + lambda * a,
        gb: (error[0] + 2 * error[1]) / 3,
        haa: (curvature[0] * projected[0] ** 2 + 2 * curvature[1] * projected[1] ** 2) / 3 + lambda,
        hab: (curvature[0] * projected[0] + 2 * curvature[1] * projected[1]) / 3,
        hbb: (curvature[0] + 2 * curvature[1]) / 3,
      };
    }
    let a = 1, b = 0;
    for (let iteration = 0; iteration < 80; iteration++) {
      const s = state(a, b);
      if (Math.hypot(s.ga, s.gb) < 1e-11) break;
      const determinant = s.haa * s.hbb - s.hab * s.hab;
      const da = (s.hbb * s.ga - s.hab * s.gb) / determinant;
      const db = (s.haa * s.gb - s.hab * s.ga) / determinant;
      let step = 1;
      while (step > 1e-10 && state(a - step * da, b - step * db).total > s.total - 1e-4 * step * (s.ga * da + s.gb * db)) step /= 2;
      a -= step * da;
      b -= step * db;
    }
    const s = state(a, b);
    return {lambda, w: direction.map(v => a * v), b, weightNorm: a,
      boundary: -b / a, probabilities: s.p, bce: s.bce, penalty: s.penalty,
      total: s.total, gradientNorm: Math.hypot(s.ga, s.gb)};
  }

  // Keep the exact same solver available to the offline numerical check.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {fit};
    return;
  }

  const reference = fit(.01);
  const format = value => (Math.abs(value) < .0005 ? 0 : value).toFixed(3);
  const lambdaFormat = value => value < .01 ? value.toFixed(4) : value.toFixed(3);
  let serial = 0;

  function plot(result) {
    const id = `reg-plot-${++serial}`;
    // Both axes use 60 SVG pixels per input unit.
    const x = v => 328 + 60 * v, y = v => 172 - 60 * v;
    const line = (a, b, attributes = '') => `<line x1="${x(a[0])}" y1="${y(a[1])}" x2="${x(b[0])}" y2="${y(b[1])}" ${attributes}/>`;
    const boundary = r => {
      const centre = direction.map(v => v * r.boundary);
      const tangent = [-direction[1], direction[0]];
      return line(centre.map((v, i) => v - 12 * tangent[i]), centre.map((v, i) => v + 12 * tangent[i]));
    };
    const centre = direction.map(v => v * result.boundary);
    const tip = centre.map((v, i) => v + result.w[i]);
    const ticks = [-2, 0, 2].map(v => `
      <line x1="${x(v)}" y1="22" x2="${x(v)}" y2="322" class="reg-grid"/>
      <line x1="58" y1="${y(v)}" x2="598" y2="${y(v)}" class="reg-grid"/>
      <text x="${x(v)}" y="345" text-anchor="middle" class="reg-tick">${v}</text>
      <text x="46" y="${y(v) + 5}" text-anchor="end" class="reg-tick">${v}</text>`).join('');
    const title = `Fitted line for lambda ${lambdaFormat(result.lambda)}; weight norm ${format(result.weightNorm)}, bias ${format(result.b)}.`;
    const point = (location, label, probability, positive) => {
      const px = x(location[0]), py = y(location[1]);
      return `${positive ? `<circle cx="${px}" cy="${py}" r="7" class="reg-positive"/>` :
        `<path d="M${px - 6},${py - 6}L${px + 6},${py + 6}M${px - 6},${py + 6}L${px + 6},${py - 6}" class="reg-negative"/>`}
        <text x="${px}" y="${py + 28}" text-anchor="middle" class="reg-point-label">${label}</text>
        <text x="${px}" y="${py + 48}" text-anchor="middle" class="reg-point-probability">P(1) = ${format(probability)}</text>`;
    };
    return `<svg class="regularisation-plot" viewBox="0 0 650 380" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">${title}</title>
      <desc id="${id}-desc">One class-zero observation at minus one, minus one, and two class-one observations at two, one. The solid line is the fitted boundary. The dashed line is the lambda 0.01 reference. The arrow shows the fitted weight vector with its actual length in input units.</desc>
      <defs><clipPath id="${id}-clip"><rect x="58" y="22" width="540" height="300"/></clipPath><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" class="reg-arrowhead"/></marker></defs>
      ${ticks}<rect x="58" y="22" width="540" height="300" class="reg-frame"/>
      <g clip-path="url(#${id}-clip)"><g class="reg-reference">${boundary(reference)}</g><g class="reg-boundary">${boundary(result)}</g>
        ${line(centre, tip, `class="reg-weight" marker-end="url(#${id}-arrow)"`)}
        <circle cx="${x(centre[0])}" cy="${y(centre[1])}" r="3" class="reg-origin"/>
        <text x="${x(centre[0] + .55 * result.w[0]) + 8}" y="${y(centre[1] + .55 * result.w[1]) + 20}" class="reg-weight-label">w</text>
        ${point([-1, -1], 'Class 0 · 1 observation', result.probabilities[0], false)}
        ${point([2, 1], 'Class 1 · 2 observations', result.probabilities[1], true)}</g>
      <text x="328" y="373" text-anchor="middle" class="reg-axis-label">Feature x₁</text>
      <text transform="translate(16 172) rotate(-90)" text-anchor="middle" class="reg-axis-label">Feature x₂</text>
    </svg>`;
  }

  document.querySelectorAll('[data-regularisation-example]').forEach(example => {
    const input = example.querySelector('input[type="range"]');
    function render(lambda) {
      const r = fit(lambda);
      example.dataset.lambda = lambda;
      example.querySelector('[data-reg-plot]').innerHTML = plot(r);
      const values = example.querySelector('[data-reg-values]');
      if (values) values.innerHTML = `<div><dt>Weights (w₁, w₂)</dt><dd>(${r.w.map(format).join(', ')})</dd></div><div><dt>Weight size ‖w‖</dt><dd>${format(r.weightNorm)}</dd></div><div><dt>Bias b</dt><dd>${format(r.b)}</dd></div>`;
      const losses = example.querySelector('[data-reg-losses]');
      if (losses) losses.innerHTML = `<dl><div><dt>BCE</dt><dd>${format(r.bce)}</dd></div><div><dt>L2 penalty: λ‖w‖²/2</dt><dd>${format(r.penalty)}</dd></div><div class="reg-total"><dt>Total objective</dt><dd>${format(r.total)}</dd></div></dl>`;
      const classification = example.querySelector('[data-reg-classification]');
      if (classification) classification.textContent = r.probabilities[0] < .5 ? 'Both locations classified correctly. Dashed: λ = 0.01.' : 'Class 0 is now predicted as 1. Dashed: λ = 0.01.';
      const summary = example.querySelector('[data-reg-summary]');
      if (summary) summary.innerHTML = `<span>w = (${r.w.map(format).join(', ')}), &nbsp; b = ${format(r.b)}</span><span>Weight size ‖w‖ = ${format(r.weightNorm)}</span>`;
      const output = example.querySelector('[data-reg-lambda]');
      if (output) output.textContent = lambdaFormat(lambda);
      if (input) input.setAttribute('aria-valuetext', `Lambda ${lambdaFormat(lambda)}`);
      example.querySelectorAll('[data-reg-preset]').forEach(button => button.setAttribute('aria-pressed', Math.abs(Math.log10(Number(button.dataset.regPreset) / lambda)) < .005 ? 'true' : 'false'));
    }
    render(Number(example.dataset.lambda));
    if (!input) return;
    input.addEventListener('input', () => render(10 ** Number(input.value)));
    // Arrow keys should operate the slider without advancing the presentation.
    input.addEventListener('keydown', event => event.stopPropagation());
    example.querySelectorAll('[data-reg-preset]').forEach(button => button.addEventListener('click', () => {
      input.value = Math.log10(Number(button.dataset.regPreset));
      render(Number(button.dataset.regPreset));
    }));
  });
})();
