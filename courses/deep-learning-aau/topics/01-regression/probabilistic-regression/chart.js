window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") return;

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();
  const colours = {
    fg: token("--fg"),
    fg2: token("--fg-2"),
    fg3: token("--fg-3"),
    bg: token("--bg"),
    rule: token("--rule"),
    density: token("--c-cat-1"),
    observation: token("--c-cat-2"),
    mono: token("--font-mono") || "monospace"
  };

  const line = (label, data, colour, dash = []) => ({
    label,
    data,
    borderColor: colour,
    borderWidth: 1.5,
    borderDash: dash,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0,
    fill: false
  });

  const dot = (label, x, y, colour) => ({
    label,
    data: [{ x, y }],
    showLine: false,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBackgroundColor: colour,
    pointBorderColor: colour,
    pointBorderWidth: 0
  });

  function buildChart(id, datasets, xTitle, yTitle, bounds, tooltipLabel) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;

    const axis = (title, min, max, horizontal) => ({
      type: "linear",
      min,
      max,
      grid: { display: !horizontal, color: colours.rule, tickColor: colours.fg3 },
      border: { color: colours.fg2, width: 1 },
      ticks: {
        color: colours.fg3,
        maxTicksLimit: horizontal ? 5 : 4,
        font: { family: colours.mono, size: 11 }
      },
      title: {
        display: true,
        text: title,
        align: "end",
        color: colours.fg3,
        font: { family: colours.mono, size: 10, weight: "500" }
      }
    });

    return new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false },
        layout: { padding: { top: 4, right: 6 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colours.bg,
            borderColor: colours.rule,
            borderWidth: 1,
            titleColor: colours.fg,
            bodyColor: colours.fg2,
            displayColors: false,
            padding: 10,
            titleFont: { family: colours.mono, size: 12, weight: "600" },
            bodyFont: { family: colours.mono, size: 12 },
            filter: (item) => item.dataset.label !== "Predicted mean",
            callbacks: {
              title: (items) => items.length ? `${xTitle} = ${items[0].parsed.x.toFixed(2)}` : "",
              label: tooltipLabel
            }
          }
        },
        scales: {
          x: axis(xTitle, bounds.xMin, bounds.xMax, true),
          y: axis(yTitle, 0, bounds.yMax, false)
        }
      }
    });
  }

  // Fix the mean and vary only the assumed observation noise.
  const mean = 2;
  const observedTarget = 3.5;
  const gaussian = (t, sigma) =>
    Math.exp(-0.5 * ((t - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  const targetValues = Array.from({ length: 241 }, (_, i) => -4 + i / 20);
  const densityData = (sigma) => targetValues.map((t) => ({ x: t, y: gaussian(t, sigma) }));

  const sigmaInput = document.getElementById("noiseSigma");
  const initialSigma = sigmaInput ? Number(sigmaInput.value) : 1;
  const densityChart = buildChart("gaussianPredictionChart", [
    line("Gaussian density", densityData(initialSigma), colours.density),
    line("Predicted mean", [{ x: mean, y: 0 }, { x: mean, y: 0.85 }], colours.fg3, [3, 3]),
    dot("Density at t = 3.5", observedTarget, gaussian(observedTarget, initialSigma), colours.observation)
  ], "target t", "density", { xMin: -4, xMax: 8, yMax: 0.85 },
  (item) => `density = ${item.parsed.y.toFixed(3)}`);

  if (densityChart && sigmaInput) {
    const sigmaValue = document.getElementById("noiseSigmaValue");
    const readout = document.getElementById("gaussianReadout");
    const controls = document.getElementById("noiseControls");

    function updateNoise() {
      const sigma = Number(sigmaInput.value);
      const density = gaussian(observedTarget, sigma);
      densityChart.data.datasets[0].data = densityData(sigma);
      densityChart.data.datasets[2].data = [{ x: observedTarget, y: density }];
      densityChart.update("none");
      sigmaInput.setAttribute("aria-valuetext", `σ = ${sigma.toFixed(1)}`);
      if (sigmaValue) sigmaValue.value = sigma.toFixed(1);
      if (readout) {
        readout.value = `Variance σ² = ${(sigma ** 2).toFixed(2)} · density at t = 3.5: ${density.toFixed(3)}`;
      }
    }

    updateNoise();
    sigmaInput.addEventListener("input", updateNoise);
    if (controls) controls.hidden = false;
  }

  // Both objectives use the same three targets and fixed variance σ² = 1.
  const targets = [1, 2, 3];
  const predictions = Array.from({ length: 121 }, (_, i) => -1 + i / 20);
  const halfSquaredError = (mu) => targets.reduce((sum, t) => sum + (t - mu) ** 2, 0) / 2;
  const logNormaliser = targets.length * Math.log(2 * Math.PI) / 2;
  const likelihood = (mu) => Math.exp(-halfSquaredError(mu) - logNormaliser);

  buildChart("regressionLikelihoodChart", [
    line("Likelihood", predictions.map((mu) => ({ x: mu, y: likelihood(mu) })), colours.density),
    dot("Maximum at μ = 2", mean, likelihood(mean), colours.density)
  ], "prediction μ", "likelihood", { xMin: -1, xMax: 5, yMax: 0.025 },
  (item) => `likelihood = ${item.parsed.y.toFixed(5)}`);

  buildChart("regressionErrorChart", [
    line("Half the sum of squared residuals", predictions.map((mu) => ({ x: mu, y: halfSquaredError(mu) })), colours.observation),
    dot("Minimum at μ = 2", mean, halfSquaredError(mean), colours.observation)
  ], "prediction μ", "½ sum of squared residuals", { xMin: -1, xMax: 5, yMax: 15 },
  (item) => `½ sum of squared residuals = ${item.parsed.y.toFixed(2)}`);
});
