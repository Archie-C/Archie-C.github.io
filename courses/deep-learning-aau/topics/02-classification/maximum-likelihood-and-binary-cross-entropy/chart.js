window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") return;

  const rootStyles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => rootStyles.getPropertyValue(name).trim() || fallback;
  const colours = {
    fg: token("--fg", "#252525"),
    fg2: token("--fg-2", "#666666"),
    fg3: token("--fg-3", "#888888"),
    bg: token("--bg", "#ffffff"),
    rule: token("--rule", "#dddddd"),
    class0: token("--c-cat-2", "#2C4A7A"),
    class1: token("--c-cat-1", "#6B2C5C"),
    accent: token("--accent", "#6B2C5C"),
    success: token("--success", "#52796F"),
    mono: token("--font-mono", "monospace")
  };

  Chart.defaults.font.family = colours.mono;
  Chart.defaults.color = colours.fg2;

  const sharedOptions = (xTitle, yTitle, xMin, xMax, yMin, yMax, tooltipCallbacks) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
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
        callbacks: tooltipCallbacks
      }
    },
    scales: {
      x: {
        type: "linear",
        min: xMin,
        max: xMax,
        grid: { display: false, color: colours.rule },
        border: { color: colours.fg2 },
        ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } },
        title: { display: true, text: xTitle, align: "end", color: colours.fg3, font: { family: colours.mono, size: 10, weight: "500" }, padding: { top: 6 } }
      },
      y: {
        min: yMin,
        max: yMax,
        grid: { color: colours.rule, drawTicks: true, tickColor: colours.fg3 },
        border: { color: colours.fg2 },
        ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } },
        title: { display: true, text: yTitle, align: "end", color: colours.fg3, font: { family: colours.mono, size: 10, weight: "500" }, padding: { bottom: 6 } }
      }
    }
  });

  const lineDataset = (label, data, colour, dash = []) => ({
    label,
    data,
    showLine: true,
    borderColor: colour,
    borderWidth: 2,
    borderDash: dash,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0
  });

  // Likelihoods are computed from the same tiny target vector.
  const likelihoodCanvas = document.getElementById("likelihoodComparisonChart");
  if (likelihoodCanvas) {
    const targets = [1, 0, 1];
    const models = [
      { label: "Good model", probabilities: [0.9, 0.2, 0.7] },
      { label: "Reasonable model", probabilities: [0.8, 0.35, 0.65] },
      { label: "Poor model", probabilities: [0.6, 0.7, 0.4] },
      { label: "Very poor model", probabilities: [0.2, 0.9, 0.1] }
    ].map((model) => ({
      ...model,
      likelihood: model.probabilities.reduce((product, p, i) =>
        product * (targets[i] === 1 ? p : 1 - p), 1)
    }));

    new Chart(likelihoodCanvas, {
      type: "bar",
      data: {
        labels: models.map((model) => model.label),
        datasets: [{
          label: "Likelihood",
          data: models.map((model) => model.likelihood),
          backgroundColor: [colours.class1, colours.accent, colours.class0, colours.rule],
          borderColor: [colours.class1, colours.accent, colours.class0, colours.rule],
          borderWidth: 1,
          borderRadius: 3
        }]
      },
      options: {
        ...sharedOptions("model", "likelihood", 0, undefined, 0, 1, {
          title: (items) => items.length ? items[0].label : "",
          label: (item) => `likelihood = ${item.parsed.y.toFixed(3)}`
        }),
        scales: {
          x: {
            grid: { display: false },
            border: { color: colours.fg2 },
            ticks: { color: colours.fg3, font: { family: colours.mono, size: 10 } },
            title: { display: true, text: "model", align: "end", color: colours.fg3, font: { family: colours.mono, size: 10 } }
          },
          y: {
            min: 0, max: 1,
            grid: { color: colours.rule },
            border: { color: colours.fg2 },
            ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } },
            title: { display: true, text: "likelihood", align: "end", color: colours.fg3, font: { family: colours.mono, size: 10 } }
          }
        }
      }
    });
  }

  const probabilityValues = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
  const binaryLossCanvas = document.getElementById("binaryCrossEntropyChart");
  if (binaryLossCanvas) {
    const positiveLoss = probabilityValues.map((y) => ({ x: y, y: -Math.log(y) }));
    const negativeLoss = probabilityValues.map((y) => ({ x: y, y: -Math.log(1 - y) }));
    new Chart(binaryLossCanvas, {
      type: "scatter",
      data: { datasets: [
        lineDataset("Target t = 1", positiveLoss, colours.class1),
        lineDataset("Target t = 0", negativeLoss, colours.class0)
      ] },
      options: sharedOptions("predicted probability y", "loss", 0.01, 0.99, 0, 5, {
        title: (items) => items.length ? items[0].dataset.label : "",
        label: (item) => `y = ${item.parsed.x.toFixed(2)}, loss = ${item.parsed.y.toFixed(3)}`
      })
    });
  }

  const scoreCanvas = document.getElementById("lossVsScoreChart");
  if (scoreCanvas) {
    const scores = Array.from({ length: 129 }, (_, i) => -8 + i / 8);
    const softplus = (value) => value > 0
      ? value + Math.log1p(Math.exp(-value))
      : Math.log1p(Math.exp(value));
    const target1 = scores.map((a) => ({ x: a, y: softplus(-a) }));
    const target0 = scores.map((a) => ({ x: a, y: softplus(a) }));
    new Chart(scoreCanvas, {
      type: "scatter",
      data: { datasets: [
        lineDataset("Target t = 1", target1, colours.class1),
        lineDataset("Target t = 0", target0, colours.class0)
      ] },
      options: sharedOptions("linear score a", "loss", -8, 8, 0, 8, {
        title: (items) => items.length ? items[0].dataset.label : "",
        label: (item) => `a = ${item.parsed.x.toFixed(2)}, loss = ${item.parsed.y.toFixed(3)}`
      })
    });
  }

  const trainingCanvas = document.getElementById("trainingLossChart");
  if (trainingCanvas) {
    const epochs = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const losses = [0.693, 0.52, 0.41, 0.33, 0.27, 0.23, 0.20, 0.18, 0.165, 0.15, 0.14];
    const data = epochs.map((epoch, i) => ({ x: epoch, y: losses[i] }));
    new Chart(trainingCanvas, {
      type: "scatter",
      data: { datasets: [lineDataset("Illustrative BCE", data, colours.success)] },
      options: sharedOptions("epoch", "binary cross-entropy", 0, 100, 0, 0.75, {
        title: (items) => items.length ? items[0].dataset.label : "",
        label: (item) => `epoch ${item.parsed.x}, loss = ${item.parsed.y.toFixed(3)}`
      })
    });
  }
});
