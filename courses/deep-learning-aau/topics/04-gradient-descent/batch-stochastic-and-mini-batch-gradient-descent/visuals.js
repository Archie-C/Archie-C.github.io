(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const svg = (id, content) => { $(id).innerHTML = content; };
  const text = (x, y, value, anchor = 'middle', color = 'var(--fg-2)') => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="var(--font-mono)" font-size="11">${value}</text>`;
  const line = (x1, y1, x2, y2, color = 'var(--rule-strong)', width = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
  const circle = (x, y, r, color) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
  const fmt = n => n.toFixed(2);
  const gradients = [-1, -4, -6, -16];
  function combinations(values, count, start = 0, prefix = []) {
    if (!count) return [prefix];
    return values.slice(start).flatMap((value, offset) => combinations(values, count - 1, start + offset + 1, [...prefix, value]));
  }
  function distribution() {
    const b = +$('dist-size').value;
    const means = combinations(gradients, b).map(c => c.reduce((a, v) => a + v, 0) / b);
    const x = v => 70 + (v + 17) / 17 * 540;
    let out = line(70, 145, 610, 145);
    [-16, -12, -8, -4, 0].forEach(v => { out += line(x(v), 145, x(v), 150) + text(x(v), 168, v); });
    out += line(x(-6.75), 28, x(-6.75), 145, 'var(--accent)', 2) + text(x(-6.75), 20, 'full gradient', 'middle', 'var(--accent)');
    const counts = {};
    means.forEach(v => { const key = v.toFixed(6); counts[key] = (counts[key] || 0) + 1; out += circle(x(v), 133 - 12 * (counts[key] - 1), 5, 'var(--fg)'); });
    svg('distribution', out);
    $('dist-value').textContent = b;
    $('dist-readout').textContent = `${means.length} possible ${b === 1 ? 'subset' : 'subsets'}; gradient estimates: ${means.map(fmt).join(', ')}.`;
  }
  let order = Array.from({length: 12}, (_, i) => i + 1);
  function batches() {
    const b = +$('batch-size').value, count = Math.ceil(order.length / b);
    let out = '';
    for (let i = 0; i < count; i++) {
      const y = 14 + i * 16;
      out += text(80, y + 11, `update ${i + 1}`, 'end');
      order.slice(i * b, (i + 1) * b).forEach((n, j) => {
        const x = 98 + j * 43;
        out += `<rect x="${x}" y="${y}" width="36" height="14" rx="2" fill="var(--accent-soft)" stroke="var(--accent)"/>` + text(x + 18, y + 11, n, 'middle', 'var(--fg)');
      });
    }
    svg('batches', out);
    $('batch-value').textContent = b;
    $('batch-readout').textContent = `${count} updates per epoch; ${order.length % b || b} examples in the final batch.`;
  }
  const centres = [[1, 1], [3, 1], [1, 3], [3, 3]];
  const loss = w => centres.reduce((sum, a) => sum + ((w[0]-a[0]) ** 2 + (w[1]-a[1]) ** 2) / 2, 0) / centres.length;
  let selected, full, steps, position, epochs, history, fullHistory, last;
  function reset() { selected = [0, 0]; full = [0, 0]; steps = 0; position = 0; epochs = 0; history = [selected]; fullHistory = [full]; last = 'none'; trajectory(); }
  function update(w, indices) {
    const gradient = [0, 1].map(j => indices.reduce((s, i) => s + w[j] - centres[i][j], 0) / indices.length);
    return w.map((v, j) => v - 0.25 * gradient[j]);
  }
  function advance() {
    const b = +$('trajectory-size').value;
    const indices = Array.from({length: Math.min(b, 4 - position)}, (_, i) => position + i);
    selected = update(selected, indices); full = update(full, [0, 1, 2, 3]);
    position += indices.length; if (position === 4) { epochs++; position = 0; }
    last = indices.map(i => i + 1).join(', '); steps++; history.push(selected); fullHistory.push(full); trajectory();
  }
  function trajectory() {
    const X = v => 105 + v * 85, Y = v => 265 - v * 85;
    let out = '';
    [0.5, 1, 1.5, 2].forEach(r => { out += `<circle cx="${X(2)}" cy="${Y(2)}" r="${r * 85}" fill="none" stroke="var(--rule)"/>`; });
    out += line(X(0), Y(0), X(3), Y(0)) + line(X(0), Y(0), X(0), Y(3));
    [0, 1, 2, 3].forEach(v => { out += text(X(v), Y(0) + 17, v) + text(X(0) - 12, Y(v) + 4, v, 'end'); });
    out += text(X(3) + 20, Y(0) + 17, 'w₁') + text(X(0) - 12, Y(3) - 12, 'w₂');
    const path = (points, color) => `<polyline points="${points.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>` + points.map(p => circle(X(p[0]), Y(p[1]), 3, color)).join('');
    out += path(fullHistory, '#397396') + path(history, 'var(--accent)');
    out += text(470, 70, 'selected batch', 'start', 'var(--accent)') + text(470, 90, 'full batch', 'start', '#397396') + text(470, 120, 'minimum (2, 2)', 'start');
    svg('trajectory', out);
    $('trajectory-value').textContent = $('trajectory-size').value;
    $('trajectory-readout').textContent = `Updates: ${steps} each. Selected: ${epochs} complete epochs, ${position}/4 examples in current epoch; last examples: ${last}; w = (${fmt(selected[0])}, ${fmt(selected[1])}), full loss = ${fmt(loss(selected))}. Full-batch: ${steps} complete epochs; w = (${fmt(full[0])}, ${fmt(full[1])}), full loss = ${fmt(loss(full))}.`;
  }
  $('dist-size').addEventListener('input', distribution);
  $('batch-size').addEventListener('input', batches);
  $('shuffle').addEventListener('click', () => { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } batches(); });
  $('order-reset').addEventListener('click', () => { order = Array.from({length: 12}, (_, i) => i + 1); batches(); });
  $('trajectory-size').addEventListener('input', reset);
  $('step').addEventListener('click', advance);
  $('reset').addEventListener('click', reset);
  distribution(); batches(); reset();
  ['distribution-controls', 'batch-controls', 'trajectory-controls'].forEach(id => { $(id).hidden = false; });
})();
