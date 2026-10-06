window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") return;

  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const colours = {
    fg: token("--fg", "#252525"),
    fg2: token("--fg-2", "#666666"),
    fg3: token("--fg-3", "#888888"),
    bg: token("--bg", "#ffffff"),
    rule: token("--rule", "#dddddd"),
    class1: token("--c-cat-5", "#8B3A2C"),
    class2: token("--c-cat-2", "#2C4A7A"),
    class3: token("--c-cat-4", "#A67012"),
    boundary: token("--c-cat-1", "#6B2C5C"),
    mono: token("--font-mono", "monospace")
  };

  Chart.defaults.font.family = colours.mono;
  Chart.defaults.color = colours.fg2;

  const sharedTooltip = {
    backgroundColor: colours.bg,
    borderColor: colours.rule,
    borderWidth: 1,
    titleColor: colours.fg,
    bodyColor: colours.fg2,
    displayColors: false,
    padding: 10,
    titleFont: { family: colours.mono, size: 12, weight: "600" },
    bodyFont: { family: colours.mono, size: 12 }
  };

  const sharedOptions = (xTitle, yTitle, xMin, xMax, yMin, yMax, extraScales = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
    plugins: { legend: { display: false }, tooltip: sharedTooltip },
    scales: {
      x: {
        type: "linear", min: xMin, max: xMax,
        grid: { display: false, color: colours.rule },
        border: { color: colours.fg2, width: 1 },
        ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } },
        title: { display: true, text: xTitle, align: "end", color: colours.fg3, font: { family: colours.mono, size: 10, weight: "500" }, padding: { top: 6 } }
      },
      y: {
        min: yMin, max: yMax,
        grid: { color: colours.rule, drawTicks: true, tickColor: colours.fg3, lineWidth: 1 },
        border: { color: colours.fg2, width: 1 },
        ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } },
        title: { display: true, text: yTitle, align: "end", color: colours.fg3, font: { family: colours.mono, size: 10, weight: "500" }, padding: { bottom: 6 } }
      },
      ...extraScales
    }
  });

  const flowers = [
    {
      label: "Class 1 · red flowers",
      colour: colours.class1,
      data: [
        { x: -2.8, y: -0.6 }, { x: -2.4, y: 0.4 }, { x: -2.1, y: -0.3 },
        { x: -1.8, y: 0.7 }, { x: -1.6, y: -0.8 }, { x: -2.7, y: 0.9 },
        { x: -1.4, y: 0.1 }, { x: -2.2, y: -1.0 }
      ]
    },
    {
      label: "Class 2 · blue flowers",
      colour: colours.class2,
      data: [
        { x: 1.5, y: -0.7 }, { x: 1.9, y: 0.3 }, { x: 2.2, y: -0.4 },
        { x: 2.7, y: 0.6 }, { x: 2.9, y: -0.8 }, { x: 1.6, y: 0.8 },
        { x: 2.4, y: 0.1 }, { x: 3.1, y: 0.2 }
      ]
    },
    {
      label: "Class 3 · yellow flowers",
      colour: colours.class3,
      data: [
        { x: -0.7, y: 2.0 }, { x: -0.3, y: 2.6 }, { x: 0.2, y: 2.2 },
        { x: 0.6, y: 2.9 }, { x: -0.5, y: 3.4 }, { x: 0.5, y: 3.6 },
        { x: 1.0, y: 2.4 }, { x: -1.0, y: 2.8 }
      ]
    }
  ];

  const pointDatasets = () => flowers.map((group) => ({
    label: group.label,
    data: group.data,
    pointRadius: 3.6,
    pointHoverRadius: 5,
    pointBackgroundColor: group.colour,
    pointBorderColor: group.colour,
    pointBorderWidth: 0
  }));

  const flowerTooltip = {
    ...sharedTooltip,
    callbacks: {
      title: (items) => items[0].dataset.label,
      label: (item) => `x₁ ${item.parsed.x.toFixed(1)}, x₂ ${item.parsed.y.toFixed(1)}`
    }
  };

  const dataCanvas = document.getElementById("multiclassDataChart");
  if (dataCanvas) {
    new Chart(dataCanvas, {
      type: "scatter",
      data: { datasets: pointDatasets() },
      options: {
        ...sharedOptions("x₁", "x₂", -3.5, 3.5, -1.5, 4.0),
        plugins: { legend: { display: false }, tooltip: flowerTooltip }
      }
    });
  }

  const softmaxCanvas = document.getElementById("softmaxExampleChart");
  if (softmaxCanvas) {
    const scores = [1.2, 3.1, -0.4];
    const probabilities = [0.126778, 0.847626, 0.025596];
    new Chart(softmaxCanvas, {
      type: "bar",
      data: {
        labels: ["Class 1", "Class 2", "Class 3"],
        datasets: [{
          label: "Softmax probability",
          data: probabilities,
          backgroundColor: [colours.class1, colours.class2, colours.class3],
          borderWidth: 0,
          barPercentage: 0.62,
          categoryPercentage: 0.72
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `score ${scores[item.dataIndex].toFixed(1)} · probability ${probabilities[item.dataIndex].toFixed(3)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }, border: { color: colours.fg2 },
            ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 } }
          },
          y: {
            min: 0, max: 1,
            grid: { color: colours.rule, drawTicks: true, tickColor: colours.fg3 },
            border: { color: colours.fg2 },
            ticks: { stepSize: 0.2, color: colours.fg3, font: { family: colours.mono, size: 11 } },
            title: { display: true, text: "probability", align: "end", color: colours.fg3, font: { family: colours.mono, size: 10, weight: "500" }, padding: { bottom: 6 } }
          }
        }
      }
    });
  }

  const boundaryCanvas = document.getElementById("multiclassBoundaryChart");
  if (boundaryCanvas) {
    const line = (label, data) => ({
      type: "line", label, data,
      borderColor: colours.boundary,
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      fill: false
    });
    new Chart(boundaryCanvas, {
      type: "scatter",
      data: {
        datasets: [
          ...pointDatasets(),
          line("Class 1 = Class 2", [{ x: 0, y: -1.5 }, { x: 0, y: 4.0 }]),
          line("Class 1 = Class 3", [{ x: -3.5, y: 2.8125 }, { x: 3.5, y: -1.5625 }]),
          line("Class 2 = Class 3", [{ x: -3.5, y: -1.5625 }, { x: 3.5, y: 2.8125 }])
        ]
      },
      options: {
        ...sharedOptions("x₁", "x₂", -3.5, 3.5, -1.5, 4.0),
        plugins: { legend: { display: false }, tooltip: flowerTooltip }
      }
    });
  }

  const lossCanvas = document.getElementById("multiclassLossChart");
  if (lossCanvas) {
    const loss = [];
    for (let step = 1; step <= 100; step += 1) {
      const probability = step / 100;
      loss.push({ x: probability, y: -Math.log(probability) });
    }
    new Chart(lossCanvas, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Cross-entropy loss",
          data: loss,
          showLine: true,
          borderColor: colours.class1,
          borderWidth: 1.8,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0
        }]
      },
      options: {
        ...sharedOptions("probability assigned to correct class", "cross-entropy loss", 0, 1, 0, 5),
        scales: {
          ...sharedOptions("probability assigned to correct class", "cross-entropy loss", 0, 1, 0, 5).scales,
          x: {
            ...sharedOptions("probability assigned to correct class", "cross-entropy loss", 0, 1, 0, 5).scales.x,
            min: 0.01,
            ticks: { color: colours.fg3, font: { family: colours.mono, size: 11 }, callback: (value) => Number(value).toFixed(1) }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: {
              title: (items) => `probability ${items[0].parsed.x.toFixed(2)}`,
              label: (item) => `loss ${item.parsed.y.toFixed(2)}`
            }
          }
        }
      }
    });
  }
});
