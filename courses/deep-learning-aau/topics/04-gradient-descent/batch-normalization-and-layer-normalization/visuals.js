(() => {
  'use strict';
  const eps = 0.01;
  const $ = id => document.getElementById(id);
  const fmt = x => Math.abs(x) < 0.0005 ? '0.000' : x.toFixed(3);
  const stats = values => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return { mean, variance };
  };
  const norm = (x, s) => (x - s.mean) / Math.sqrt(s.variance + eps);
  const input = $('matrix-input');
  input.innerHTML = '<div class="matrix-label">Original A · examples ↓, features →</div>' + [[1, 3, 5], [5, 9, 1]].map((row, n) => '<div class="matrix-row">' + row.map((value, i) => `<label><span class="sr-only">Example ${n + 1}, feature ${i + 1}</span><input type="number" step="1" value="${value}" data-n="${n}" data-i="${i}"></label>`).join('') + '</div>').join('');
  const fields = [...input.querySelectorAll('input')];
  function updateGroups() {
    const count = $('method').value === 'batch' ? 3 : 2;
    $('group').innerHTML = Array.from({length: count}, (_, i) => `<option value="${i}">${$('method').value === 'batch' ? 'Feature' : 'Example'} ${i + 1}</option>`).join('');
  }
  function matrix() {
    if (fields.some(el => el.value.trim() === '' || !Number.isFinite(Number(el.value)))) {
      $('matrix-output').textContent = 'Enter a finite number in every cell.';
      $('matrix-calc').textContent = '';
      return;
    }
    const a = [fields.slice(0, 3).map(el => Number(el.value)), fields.slice(3).map(el => Number(el.value))];
    const batch = $('method').value === 'batch', group = Number($('group').value);
    const sets = batch ? [0, 1, 2].map(i => a.map(row => row[i])) : a;
    const ss = sets.map(stats);
    fields.forEach(el => el.classList.toggle('selected', Number(el.dataset[batch ? 'i' : 'n']) === group));
    const normalized = a.map((row, n) => row.map((v, i) => norm(v, ss[batch ? i : n])));
    $('matrix-output').innerHTML = '<div class="matrix-label">Normalised Â · before scale and shift</div>' + normalized.map((row, n) => '<div class="matrix-row">' + row.map((v, i) => `<span class="matrix-cell ${ (batch ? i : n) === group ? 'selected' : ''}">${fmt(v)}</span>`).join('') + '</div>').join('');
    const s = ss[group];
    $('matrix-calc').textContent = `Selected values: ${sets[group].map(fmt).join(', ')}. Mean = ${fmt(s.mean)}; variance = ${fmt(s.variance)}; denominator = √(${fmt(s.variance)} + ${eps}) = ${fmt(Math.sqrt(s.variance + eps))}. First example, normalised: ${normalized[0].map(fmt).join(', ')}.`;
  }
  $('method').addEventListener('change', () => { updateGroups(); matrix(); });
  $('group').addEventListener('change', matrix);
  fields.forEach(el => el.addEventListener('input', matrix));
  updateGroups(); matrix();
  function affine() {
    const g = Number($('gamma').value), b = Number($('beta').value), s = stats([1, 5]);
    const z = [1, 5].map(x => norm(x, s));
    $('gamma-out').textContent = fmt(g); $('beta-out').textContent = fmt(b);
    $('affine-readout').textContent = `Normalised: (${z.map(fmt).join(', ')}). After γ × normalised + β: (${z.map(x => fmt(g * x + b)).join(', ')}). Mean = ${fmt(b)}; standard deviation = ${fmt(Math.abs(g) * Math.sqrt(s.variance / (s.variance + eps)))}.`;
  }
  $('gamma').addEventListener('input', affine); $('beta').addEventListener('input', affine); affine();
  function mode() {
    const other = Number($('other').value), training = $('mode').value === 'train';
    const s = training ? stats([2, other]) : {mean: 4, variance: 9};
    $('other-out').textContent = other;
    $('mode-readout').textContent = `${training ? 'Current batch [2, ' + other + ']' : 'Fixed running statistics'}: mean = ${fmt(s.mean)}, variance = ${fmt(s.variance)}. Fixed example: (2 − ${fmt(s.mean)}) / √(${fmt(s.variance)} + ${eps}) = ${fmt(norm(2, s))}. Affine output = ${fmt(norm(2, s))}.`;
  }
  $('other').addEventListener('input', mode); $('mode').addEventListener('change', mode); mode();
  const x = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const layer1 = x.map(([a,b]) => [2*a+b+1, -a+3*b-1]);
  const layer2 = layer1.map(row => {const [a,b] = row.map(v => Math.max(0,v)); return [0.5*a+2*b, -2*a+b+2];});
  $('signals').innerHTML = [ ['Inputs', x], ['Layer 1 pre-activations', layer1], ['Layer 2 pre-activations', layer2] ].map(([label, values]) => { const s = stats(values.flat()); return `<p><strong>${label}</strong>: ${values.map(row => '(' + row.join(', ') + ')').join(' ')}<br>pooled mean ${fmt(s.mean)} · pooled standard deviation ${fmt(Math.sqrt(s.variance))}</p>`; }).join('');
})();
