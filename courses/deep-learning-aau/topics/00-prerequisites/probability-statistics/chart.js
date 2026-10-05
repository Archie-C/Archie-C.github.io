window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("gaussianChart");
  if (!canvas) {
    return;
  }

  // Sliders
  const sliderMuX = document.getElementById("sliderMuX");
  const sliderMuY = document.getElementById("sliderMuY");
  const sliderSigmaX = document.getElementById("sliderSigmaX");
  const sliderSigmaY = document.getElementById("sliderSigmaY");
  const sliderRho = document.getElementById("sliderRho");

  // Value displays
  const valMuX = document.getElementById("valMuX");
  const valMuY = document.getElementById("valMuY");
  const valSigmaX = document.getElementById("valSigmaX");
  const valSigmaY = document.getElementById("valSigmaY");
  const valRho = document.getElementById("valRho");

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const primaryColor = token("--c-cat-2") || "#2C4A7A"; // Ellipse (Ink Blue)
  const accentColor = token("--c-cat-1") || "#6B2C5C";  // Samples (Aubergine)
  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  // Generate 500 standard normal samples Z ~ N(0, I) once to prevent flickering
  const numSamples = 500;
  const standardNormalSamples = [];

  const boxMuller = () => {
    let u1 = Math.random();
    let u2 = Math.random();
    while (u1 === 0.0) u1 = Math.random(); // Avoid log(0)
    const r = Math.sqrt(-2.0 * Math.log(u1));
    const theta = 2.0 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  };

  for (let i = 0; i < numSamples / 2; i++) {
    const [z1, z2] = boxMuller();
    standardNormalSamples.push({ z1, z2 });
  }

  // Linear transformation via Cholesky factor L:
  // x = mu_x + sigma_x * z1
  // y = mu_y + rho * sigma_y * z1 + sigma_y * sqrt(1 - rho^2) * z2
  const getTransformedSamples = (muX, muY, sigmaX, sigmaY, rho) => {
    const factorY = sigmaY * Math.sqrt(1 - rho * rho);
    return standardNormalSamples.map(s => {
      const x = muX + sigmaX * s.z1;
      const y = muY + rho * sigmaY * s.z1 + factorY * s.z2;
      return { x, y };
    });
  };

  // Ellipse generation by mapping unit circle through L:
  // x_ellipse = mu_x + k * sigma_x * cos(theta)
  // y_ellipse = mu_y + k * (rho * sigma_y * cos(theta) + sigma_y * sqrt(1 - rho^2) * sin(theta))
  const getEllipsePoints = (muX, muY, sigmaX, sigmaY, rho, k) => {
    const points = [];
    const steps = 80;
    const factorY = sigmaY * Math.sqrt(1 - rho * rho);
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * 2 * Math.PI;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x = muX + k * sigmaX * cosT;
      const y = muY + k * (rho * sigmaY * cosT + factorY * sinT);
      points.push({ x, y });
    }
    return points;
  };

  // Get initial values
  let muX = sliderMuX ? parseFloat(sliderMuX.value) : 0.0;
  let muY = sliderMuY ? parseFloat(sliderMuY.value) : 0.0;
  let sigmaX = sliderSigmaX ? parseFloat(sliderSigmaX.value) : 1.0;
  let sigmaY = sliderSigmaY ? parseFloat(sliderSigmaY.value) : 1.0;
  let rho = sliderRho ? parseFloat(sliderRho.value) : 0.0;

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
          return "Sample point";
        } else if (item.datasetIndex === 1) {
          return "1-standard deviation contour (1σ)";
        } else if (item.datasetIndex === 2) {
          return "2-standard deviation contour (2σ)";
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
          label: "samples",
          data: getTransformedSamples(muX, muY, sigmaX, sigmaY, rho),
          pointRadius: 2.5,
          pointHoverRadius: 4,
          backgroundColor: accentColor,
          borderColor: bg,
          borderWidth: 0.5
        },
        {
          label: "1-sigma",
          data: getEllipsePoints(muX, muY, sigmaX, sigmaY, rho, 1.0),
          type: "line",
          borderColor: primaryColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          fill: false
        },
        {
          label: "2-sigma",
          data: getEllipsePoints(muX, muY, sigmaX, sigmaY, rho, 2.0),
          type: "line",
          borderColor: primaryColor,
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      animation: { duration: 0 }, // Instant updates on drag
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
    muX = sliderMuX ? parseFloat(sliderMuX.value) : 0.0;
    muY = sliderMuY ? parseFloat(sliderMuY.value) : 0.0;
    sigmaX = sliderSigmaX ? parseFloat(sliderSigmaX.value) : 1.0;
    sigmaY = sliderSigmaY ? parseFloat(sliderSigmaY.value) : 1.0;
    rho = sliderRho ? parseFloat(sliderRho.value) : 0.0;

    if (valMuX) valMuX.textContent = muX.toFixed(1);
    if (valMuY) valMuY.textContent = muY.toFixed(1);
    if (valSigmaX) valSigmaX.textContent = sigmaX.toFixed(1);
    if (valSigmaY) valSigmaY.textContent = sigmaY.toFixed(1);
    if (valRho) valRho.textContent = rho.toFixed(2);

    // Update datasets
    chart.data.datasets[0].data = getTransformedSamples(muX, muY, sigmaX, sigmaY, rho);
    chart.data.datasets[1].data = getEllipsePoints(muX, muY, sigmaX, sigmaY, rho, 1.0);
    chart.data.datasets[2].data = getEllipsePoints(muX, muY, sigmaX, sigmaY, rho, 2.0);

    chart.update();
  };

  if (sliderMuX) sliderMuX.addEventListener("input", updateChart);
  if (sliderMuY) sliderMuY.addEventListener("input", updateChart);
  if (sliderSigmaX) sliderSigmaX.addEventListener("input", updateChart);
  if (sliderSigmaY) sliderSigmaY.addEventListener("input", updateChart);
  if (sliderRho) sliderRho.addEventListener("input", updateChart);
});
