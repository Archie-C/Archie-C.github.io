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
    accent: token("--accent", "#6B2C5C"),
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
        title: { display: true, text: yTitle, align: "end", color: colour.fg3, font: { family: colour.mono, size: 10 } }
      }
    }
  });

  const sigmoid = (a) => 1 / (1 + Math.exp(-a));
  const sigmoidData = Array.from({ length: 65 }, (_, i) => {
    const x = -8 + i * 0.25;
    return { x, y: sigmoid(x) };
  });

  const sigmoidCanvas = document.getElementById("sigmoidChart");
  if (sigmoidCanvas) {
    const ref = makeOptions("linear score a", "σ(a)", -8, 8, 0, 1, {
      title: (items) => items.length ? `a = ${items[0].parsed.x.toFixed(2)}` : "",
      label: (item) => `σ(a) = ${item.parsed.y.toFixed(3)}`
    });
    new Chart(sigmoidCanvas, {
      type: "scatter",
      data: { datasets: [
        { label: "σ(a)", data: sigmoidData, showLine: true, borderColor: colour.accent, borderWidth: 2, pointRadius: 0, tension: 0.15 },
        { label: "0.5", data: [{ x: -8, y: 0.5 }, { x: 8, y: 0.5 }], showLine: true, borderColor: colour.rule, borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
        { label: "a = 0", data: [{ x: 0, y: 0 }, { x: 0, y: 1 }], showLine: true, borderColor: colour.rule, borderWidth: 1, borderDash: [4, 4], pointRadius: 0 }
      ] },
      options: ref
    });
  }

  const rejected = [
    { x: 32, y: 42 }, { x: 39, y: 48 }, { x: 44, y: 38 }, { x: 47, y: 55 },
    { x: 52, y: 43 }, { x: 56, y: 51 }, { x: 58, y: 61 }
  ];
  const admitted = [
    { x: 55, y: 72 }, { x: 61, y: 67 }, { x: 65, y: 76 }, { x: 70, y: 71 },
    { x: 73, y: 82 }, { x: 80, y: 75 }, { x: 84, y: 88 }
  ];
  const probability = (p) => 1 / (1 + Math.exp(-(0.12 * p.x + 0.08 * p.y - 11.2)));
  const admissionsCanvas = document.getElementById("logisticAdmissionsChart");
  if (admissionsCanvas) {
    const tooltip = {
      title: (items) => items.length ? items[0].dataset.label : "",
      label: (item) => {
        const p = item.raw;
        return `exam ${p.x}, interview ${p.y}, true class ${p.trueClass}, predicted p(admitted) ${probability(p).toFixed(2)}`;
      }
    };
    const line = (data, label, borderColor, width = 1.5, dash = []) => ({
      type: "line", label, data, borderColor, borderWidth: width, borderDash: dash,
      pointRadius: 0, tension: 0
    });
    new Chart(admissionsCanvas, {
      type: "scatter",
      data: { datasets: [
        { label: "Rejected students", data: rejected.map(p => ({ ...p, trueClass: 0 })), pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: colour.class0, pointBorderColor: colour.class0, pointBorderWidth: 0 },
        { label: "Admitted students", data: admitted.map(p => ({ ...p, trueClass: 1 })), pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: colour.class1, pointBorderColor: colour.class1, pointBorderWidth: 0 },
        line([{ x: 25, y: 102.5 }, { x: 90, y: 5 }], "p(admitted) = 0.5", colour.boundary, 1.7)
      ] },
      options: makeOptions("entrance exam score", "interview score", 25, 90, 25, 95, tooltip)
    });
  }

  const scaleSlider = document.getElementById("scaleSlider");
  const scaleValue = document.getElementById("scaleValue");
  const scaleCanvas = document.getElementById("sigmoidScaleChart");
  if (scaleSlider && scaleValue && scaleCanvas) {
    const baseData = sigmoidData;
    const scaledData = () => baseData.map(p => ({ x: p.x, y: sigmoid(Number(scaleSlider.value) * p.x) }));
    const chart = new Chart(scaleCanvas, {
      type: "scatter",
      data: { datasets: [
        { label: "Current scale", data: scaledData(), showLine: true, borderColor: colour.accent, borderWidth: 2, pointRadius: 0 },
        { label: "Scale 1", data: baseData, showLine: true, borderColor: colour.fg3, borderWidth: 1, borderDash: [4, 4], pointRadius: 0 }
      ] },
      options: makeOptions("linear score a", "probability", -8, 8, 0, 1, {
        title: (items) => items.length ? `a = ${items[0].parsed.x.toFixed(2)}` : "",
        label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(3)}`
      })
    });
    scaleSlider.addEventListener("input", () => {
      const scale = Number(scaleSlider.value);
      scaleValue.textContent = scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      chart.data.datasets[0].data = scaledData();
      chart.update("none");
    });
  }
});
