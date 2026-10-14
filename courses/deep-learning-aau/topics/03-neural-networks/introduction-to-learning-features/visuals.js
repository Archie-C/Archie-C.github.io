window.addEventListener("DOMContentLoaded", () => {
  // Images work independently of the Chart.js CDN. Missing files keep a
  // readable placeholder; adding the documented filename replaces it.
  document.querySelectorAll("[data-recommended-image]").forEach((image) => {
    const placeholder = image.parentElement.querySelector(".image-placeholder");
    const showImage = () => {
      if (image.naturalWidth > 0) {
        image.hidden = false;
        placeholder.hidden = true;
      }
    };
    image.addEventListener("load", showImage);
    image.addEventListener("error", () => {
      image.hidden = true;
      placeholder.hidden = false;
    });
    if (image.complete) showImage();
  });

  if (typeof Chart === "undefined") return;

  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const colours = {
    primary: token("--c-cat-1", "#6B2C5C"),
    secondary: token("--c-cat-2", "#2C4A7A"),
    shade: token("--c-seq-0", "#F0E2EA"),
    fg: token("--fg", "#1A1814"),
    muted: token("--fg-2", "#3D362A"),
    reference: token("--fg-3", "#756B5D"),
    bg: token("--bg", "#F6F1E7"),
    rule: token("--rule", "#D6CDBF"),
    font: token("--font-mono", "monospace")
  };
  const number = new Intl.NumberFormat("en-GB");
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const logTick = (value) => {
    const exponent = Math.log10(value);
    if (!Number.isInteger(exponent)) return "";
    return exponent === 0 ? "1" : `10${String(exponent).split("").map((digit) => superscripts[Number(digit)]).join("")}`;
  };
  const axis = (title, min, max, type = "linear") => ({
    type, min, max,
    border: { color: colours.muted },
    grid: { color: colours.rule },
    ticks: {
      color: colours.reference,
      font: { family: colours.font, size: 10 },
      maxTicksLimit: 6,
      ...(type === "logarithmic" ? { callback: logTick } : {})
    },
    title: {
      display: true, text: title, color: colours.muted,
      font: { family: colours.font, size: 10 }
    }
  });
  const options = (x, y, tooltipLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    font: { family: colours.font },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colours.bg,
        titleColor: colours.fg,
        bodyColor: colours.muted,
        borderColor: colours.rule,
        borderWidth: 1,
        titleFont: { family: colours.font },
        bodyFont: { family: colours.font },
        displayColors: false,
        callbacks: {
          title: (items) => items.length ? items[0].dataset.label : "",
          label: tooltipLabel
        }
      }
    },
    scales: { x, y }
  });
  const line = (label, data, colour, dashed = false) => ({
    label, data, showLine: true, borderColor: colour,
    borderWidth: 1.8, borderDash: dashed ? [5, 4] : [],
    pointRadius: 0, pointHitRadius: 8, tension: 0
  });
  const build = (id, datasets, chartOptions, plugins = []) => {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const chart = new Chart(canvas, {
      type: "scatter", data: { datasets }, options: chartOptions, plugins
    });
    const fallback = document.querySelector(`[data-chart-fallback="${id}"]`);
    if (fallback) fallback.hidden = true;
    return chart;
  };

  // Count every monomial of total degree <= M, including the constant.
  const polynomialTerms = (dimensions, degree) => {
    let result = 1;
    for (let i = 1; i <= degree; i++) result *= (dimensions + i) / i;
    return Math.round(result);
  };
  const countData = (degree) => Array.from({ length: 30 }, (_, index) => ({
    x: index + 1, y: polynomialTerms(index + 1, degree)
  }));
  build("polynomialCountChart", [
    line("Degree 2", countData(2), colours.primary),
    line("Degree 5", countData(5), colours.secondary, true)
  ], options(
    axis("Input dimensions, D", 1, 30),
    axis("Polynomial terms (log scale)", 1, 1000000, "logarithmic"),
    (item) => `D = ${item.parsed.x}: ${number.format(item.parsed.y)} terms`
  ));

  const resolution = document.getElementById("gridResolution");
  // Deterministic illustrative points; no data is added when R changes.
  const observations = Array.from({ length: 24 }, (_, i) => ({
    x: 0.04 + 0.92 * ((0.17 + i * 0.61803398875) % 1),
    y: 0.04 + 0.92 * ((0.31 + i * 0.41421356237) % 1)
  }));
  const occupiedCells = (r) => new Set(observations.map((point) =>
    `${Math.floor(point.x * r)},${Math.floor(point.y * r)}`
  ));
  const occupiedCellShading = {
    id: "occupiedCellShading",
    beforeDraw(chart) {
      const r = Number(resolution.value);
      const { ctx, scales: { x, y } } = chart;
      ctx.save();
      ctx.fillStyle = colours.shade;
      occupiedCells(r).forEach((cell) => {
        const [col, row] = cell.split(",").map(Number);
        const left = x.getPixelForValue(col / r);
        const right = x.getPixelForValue((col + 1) / r);
        const top = y.getPixelForValue((row + 1) / r);
        const bottom = y.getPixelForValue(row / r);
        ctx.fillRect(left, top, right - left, bottom - top);
      });
      ctx.restore();
    }
  };
  const gridAxis = (title) => ({
    ...axis(title, 0, 1),
    ticks: {
      stepSize: 0.1, autoSkip: false,
      font: { family: colours.font, size: 10 },
      color: colours.reference,
      callback: (value) => value === 0 || value === 1 ? value : ""
    }
  });
  const grid = build("regionGridChart", [{
    label: "Synthetic observation", data: observations,
    pointRadius: 3, pointHoverRadius: 5,
    pointBackgroundColor: colours.primary, pointBorderWidth: 0
  }], options(gridAxis("Input x₁"), gridAxis("Input x₂"),
    (item) => `x₁ = ${item.parsed.x.toFixed(2)}, x₂ = ${item.parsed.y.toFixed(2)}`
  ), [occupiedCellShading]);
  const regionData = (r) => Array.from({ length: 8 }, (_, i) => ({ x: i + 1, y: r ** (i + 1) }));
  const growth = build("regionGrowthChart", [
    line("Grid regions", regionData(10), colours.secondary)
  ], options(
    { ...axis("Input dimensions, D", 1, 8), ticks: { ...axis("", 1, 8).ticks, stepSize: 1 } },
    axis("Regions (log scale)", 1, 100000000, "logarithmic"),
    (item) => `D = ${item.parsed.x}: ${number.format(item.parsed.y)} regions`
  ));
  const updateGrid = () => {
    const r = Number(resolution.value);
    const occupied = occupiedCells(r).size;
    document.getElementById("gridResolutionValue").value = r;
    document.getElementById("gridOccupancy").textContent =
      `24 observations · ${occupied} of ${r * r} cells occupied · ${r * r - occupied} empty`;
    grid.canvas.setAttribute("aria-label", `24 fixed synthetic observations in ${r * r} grid cells. ${occupied} cells are occupied and ${r * r - occupied} are empty.`);
    growth.canvas.setAttribute("aria-label", `With ${r} intervals per input, the number of regions grows from ${r} in one dimension to ${number.format(r ** 8)} in eight dimensions.`);
    grid.options.scales.x.ticks.stepSize = 1 / r;
    grid.options.scales.y.ticks.stepSize = 1 / r;
    growth.data.datasets[0].data = regionData(r);
    // Keep the growth axis fixed, so changing R gives an honest comparison.
    grid.update("none");
    growth.update("none");
  };
  if (grid && growth && resolution) {
    resolution.disabled = false;
    resolution.addEventListener("input", updateGrid);
    updateGrid();
  }

  const centre = document.getElementById("gaussianCentre");
  const width = document.getElementById("gaussianWidth");
  const gaussianData = (mu, s) => Array.from({ length: 401 }, (_, i) => {
    const x = -6 + 12 * i / 400;
    return { x, y: Math.exp(-((x - mu) ** 2) / (2 * s ** 2)) };
  });
  const gaussian = build("gaussianBasisChart", [
    line("Adjustable basis", gaussianData(1, 0.6), colours.primary),
    line("Reference: μ = 0, s = 1", gaussianData(0, 1), colours.reference, true)
  ], options(
    axis("Input x", -6, 6), axis("Basis response φⱼ(x)", 0, 1.05),
    (item) => `x = ${item.parsed.x.toFixed(2)}, φ = ${item.parsed.y.toFixed(3)}`
  ));
  const updateGaussian = () => {
    const mu = Number(centre.value);
    const s = Number(width.value);
    document.getElementById("gaussianCentreValue").value = mu.toFixed(1);
    document.getElementById("gaussianWidthValue").value = s.toFixed(1);
    gaussian.data.datasets[0].data = gaussianData(mu, s);
    gaussian.canvas.setAttribute("aria-label", `Gaussian basis function centred at ${mu.toFixed(1)} with width ${s.toFixed(1)}, compared with a fixed reference centred at 0 with width 1. Both peak at 1.`);
    gaussian.update("none");
  };
  if (gaussian && centre && width) {
    centre.disabled = false;
    width.disabled = false;
    centre.addEventListener("input", updateGaussian);
    width.addEventListener("input", updateGaussian);
  }
});
