window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const canvas = document.getElementById("heightAgeChart");
  if (!canvas) {
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");
  const point = token("--c-cat-2") || "#2C4A7A";
  const line  = token("--c-cat-1") || "#6B2C5C";
  const mono = token("--font-mono") || "monospace";

  const dataPoints = [
    { x: 3, y: 96 },
    { x: 5, y: 109 },
    { x: 7, y: 123 },
    { x: 9, y: 132 },
    { x: 11, y: 146 },
    { x: 13, y: 158 },
    { x: 15, y: 167 }
  ];

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  const sharedScaleOptions = {
    x: {
      type: "linear",
      min: 2,
      max: 16,
      grid: { display: false, color: rule, tickColor: fg3 },
      border: { color: fg2, width: 1 },
      ticks: { stepSize: 4, color: fg3, font: { family: mono, size: 11 } },
      title: {
        display: true, text: "age (years)", align: "end", color: fg3,
        font: { family: mono, size: 10, weight: "500" },
        padding: { top: 6 }
      }
    },
    y: {
      min: 90,
      max: 175,
      grid: { color: rule, drawTicks: true, tickColor: fg3, lineWidth: 1 },
      border: { color: fg2, width: 1 },
      ticks: { stepSize: 20, color: fg3, font: { family: mono, size: 11 } },
      title: {
        display: true, text: "height (cm)", align: "end", color: fg3,
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
    bodyFont: { family: mono, size: 12 },
    callbacks: {
      title: (items) => `age ${items[0].parsed.x}`,
      label: (item) => `height ${item.parsed.y} cm`
    }
  };

  new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Observed students",
          data: dataPoints,
          pointRadius: 3.6,
          pointHoverRadius: 5,
          pointBackgroundColor: point,
          pointBorderColor: point,
          pointBorderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: { legend: { display: false }, tooltip: sharedTooltip },
      scales: sharedScaleOptions
    }
  });

  const lineCanvas = document.getElementById("heightAgeLineChart");
  if (!lineCanvas) return;

  new Chart(lineCanvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Observed students",
          data: dataPoints,
          pointRadius: 3.6,
          pointHoverRadius: 5,
          pointBackgroundColor: point,
          pointBorderColor: point,
          pointBorderWidth: 0
        },
        {
          type: "line",
          label: "Fitted line",
          data: [{ x: 2, y: 92 }, { x: 16, y: 176 }],
          borderColor: line,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: { legend: { display: false }, tooltip: sharedTooltip },
      scales: sharedScaleOptions
    }
  });
});
