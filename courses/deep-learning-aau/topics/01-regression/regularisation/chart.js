window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") return;

  const styles = getComputedStyle(document.documentElement);
  const token  = (name) => styles.getPropertyValue(name).trim();

  const fg    = token("--fg");
  const fg2   = token("--fg-2");
  const fg3   = token("--fg-3");
  const bg    = token("--bg");
  const rule  = token("--rule");
  const mono  = token("--font-mono") || "monospace";

  const colorPoint  = token("--c-cat-2") || "#2C4A7A";
  const colorLinear = token("--c-cat-1") || "#6B2C5C";
  const colorCubic  = token("--c-cat-3") || "#2E5C3A";
  const colorNinth  = token("--c-cat-4") || "#A67012";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  const sharedScales = {
    x: {
      type: "linear",
      min: -6,
      max: 6,
      grid: { display: false, color: rule, tickColor: fg3 },
      border: { color: fg2, width: 1 },
      ticks: { stepSize: 2, color: fg3, font: { family: mono, size: 11 } },
      title: {
        display: true, text: "x", align: "end", color: fg3,
        font: { family: mono, size: 10, weight: "500" },
        padding: { top: 6 }
      }
    },
    y: {
      grid: { color: rule, drawTicks: true, tickColor: fg3, lineWidth: 1 },
      border: { color: fg2, width: 1 },
      ticks: { color: fg3, font: { family: mono, size: 11 } },
      title: {
        display: true, text: "y", align: "end", color: fg3,
        font: { family: mono, size: 10, weight: "500" },
        padding: { bottom: 6 }
      }
    }
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
    bodyFont:  { family: mono, size: 12 },
    filter: (item) => item.datasetIndex === 0,
    callbacks: {
      title: (items) => `x = ${items[0].parsed.x.toFixed(2)}`,
      label: (item)  => `y = ${item.parsed.y.toFixed(2)}`
    }
  };

  function gaussianNoise(sigma = 4) {
    const u1 = Math.random();
    const u2 = Math.random();
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function generateScatterData(offset = 0, sigma = 5) {
    const xs = [-5, -4, -2.5, -1, 0, 1, 2.5, 4, 5];
    return xs.map(x => ({
      x,
      y: 0.8 * (x + offset) ** 3 + 0.5 * (x + offset) + gaussianNoise(sigma)
    }));
  }

  const basisLinear = [x => 1, x => x];
  const basisCubic  = [x => 1, x => x, x => x ** 2, x => x ** 3];
  const basisNinth  = [
    x => 1, x => x, x => x ** 2, x => x ** 3, x => x ** 4,
    x => x ** 5, x => x ** 6, x => x ** 7, x => x ** 8, x => x ** 9
  ];

  function designMatrix(data, basisFns) {
    return data.map(pt => basisFns.map(fn => fn(pt.x)));
  }

  function transpose(A) {
    return A[0].map((_, j) => A.map(row => row[j]));
  }

  function matMul(A, B) {
    const rows = A.length, cols = B[0].length, inner = B.length;
    const out = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        for (let k = 0; k < inner; k++)
          out[i][j] += A[i][k] * B[k][j];
    return out;
  }

  function matVecMul(A, v) {
    return A.map(row => row.reduce((s, val, i) => s + val * v[i], 0));
  }

  function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++)
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      const pivot = M[i][i];
      if (Math.abs(pivot) < 1e-12) throw new Error("Singular matrix");
      for (let j = i; j <= n; j++) M[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const f = M[k][i];
          for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
        }
      }
    }
    return M.map(row => row[n]);
  }

  function fitLeastSquares(data, basisFns) {
    const Phi  = designMatrix(data, basisFns);
    const y    = data.map(p => p.y);
    const PhiT = transpose(Phi);
    return solveLinearSystem(matMul(PhiT, Phi), matVecMul(PhiT, y));
  }

  function predict(x, weights, basisFns) {
    return weights.reduce((s, w, i) => s + w * basisFns[i](x), 0);
  }

  function generateFitLine(weights, basisFns, xMin = -5, xMax = 5, step = 0.1, yClamp = null) {
    const pts = [];
    for (let x = xMin; x <= xMax + 1e-9; x += step) {
      const y = predict(x, weights, basisFns);
      if (yClamp === null || Math.abs(y) <= yClamp)
        pts.push({ x: parseFloat(x.toFixed(3)), y });
    }
    return pts;
  }

  function scatterDataset(data) {
    return {
      label: "Data",
      data,
      pointRadius: 3.6,
      pointHoverRadius: 5,
      pointBackgroundColor: colorPoint,
      pointBorderColor: colorPoint,
      pointBorderWidth: 0
    };
  }

  function lineDataset(label, pts, color) {
    return {
      type: "line",
      label,
      data: pts,
      parsing: false,
      borderColor: color,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      spanGaps: false
    };
  }

  function buildChart(canvasId, datasets) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    new Chart(canvas, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
        plugins: { legend: { display: false }, tooltip: sharedTooltip },
        scales: sharedScales
      }
    });
  }

  const scatter1 = generateScatterData(0, 15);
  const scatter2 = generateScatterData(-1, 15);

  const wLin1 = fitLeastSquares(scatter1, basisLinear);
  const wLin2 = fitLeastSquares(scatter2, basisLinear);
  const wCub1 = fitLeastSquares(scatter1, basisCubic);
  const wCub2 = fitLeastSquares(scatter2, basisCubic);
  const wNin1 = fitLeastSquares(scatter1, basisNinth);
  const wNin2 = fitLeastSquares(scatter2, basisNinth);

  buildChart("chart_data_1", [scatterDataset(scatter1)]);

  buildChart("chart_data_1_linear", [
    scatterDataset(scatter1),
    lineDataset("Linear fit", generateFitLine(wLin1, basisLinear), colorLinear)
  ]);
  buildChart("chart_data_2_linear", [
    scatterDataset(scatter2),
    lineDataset("Linear fit", generateFitLine(wLin2, basisLinear), colorLinear)
  ]);

  buildChart("chart_data_1_cubic", [
    scatterDataset(scatter1),
    lineDataset("Cubic fit", generateFitLine(wCub1, basisCubic), colorCubic)
  ]);
  buildChart("chart_data_2_cubic", [
    scatterDataset(scatter2),
    lineDataset("Cubic fit", generateFitLine(wCub2, basisCubic), colorCubic)
  ]);

  buildChart("chart_data_1_ninethic", [
    scatterDataset(scatter1),
    lineDataset("9th degree", generateFitLine(wNin1, basisNinth, -5, 5, 0.05, 300), colorNinth)
  ]);
  buildChart("chart_data_2_ninethic", [
    scatterDataset(scatter2),
    lineDataset("9th degree", generateFitLine(wNin2, basisNinth, -5, 5, 0.05, 300), colorNinth)
  ]);
});
