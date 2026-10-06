window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") return;

  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const colour = {
    fg: token("--fg", "#252525"),
    fg2: token("--fg-2", "#666666"),
    fg3: token("--fg-3", "#888888"),
    bg: token("--bg", "#ffffff"),
    rule: token("--rule", "#dddddd"),
    class0: token("--c-cat-2", "#2C4A7A"),
    class1: token("--c-cat-1", "#6B2C5C"),
    boundary: token("--c-cat-3", "#8B6F47"),
    mono: token("--font-mono", "monospace")
  };

  Chart.defaults.font.family = colour.mono;
  Chart.defaults.color = colour.fg2;

  const makeOptions = (xTitle, yTitle, xMin, xMax, yMin, yMax, tooltip) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colour.bg,
        borderColor: colour.rule,
        borderWidth: 1,
        titleColor: colour.fg,
        bodyColor: colour.fg2,
        displayColors: false,
        padding: 10,
        callbacks: tooltip
      }
    },
    scales: {
      x: {
        type: "linear", min: xMin, max: xMax,
        grid: { display: false }, border: { color: colour.fg2 },
        ticks: { color: colour.fg3, font: { family: colour.mono, size: 11 } },
        title: { display: true, text: xTitle, align: "end", color: colour.fg3, font: { family: colour.mono, size: 10 } }
      },
      y: {
        min: yMin, max: yMax,
        grid: { color: colour.rule }, border: { color: colour.fg2 },
        ticks: { color: colour.fg3, font: { family: colour.mono, size: 11 } },
        title: { display: Boolean(yTitle), text: yTitle, align: "end", color: colour.fg3, font: { family: colour.mono, size: 10 } }
      }
    }
  });

  const pointDataset = (label, data, fill) => ({
    label,
    data,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBackgroundColor: fill,
    pointBorderColor: fill,
    pointBorderWidth: 0
  });
  const lineDataset = (label, data) => ({
    label,
    data,
    showLine: true,
    borderColor: colour.boundary,
    borderWidth: 1.8,
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0
  });
  const tooltip = {
    title: (items) => items.length ? items[0].dataset.label : "",
    label: (item) => `x₁ = ${item.parsed.x.toFixed(2)}, x₂ = ${item.parsed.y.toFixed(2)}`
  };

  // Fixed radii and angles keep all three views of this dataset identical.
  const innerPolar = [
    [0.16, 0.20], [0.28, 0.75], [0.36, 1.48], [0.24, 2.31],
    [0.42, 2.92], [0.31, 3.64], [0.39, 4.38], [0.22, 5.12], [0.45, 5.72]
  ];
  const outerPolar = [
    [1.38, 0.12], [1.52, 0.59], [1.43, 1.04], [1.62, 1.51],
    [1.48, 1.98], [1.57, 2.43], [1.40, 2.90], [1.61, 3.34],
    [1.46, 3.82], [1.55, 4.27], [1.42, 4.72], [1.59, 5.19], [1.47, 5.68]
  ];
  const fromPolar = (points) => points.map(([r, theta]) => ({
    x: Number((r * Math.cos(theta)).toFixed(3)),
    y: Number((r * Math.sin(theta)).toFixed(3))
  }));
  const class0 = fromPolar(innerPolar);
  const class1 = fromPolar(outerPolar);
  const sharedPoints = [
    pointDataset("Class 0", class0, colour.class0),
    pointDataset("Class 1", class1, colour.class1)
  ];

  const nonlinearCanvas = document.getElementById("nonlinearDataChart");
  if (nonlinearCanvas) {
    new Chart(nonlinearCanvas, {
      type: "scatter",
      data: { datasets: sharedPoints },
      options: makeOptions("x₁", "x₂", -1.9, 1.9, -1.9, 1.9, tooltip)
    });
  }

  const circleCanvas = document.getElementById("circularBoundaryChart");
  if (circleCanvas) {
    const radius = 0.9;
    const circle = Array.from({ length: 121 }, (_, i) => {
      const theta = (2 * Math.PI * i) / 120;
      return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
    });
    new Chart(circleCanvas, {
      type: "scatter",
      data: { datasets: [...sharedPoints, lineDataset("Decision boundary", circle)] },
      options: makeOptions("x₁", "x₂", -1.9, 1.9, -1.9, 1.9, tooltip)
    });
  }

  const featureCanvas = document.getElementById("featureSpaceChart");
  if (featureCanvas) {
    const toFeaturePoint = (point, index, classOffset) => ({
      x: point.x ** 2 + point.y ** 2,
      y: classOffset + ((index % 5) - 2) * 0.055
    });
    const threshold = 0.9 ** 2;
    const feature0 = class0.map((point, index) => toFeaturePoint(point, index, -0.12));
    const feature1 = class1.map((point, index) => toFeaturePoint(point, index, 0.12));
    const thresholdLine = [{ x: threshold, y: -0.5 }, { x: threshold, y: 0.5 }];
    new Chart(featureCanvas, {
      type: "scatter",
      data: { datasets: [
        pointDataset("Class 0", feature0, colour.class0),
        pointDataset("Class 1", feature1, colour.class1),
        lineDataset("Threshold", thresholdLine)
      ] },
      options: {
        ...makeOptions("z = x₁² + x₂²", "", 0, 3.3, -0.48, 0.48, {
          title: (items) => items.length ? items[0].dataset.label : "",
          label: (item) => `z = ${item.parsed.x.toFixed(2)}`
        }),
        scales: {
          x: {
            type: "linear", min: 0, max: 3.3,
            grid: { display: false }, border: { color: colour.fg2 },
            ticks: { color: colour.fg3, font: { family: colour.mono, size: 11 } },
            title: { display: true, text: "z = x₁² + x₂²", align: "end", color: colour.fg3, font: { family: colour.mono, size: 10 } }
          },
          y: {
            min: -0.48, max: 0.48,
            grid: { display: false }, border: { display: false },
            ticks: { display: false }, title: { display: false }
          }
        }
      }
    });
  }

  const polynomialCanvas = document.getElementById("polynomialBoundaryChart");
  if (polynomialCanvas) {
    const boundaryY = (x) => 0.22 * x * x - 0.38;
    const belowBoundary = [
      [-1.65, -0.65], [-1.28, -0.92], [-0.88, -0.60], [-0.42, -0.91],
      [0.02, -0.70], [0.48, -1.02], [0.92, -0.67], [1.38, -0.96], [1.72, -0.66]
    ].map(([x, y]) => ({ x, y }));
    const aboveBoundary = [
      [-1.62, 0.42], [-1.25, 0.18], [-0.86, 0.54], [-0.41, 0.23],
      [0.04, 0.55], [0.48, 0.29], [0.92, 0.62], [1.34, 0.31], [1.70, 0.57]
    ].map(([x, y]) => ({ x, y }));
    const curve = Array.from({ length: 101 }, (_, i) => {
      const x = -2 + (4 * i) / 100;
      return { x, y: boundaryY(x) };
    });
    new Chart(polynomialCanvas, {
      type: "scatter",
      data: { datasets: [
        pointDataset("Class 0", belowBoundary, colour.class0),
        pointDataset("Class 1", aboveBoundary, colour.class1),
        lineDataset("Quadratic decision boundary", curve)
      ] },
      options: makeOptions("x₁", "x₂", -2, 2, -1.4, 1.3, tooltip)
    });
  }
});
