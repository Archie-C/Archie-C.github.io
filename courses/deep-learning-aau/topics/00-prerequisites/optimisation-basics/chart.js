window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("optChart");
  if (!canvas) {
    return;
  }

  // Sliders
  const sliderAlpha = document.getElementById("sliderAlpha");
  const sliderGamma = document.getElementById("sliderGamma");
  const sliderStartX = document.getElementById("sliderStartX");
  const sliderStartY = document.getElementById("sliderStartY");

  // Value displays
  const valAlpha = document.getElementById("valAlpha");
  const valGamma = document.getElementById("valGamma");
  const valStartX = document.getElementById("valStartX");
  const valStartY = document.getElementById("valStartY");

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const primaryColor = token("--c-cat-2") || "#2C4A7A"; // Ink Blue
  const accentColor = token("--c-cat-1") || "#6B2C5C";  // Trajectory (Aubergine)
  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  // Contour levels (c values)
  const contourLevels = [0.5, 1.5, 3.5, 6.0, 8.0];

  // Function to compute contour ellipse points:
  // x^2 + gamma * y^2 = 2 * c  =>  x = sqrt(2c)*cos(theta), y = sqrt(2c/gamma)*sin(theta)
  const getContourPoints = (gamma, c) => {
    const points = [];
    const steps = 80;
    const rx = Math.sqrt(2 * c);
    const ry = Math.sqrt(2 * c / gamma);
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      points.push({
        x: rx * Math.cos(theta),
        y: ry * Math.sin(theta)
      });
    }
    return points;
  };

  // Function to compute gradient descent trajectory points:
  // x1(t+1) = (1 - alpha) * x1(t)
  // x2(t+1) = (1 - alpha * gamma) * x2(t)
  const getTrajectoryPoints = (startX, startY, alpha, gamma) => {
    const points = [];
    let x1 = startX;
    let x2 = startY;
    points.push({ x: x1, y: x2 });

    for (let step = 0; step < 15; step++) {
      x1 = x1 - alpha * x1;
      x2 = x2 - alpha * gamma * x2;

      // Break if values diverge to prevent plot breaks
      if (isNaN(x1) || isNaN(x2) || Math.abs(x1) > 20 || Math.abs(x2) > 20) {
        break;
      }
      points.push({ x: x1, y: x2 });
    }
    return points;
  };

  // Get initial values
  let alpha = sliderAlpha ? parseFloat(sliderAlpha.value) : 0.2;
  let gamma = sliderGamma ? parseFloat(sliderGamma.value) : 2.0;
  let startX = sliderStartX ? parseFloat(sliderStartX.value) : 3.0;
  let startY = sliderStartY ? parseFloat(sliderStartY.value) : 3.0;

  const contourDatasets = contourLevels.map(c => ({
    label: `contour-${c}`,
    data: getContourPoints(gamma, c),
    type: "line",
    borderColor: rule,
    borderWidth: 1.2,
    pointRadius: 0,
    pointHoverRadius: 0,
    tension: 0,
    fill: false
  }));

  const trajectoryDataset = {
    label: "trajectory",
    data: getTrajectoryPoints(startX, startY, alpha, gamma),
    type: "line",
    borderColor: accentColor,
    borderWidth: 2,
    pointRadius: 3.5,
    pointHoverRadius: 5.5,
    pointBackgroundColor: accentColor,
    pointBorderColor: bg,
    pointBorderWidth: 1,
    tension: 0,
    fill: false
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
        return `(${item.parsed.x.toFixed(3)}, ${item.parsed.y.toFixed(3)})`;
      },
      label: (item) => {
        if (item.datasetIndex === 5) {
          const step = item.dataIndex;
          const x = item.parsed.x;
          const y = item.parsed.y;
          const fVal = 0.5 * (x * x + gamma * y * y);
          return `Step ${step}: f(x) = ${fVal.toFixed(4)}`;
        }
        return "Contour line";
      }
    }
  };

  const chart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [...contourDatasets, trajectoryDataset]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      animation: { duration: 0 }, // Instant updates on slide
      layout: { padding: { top: 10, right: 10, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: sharedTooltip
      },
      scales: {
        x: {
          type: "linear",
          min: -4,
          max: 4,
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
          min: -4,
          max: 4,
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
    alpha = sliderAlpha ? parseFloat(sliderAlpha.value) : 0.2;
    gamma = sliderGamma ? parseFloat(sliderGamma.value) : 2.0;
    startX = sliderStartX ? parseFloat(sliderStartX.value) : 3.0;
    startY = sliderStartY ? parseFloat(sliderStartY.value) : 3.0;

    if (valAlpha) valAlpha.textContent = alpha.toFixed(2);
    if (valGamma) valGamma.textContent = gamma.toFixed(1);
    if (valStartX) valStartX.textContent = startX.toFixed(1);
    if (valStartY) valStartY.textContent = startY.toFixed(1);

    // Update contour datasets (indices 0 to 4)
    contourLevels.forEach((c, idx) => {
      chart.data.datasets[idx].data = getContourPoints(gamma, c);
    });

    // Update trajectory dataset (index 5)
    chart.data.datasets[5].data = getTrajectoryPoints(startX, startY, alpha, gamma);

    chart.update();
  };

  if (sliderAlpha) sliderAlpha.addEventListener("input", updateChart);
  if (sliderGamma) sliderGamma.addEventListener("input", updateChart);
  if (sliderStartX) sliderStartX.addEventListener("input", updateChart);
  if (sliderStartY) sliderStartY.addEventListener("input", updateChart);
});
