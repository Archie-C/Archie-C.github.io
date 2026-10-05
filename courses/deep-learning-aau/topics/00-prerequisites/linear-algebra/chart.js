window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("matrixChart");
  if (!canvas) {
    return;
  }

  // Sliders
  const sliderA = document.getElementById("sliderA");
  const sliderB = document.getElementById("sliderB");
  const sliderC = document.getElementById("sliderC");
  const sliderD = document.getElementById("sliderD");

  // Value displays
  const valA = document.getElementById("valA");
  const valB = document.getElementById("valB");
  const valC = document.getElementById("valC");
  const valD = document.getElementById("valD");

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const primaryColor = token("--c-cat-2") || "#2C4A7A"; // Original shape (Ink Blue)
  const accentColor = token("--c-cat-1") || "#6B2C5C";  // Transformed shape (Aubergine)
  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  // Initial matrix A = [[a, b], [c, d]]
  let a = sliderA ? parseFloat(sliderA.value) : 1.0;
  let b = sliderB ? parseFloat(sliderB.value) : 0.5;
  let c = sliderC ? parseFloat(sliderC.value) : 0.0;
  let d = sliderD ? parseFloat(sliderD.value) : 1.0;

  // Compute original unit square vertices (closed loop)
  const originalSquare = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 0 }
  ];

  // Compute transformed vertices
  const getTransformedSquare = (a, b, c, d) => {
    return [
      { x: 0, y: 0 },
      { x: a, y: c },            // A * [1, 0]^T
      { x: a + b, y: c + d },    // A * [1, 1]^T
      { x: b, y: d },            // A * [0, 1]^T
      { x: 0, y: 0 }
    ];
  };

  const sharedTooltip = {
    backgroundColor: bg,
    borderColor: rule,
    borderWidth: 1,
    titleColor: fg,
    bodyColor: fg2,
    displayColors: false,
    padding: 10,
    titleFont: { family: mono, size: 12, weight: "600" },
    bodyFont: { family: mono, size: 12 },
    callbacks: {
      title: (items) => {
        const item = items[0];
        return `Point (${item.parsed.x.toFixed(2)}, ${item.parsed.y.toFixed(2)})`;
      },
      label: (item) => {
        if (item.datasetIndex === 0) {
          return "Original unit square boundary";
        } else if (item.datasetIndex === 1) {
          return "Transformed shape boundary";
        } else if (item.datasetIndex === 2) {
          if (item.dataIndex === 0) return "e₁ = [1, 0]ᵀ (original basis)";
          if (item.dataIndex === 1) return "e₂ = [0, 1]ᵀ (original basis)";
        } else if (item.datasetIndex === 3) {
          if (item.dataIndex === 0) return `A e₁ = [${a.toFixed(2)}, ${c.toFixed(2)}]ᵀ (first column)`;
          if (item.dataIndex === 1) return `A e₂ = [${b.toFixed(2)}, ${d.toFixed(2)}]ᵀ (second column)`;
        }
        return "";
      }
    }
  };

  const chart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "original square",
          data: originalSquare,
          type: "line",
          borderColor: primaryColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          fill: false
        },
        {
          label: "transformed shape",
          data: getTransformedSquare(a, b, c, d),
          type: "line",
          borderColor: accentColor,
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          fill: false
        },
        {
          label: "original basis",
          data: [
            { x: 1, y: 0 },
            { x: 0, y: 1 }
          ],
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: primaryColor,
          pointBorderColor: bg,
          pointBorderWidth: 1.5
        },
        {
          label: "transformed basis",
          data: [
            { x: a, y: c },
            { x: b, y: d }
          ],
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: accentColor,
          pointBorderColor: bg,
          pointBorderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      animation: { duration: 0 }, // Instant updates during slider dragging
      layout: { padding: { top: 10, right: 10, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: sharedTooltip
      },
      scales: {
        x: {
          type: "linear",
          min: -3,
          max: 3,
          grid: {
            color: rule,
            tickColor: fg3,
            lineWidth: (context) => (context.tick && context.tick.value === 0 ? 1.5 : 1)
          },
          border: { color: fg2, width: 1 },
          ticks: {
            stepSize: 1,
            color: fg3,
            font: { family: mono, size: 11 },
            callback: (val) => (val === 0 ? "" : val)
          },
          title: {
            display: true,
            text: "x₁",
            align: "end",
            color: fg3,
            font: { family: mono, size: 11, weight: "500" },
            padding: { top: 4 }
          }
        },
        y: {
          type: "linear",
          min: -3,
          max: 3,
          grid: {
            color: rule,
            tickColor: fg3,
            lineWidth: (context) => (context.tick && context.tick.value === 0 ? 1.5 : 1)
          },
          border: { color: fg2, width: 1 },
          ticks: {
            stepSize: 1,
            color: fg3,
            font: { family: mono, size: 11 },
            callback: (val) => (val === 0 ? "" : val)
          },
          title: {
            display: true,
            text: "x₂",
            align: "end",
            color: fg3,
            font: { family: mono, size: 11, weight: "500" },
            padding: { bottom: 4 }
          }
        }
      }
    }
  });

  const updateChart = () => {
    a = sliderA ? parseFloat(sliderA.value) : 1.0;
    b = sliderB ? parseFloat(sliderB.value) : 0.5;
    c = sliderC ? parseFloat(sliderC.value) : 0.0;
    d = sliderD ? parseFloat(sliderD.value) : 1.0;

    if (valA) valA.textContent = a.toFixed(1);
    if (valB) valB.textContent = b.toFixed(1);
    if (valC) valC.textContent = c.toFixed(1);
    if (valD) valD.textContent = d.toFixed(1);

    // Update transformed shape boundary
    chart.data.datasets[1].data = getTransformedSquare(a, b, c, d);
    // Update transformed basis vector endpoints
    chart.data.datasets[3].data = [
      { x: a, y: c },
      { x: b, y: d }
    ];

    chart.update();
  };

  if (sliderA) sliderA.addEventListener("input", updateChart);
  if (sliderB) sliderB.addEventListener("input", updateChart);
  if (sliderC) sliderC.addEventListener("input", updateChart);
  if (sliderD) sliderD.addEventListener("input", updateChart);
});
