window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("derivativeChart");
  if (!canvas) {
    return;
  }

  const slider = document.getElementById("tangentSlider");
  const valueDisplay = document.getElementById("tangentValue");

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const primaryColor = token("--c-cat-2") || "#2C4A7A";
  const accentColor = token("--c-cat-1") || "#6B2C5C";
  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  // Function f(x) = x^2 - 4x + 5
  const f = (x) => x * x - 4 * x + 5;
  // Derivative f'(x) = 2x - 4
  const df = (x) => 2 * x - 4;

  // Generate curve data
  const curvePoints = [];
  for (let x = 0; x <= 4.05; x += 0.1) {
    curvePoints.push({ x: parseFloat(x.toFixed(2)), y: parseFloat(f(x).toFixed(4)) });
  }

  // Calculate two points on the tangent line to draw it across the whole domain [0, 4]
  const getTangentPoints = (x0) => {
    const y0 = f(x0);
    const slope = df(x0);
    return [
      { x: 0, y: slope * (0 - x0) + y0 },
      { x: 4, y: slope * (4 - x0) + y0 }
    ];
  };

  let x0 = slider ? parseFloat(slider.value) : 3.0;

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
      title: (items) => `x = ${items[0].parsed.x.toFixed(2)}`,
      label: (item) => {
        if (item.datasetIndex === 0) {
          return `f(x) = ${item.parsed.y.toFixed(2)}`;
        } else if (item.datasetIndex === 1) {
          return `tangent y = ${item.parsed.y.toFixed(2)}`;
        } else {
          const slope = df(x0);
          return `tangent point (slope = ${slope.toFixed(2)})`;
        }
      }
    }
  };

  const chart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "f(x) = x^2 - 4x + 5",
          data: curvePoints,
          type: "line",
          borderColor: primaryColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.1
        },
        {
          label: "tangent line",
          data: getTangentPoints(x0),
          type: "line",
          borderColor: accentColor,
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0
        },
        {
          label: "point of tangency",
          data: [{ x: x0, y: f(x0) }],
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: accentColor,
          pointBorderColor: bg,
          pointBorderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 }, // Instant update on slider move
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: { legend: { display: false }, tooltip: sharedTooltip },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 4,
          grid: { display: false, color: rule, tickColor: fg3 },
          border: { color: fg2, width: 1 },
          ticks: { stepSize: 1, color: fg3, font: { family: mono, size: 11 } },
          title: {
            display: true, text: "x", align: "end", color: fg3,
            font: { family: mono, size: 10, weight: "500" },
            padding: { top: 6 }
          }
        },
        y: {
          min: 0,
          max: 6,
          grid: { color: rule, drawTicks: true, tickColor: fg3, lineWidth: 1 },
          border: { color: fg2, width: 1 },
          ticks: { stepSize: 1, color: fg3, font: { family: mono, size: 11 } },
          title: {
            display: true, text: "f(x)", align: "end", color: fg3,
            font: { family: mono, size: 10, weight: "500" },
            padding: { bottom: 6 }
          }
        }
      }
    }
  });

  if (slider && valueDisplay) {
    slider.addEventListener("input", (e) => {
      x0 = parseFloat(e.target.value);
      valueDisplay.textContent = x0.toFixed(1);

      // Update datasets
      chart.data.datasets[1].data = getTangentPoints(x0);
      chart.data.datasets[2].data = [{ x: x0, y: f(x0) }];
      chart.update();
    });
  }
});
