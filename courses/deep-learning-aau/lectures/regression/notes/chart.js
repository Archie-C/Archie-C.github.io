window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const dataPoints = [
    { x: 3, y: 96 },
    { x: 5, y: 109 },
    { x: 7, y: 123 },
    { x: 9, y: 132 },
    { x: 11, y: 146 },
    { x: 13, y: 158 },
    { x: 15, y: 167 }
  ];

  const scatterCanvas = document.getElementById("scatterChart");
  const lineCanvas = document.getElementById("lineChart");


  if (scatterCanvas) {
    const scatterCtx = scatterCanvas.getContext("2d");

    new Chart(scatterCtx, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Data points",
          data: dataPoints,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#2c6db2",
          pointBorderColor: "#2c6db2"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Age (years)"
            }
          },
          y: {
            title: {
              display: true,
              text: "Height (cm)"
            }
          }
        }
      }
    });
  }

  if (!lineCanvas) {
    return;
  }

  const lineCtx = lineCanvas.getContext("2d");

  new Chart(lineCtx, {
    type: "scatter",
    data: {
      datasets: [
        {
          data: dataPoints,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#2c6db2",
          pointBorderColor: "#2c6db2"
        },
        {
          type: "line",
          data: [
            { x: 3, y: 98 },
            { x: 15, y: 170 }
          ],
          borderColor: "#d64545",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          type: "linear",
          position: "bottom",
          title: {
            display: true,
            text: "Age (years)"
          }
        },
        y: {
          type: "linear",
          title: {
            display: true,
            text: "Height (cm)"
          }
        }
      }
    }
  });

  // Gaussian noise
  function gaussianNoise(sigma = 4) {
    const u1 = Math.random();
    const u2 = Math.random();
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // Generate noisy cubic data
  function generateScatterData(offset = 0, sigma = 5) {
    const xs = [-5, -4, -2.5, -1, 0, 1, 2.5, 4, 5]; // 9 pts, slightly uneven
    return xs.map(x => ({
      x,
      y: 0.8*(x + offset)**3 + 0.5*(x + offset) + gaussianNoise(sigma)
    }));
  }

  // Basis functions
  const basisLinear = [
    x => 1,
    x => x
  ];


  const basisCubic = [
    x => 1,
    x => x,
    x => x ** 2,
    x => x ** 3
  ];

  const basisSextic = [
    x => 1,
    x => x,
    x => x ** 2,
    x => x ** 3,
    x => x ** 4,
    x => x ** 5,
    x => x ** 6
  ];

  const basisNinethic = [
    x => 1,
    x => x,
    x => x ** 2,
    x => x ** 3,
    x => x ** 4,
    x => x ** 5,
    x => x ** 6,
    x => x ** 7,
    x => x ** 8,
    x => x ** 9
  ];


  // Build design matrix
  function designMatrix(data, basisFns) {
    return data.map(point => basisFns.map(fn => fn(point.x)));
  }

  // Transpose
  function transpose(A) {
    return A[0].map((_, j) => A.map(row => row[j]));
  }

  // Matrix multiply
  function matMul(A, B) {
    const rows = A.length;
    const cols = B[0].length;
    const inner = B.length;
    const out = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        for (let k = 0; k < inner; k++) {
          out[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return out;
  }

  // Matrix-vector multiply
  function matVecMul(A, v) {
    return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
  }

  // Solve linear system Ax = b using Gaussian elimination
  function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      // Partial pivoting
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k;
        }
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];

      const pivot = M[i][i];
      if (Math.abs(pivot) < 1e-12) {
        throw new Error("Singular matrix");
      }

      // Normalize row
      for (let j = i; j <= n; j++) {
        M[i][j] /= pivot;
      }

      // Eliminate
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = i; j <= n; j++) {
            M[k][j] -= factor * M[i][j];
          }
        }
      }
    }

    return M.map(row => row[n]);
  }

  // Least squares fit: w = (Phi^T Phi)^(-1) Phi^T y
  function fitLeastSquares(data, basisFns) {
    const Phi = designMatrix(data, basisFns);
    const y = data.map(p => p.y);
    const PhiT = transpose(Phi);
    const PhiTPhi = matMul(PhiT, Phi);
    const PhiTy = matVecMul(PhiT, y);
    return solveLinearSystem(PhiTPhi, PhiTy);
  }

  // Predict using fitted weights
  function predict(x, weights, basisFns) {
    return weights.reduce((sum, w, i) => sum + w * basisFns[i](x), 0);
  }

  // Generate smooth fitted line
  function generateFitLine(weights, basisFns, xMin = -5, xMax = 5, step = 0.1) {
    const data = [];
    for (let x = xMin; x <= xMax; x += step) {
      data.push({
        x,
        y: predict(x, weights, basisFns)
      });
    }
    return data;
  }

  // Create one chart with actual fitted lines
  function createRegressionChart(
    canvasId,
    scatterData,
    includedLines = ['linear', 'cubic', 'ninethic']
  ) {
    if (!document.getElementById(canvasId)) return;

    const datasets = [];

    // Always include raw data
    datasets.push({
      label: 'Data',
      data: scatterData
    });

    // Fit once
    const wLinear = fitLeastSquares(scatterData, basisLinear);
    const wCubic = fitLeastSquares(scatterData, basisCubic);
    const wNinethic = fitLeastSquares(scatterData, basisNinethic);

    // Helper to add line if included
    function maybeAdd(name, label, weights, basis) {
      if (!includedLines.includes(name)) return;

      datasets.push({
        label,
        type: 'line',
        data: generateFitLine(weights, basis),
        parsing: false,
        pointRadius: 0,
        borderWidth: 2
      });
    }

    maybeAdd('linear', 'Linear basis fit', wLinear, basisLinear);
    maybeAdd('cubic', 'x^3 basis fit', wCubic, basisCubic);
    maybeAdd('ninethic', 'x^9 basis fit', wNinethic, basisNinethic);

    new Chart(document.getElementById(canvasId), {
      type: 'scatter',
      data: { datasets },
      options: {
      plugins: {
        legend: {
          display: false
        }
      },
        responsive: true,
        transitions: {
          show: {
            animations: {
              x: { from: 0 },
              y: { from: 0 }
            }
          },
          hide: {
            animations: {
              x: { to: 0 },
              y: { to: 0 }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom'
          }
        }
      }
    });
  }

  // Two slightly different datasets
  const scatter1 = generateScatterData(0, 15);
  const scatter2 = generateScatterData(-1, 15);

  // Two charts
  createRegressionChart('chart_data_1', scatter1, includedLines=[]);
  createRegressionChart('chart_data_1_linear', scatter1, includedLines=['linear']);
  createRegressionChart('chart_data_2_linear', scatter2, includedLines=['linear']);

  createRegressionChart('chart_data_1_cubic', scatter1, includedLines=['cubic']);
  createRegressionChart('chart_data_2_cubic', scatter2, includedLines=['cubic']);

  createRegressionChart('chart_data_1_ninethic', scatter1, includedLines=['ninethic']);
    createRegressionChart('chart_data_2_ninethic', scatter2, includedLines=['ninethic']);
});
