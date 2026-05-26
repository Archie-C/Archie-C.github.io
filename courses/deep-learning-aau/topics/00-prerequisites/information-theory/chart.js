window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("infoChart");
  if (!canvas) {
    return;
  }

  // Sliders
  const sliderP = document.getElementById("sliderP");
  const sliderQ = document.getElementById("sliderQ");

  // Value displays
  const valP = document.getElementById("valP");
  const valQ = document.getElementById("valQ");

  // Numeric text outputs
  const textHP = document.getElementById("textHP");
  const textHPQ = document.getElementById("textHPQ");
  const textDKL = document.getElementById("textDKL");

  // Style helper
  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const accentColor = token("--accent") || "#6B2C5C";
  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  // Safe base-2 logarithm
  const log2 = (x) => (x > 0 ? Math.log2(x) : 0);

  // Generate 100 points for the entropy curve H(x)
  const getEntropyCurve = () => {
    const points = [];
    for (let i = 1; i <= 99; i++) {
      const x = i / 100;
      const h = -x * log2(x) - (1 - x) * log2(1 - x);
      points.push({ x, y: h });
    }
    return points;
  };

  // Generate the cross-entropy tangent line H(x, q) for a fixed q
  const getCrossEntropyLine = (q) => {
    const points = [];
    for (let i = 1; i <= 99; i += 2) {
      const x = i / 100;
      const ce = -x * log2(q) - (1 - x) * log2(1 - q);
      points.push({ x, y: ce });
    }
    return points;
  };

  let p = sliderP ? parseFloat(sliderP.value) : 0.70;
  let q = sliderQ ? parseFloat(sliderQ.value) : 0.30;

  const entropyCurvePoints = getEntropyCurve();

  // Helper to calculate specific values
  const computeValues = (pVal, qVal) => {
    const hp = -pVal * log2(pVal) - (1 - pVal) * log2(1 - pVal);
    const hpq = -pVal * log2(qVal) - (1 - pVal) * log2(1 - qVal);
    const dkl = hpq - hp;
    return { hp, hpq, dkl };
  };

  let vals = computeValues(p, q);

  const entropyCurveDataset = {
    label: "Entropy H(P)",
    data: entropyCurvePoints,
    type: "line",
    borderColor: accentColor,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    tension: 0.1
  };

  const crossEntropyDataset = {
    label: "Cross-Entropy H(P, Q)",
    data: getCrossEntropyLine(q),
    type: "line",
    borderColor: fg3,
    borderWidth: 1.5,
    borderDash: [5, 5],
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    tension: 0
  };

  const dklLineDataset = {
    label: "KL Divergence",
    data: [
      { x: p, y: vals.hp },
      { x: p, y: vals.hpq }
    ],
    type: "line",
    borderColor: accentColor,
    borderWidth: 2,
    borderDash: [2, 2],
    pointRadius: 0,
    fill: false,
    tension: 0
  };

  const pPointDataset = {
    label: "H(P) Point",
    data: [{ x: p, y: vals.hp }],
    type: "scatter",
    backgroundColor: accentColor,
    borderColor: bg,
    borderWidth: 1.5,
    pointRadius: 6,
    pointHoverRadius: 8
  };

  const pqPointDataset = {
    label: "H(P, Q) Point",
    data: [{ x: p, y: vals.hpq }],
    type: "scatter",
    backgroundColor: bg,
    borderColor: accentColor,
    borderWidth: 2.5,
    pointRadius: 6,
    pointHoverRadius: 8
  };

  const chart = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        entropyCurveDataset,
        crossEntropyDataset,
        dklLineDataset,
        pPointDataset,
        pqPointDataset
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.6, // Slightly wider for layout balance
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: bg,
          borderColor: rule,
          borderWidth: 1,
          titleColor: fg,
          bodyColor: fg2,
          displayColors: false,
          padding: 8,
          titleFont: { family: mono, size: 11, weight: "600" },
          bodyFont: { family: mono, size: 11 },
          callbacks: {
            title: (items) => {
              const x = items[0].parsed.x;
              return `p = ${x.toFixed(2)}`;
            },
            label: (item) => {
              const y = item.parsed.y;
              if (item.datasetIndex === 0) return `Entropy: ${y.toFixed(3)} bits`;
              if (item.datasetIndex === 1) return `Cross-Entropy: ${y.toFixed(3)} bits`;
              if (item.datasetIndex === 3) return `True Entropy: ${y.toFixed(3)} bits`;
              if (item.datasetIndex === 4) return `Cross-Entropy: ${y.toFixed(3)} bits`;
              return "";
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1.0,
          grid: { color: rule, tickColor: fg3 },
          border: { color: fg2, width: 1 },
          ticks: {
            stepSize: 0.1,
            color: fg3,
            font: { family: mono, size: 10 }
          },
          title: {
            display: true,
            text: "Probability p",
            align: "end",
            color: fg3,
            font: { family: mono, size: 10, weight: "500" }
          }
        },
        y: {
          type: "linear",
          min: 0,
          max: 3.0,
          grid: { color: rule, tickColor: fg3 },
          border: { color: fg2, width: 1 },
          ticks: {
            stepSize: 0.5,
            color: fg3,
            font: { family: mono, size: 10 }
          },
          title: {
            display: true,
            text: "Information (bits)",
            align: "end",
            color: fg3,
            font: { family: mono, size: 10, weight: "500" }
          }
        }
      }
    }
  });

  const updateChart = () => {
    p = sliderP ? parseFloat(sliderP.value) : 0.70;
    q = sliderQ ? parseFloat(sliderQ.value) : 0.30;

    if (valP) valP.textContent = p.toFixed(2);
    if (valQ) valQ.textContent = q.toFixed(2);

    vals = computeValues(p, q);

    if (textHP) textHP.textContent = `${vals.hp.toFixed(3)} bits`;
    if (textHPQ) textHPQ.textContent = `${vals.hpq.toFixed(3)} bits`;
    if (textDKL) textDKL.textContent = `${vals.dkl.toFixed(3)} bits`;

    // Update cross-entropy tangent line (dataset index 1)
    chart.data.datasets[1].data = getCrossEntropyLine(q);

    // Update DKL vertical dashed line (dataset index 2)
    chart.data.datasets[2].data = [
      { x: p, y: vals.hp },
      { x: p, y: vals.hpq }
    ];

    // Update point markers (dataset indices 3 and 4)
    chart.data.datasets[3].data = [{ x: p, y: vals.hp }];
    chart.data.datasets[4].data = [{ x: p, y: vals.hpq }];

    chart.update();
  };

  if (sliderP) sliderP.addEventListener("input", updateChart);
  if (sliderQ) sliderQ.addEventListener("input", updateChart);

  // Initial trigger
  updateChart();
});
