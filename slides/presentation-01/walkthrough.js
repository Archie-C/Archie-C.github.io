/* Charts for the regression notebook. Regenerate their source data with
   prepare-walkthrough.py; model fitting stays in the notebook's Python code. */
(() => {
  "use strict";

  const containers = [...document.querySelectorAll("[data-walk-chart]")];
  const stylesheet = getComputedStyle(document.documentElement);
  const token = (name) => stylesheet.getPropertyValue(name).trim();
  const colours = [1, 2, 3, 4, 5].map((i) => token(`--c-cat-${i}`));
  const font = { family: token("--font-mono"), size: 16 };
  const xy = (rows, x = 0, y = 1) => rows.map((row) => ({ x: row[x], y: row[y] }));
  const extent = (values) => [Math.min(...values), Math.max(...values)];

  containers.forEach((container) => {
    container.classList.add("walk-chart");
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = SlideLayout.dimensions(container, [Number(container.dataset.width), Number(container.dataset.height)]);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", container.getAttribute("aria-label"));
    canvas.textContent = container.getAttribute("aria-label");
    const status = document.createElement("span");
    status.className = "walk-chart-status";
    status.setAttribute("role", "status");
    status.textContent = "Loading chart…";
    container.append(canvas, status);
  });

  const axis = (label) => ({
    type: "linear",
    border: { color: token("--c-axis") },
    grid: { color: token("--c-grid") },
    ticks: { color: token("--c-label"), font, maxTicksLimit: 6 },
    title: { display: Boolean(label), text: label, color: token("--c-label"), font: { ...font, size: 18 } },
  });

  const points = (data, extra = {}) => ({
    data, pointRadius: 2, pointHoverRadius: 4, pointBorderWidth: 0,
    backgroundColor: `${colours[0]}66`, ...extra,
  });

  const line = (data, extra = {}) => ({
    type: "line", data, borderColor: colours[0], backgroundColor: colours[0],
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, ...extra,
  });

  const referenceLines = {
    id: "walkReferenceLines",
    beforeDatasetsDraw(chart, args, options) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      ctx.strokeStyle = token("--c-ref");
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      if (options.zero && scales.y.min <= 0 && scales.y.max >= 0) {
        const y = scales.y.getPixelForValue(0);
        ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
      }
      if (Number.isFinite(options.selected)) {
        const x = scales.x.getPixelForValue(options.selected);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      }
      ctx.restore();
    },
  };

  function create(container, datasets, xLabel, yLabel, extra = {}) {
    const { scales = {}, plugins = {}, type = "scatter", ...rest } = extra;
    const chart = new Chart(container.querySelector("canvas"), {
      type,
      data: { datasets },
      plugins: [referenceLines],
      options: {
        responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 2,
        normalized: false,
        layout: { padding: { top: 8, right: 14 } },
        scales: { x: axis(xLabel), y: axis(yLabel), ...scales },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: token("--bg"), borderColor: token("--rule"), borderWidth: 1,
            titleColor: token("--fg"), bodyColor: token("--fg-2"),
            titleFont: font, bodyFont: font, displayColors: false,
            callbacks: { label: (item) => `${item.dataset.label || "Value"}: (${item.parsed.x.toFixed(3)}, ${item.parsed.y.toFixed(3)})` },
          },
          ...plugins,
        },
        ...rest,
      },
    });
    SlideLayout.register(chart, container, [Number(container.dataset.width), Number(container.dataset.height)]);
    container.querySelector(".walk-chart-status").textContent = "";
    return chart;
  }

  function bars(container, results, labels, logarithmic = false) {
    const values = results.map((result) => result["Validation MSE"]);
    const best = Math.min(...values);
    const chart = create(container, [{
      label: "Validation MSE", data: values,
      backgroundColor: values.map((value) => value === best ? colours[0] : `${colours[1]}99`),
      borderWidth: 0, barPercentage: 0.7,
    }], "Validation MSE (lower is better)", "", {
      type: "bar", indexAxis: "y",
      scales: {
        x: { ...axis("Validation MSE (lower is better)"), type: logarithmic ? "logarithmic" : "linear", ...(logarithmic ? { min: 0.01, max: 200 } : { beginAtZero: true }) },
        y: { ...axis(""), type: "category", labels, grid: { display: false }, ticks: { color: token("--c-label"), font: { ...font, size: logarithmic ? 16 : 21 } } },
      },
      plugins: {
        tooltip: {
          backgroundColor: token("--bg"), borderColor: token("--rule"), borderWidth: 1,
          titleColor: token("--fg"), bodyColor: token("--fg-2"), titleFont: font, bodyFont: font,
          callbacks: { label: (item) => `Validation MSE: ${item.parsed.x.toFixed(4)}` },
        },
      },
    });
    return chart;
  }

  function sweep(container, data, selected, xLabel) {
    return create(container, [line(xy(data), { pointRadius: 3 }), points([{ x: selected, y: data.find((row) => Math.abs(row[0] - selected) < 1e-6)[1] }], { pointRadius: 7, backgroundColor: colours[1], label: "Selected" })], xLabel, "Validation MSE", {
      plugins: { walkReferenceLines: { selected } },
    });
  }

  function mix(a, b, fraction) {
    const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
    const first = rgb(a), second = rgb(b);
    return `rgb(${first.map((value, i) => Math.round(value + (second[i] - value) * fraction)).join(",")})`;
  }

  function heatmap(data) {
    const holder = document.querySelector("[data-walk-heatmap]");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 650 460");
    svg.setAttribute("class", "walk-corr");
    const add = (name, attributes, content) => {
      const element = document.createElementNS(ns, name);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
      if (content !== undefined) element.textContent = content;
      svg.append(element);
      return element;
    };
    const labels = [...data.features, "y"];
    labels.forEach((label, i) => {
      add("text", { x: 105 + i * 50, y: 22, fill: token("--fg-2"), "text-anchor": "middle" }, label);
      add("text", { x: 68, y: 62 + i * 50, fill: token("--fg-2"), "text-anchor": "end" }, label);
      data.correlations[i].forEach((value, j) => {
        const fill = mix(token("--c-seq-0"), value < 0 ? colours[1] : colours[0], Math.abs(value));
        const cell = add("rect", { x: 80 + j * 50, y: 32 + i * 50, width: 49, height: 49, fill });
        const title = document.createElementNS(ns, "title");
        title.textContent = `${label} / ${labels[j]}: ${value.toFixed(4)}`;
        cell.append(title);
        add("text", { class: "walk-corr-value", x: 105 + j * 50, y: 63 + i * 50, "text-anchor": "middle", fill: Math.abs(value) > 0.65 ? "#ffffff" : token("--fg") }, value.toFixed(2));
      });
    });
    add("text", { x: 510, y: 94, fill: token("--fg-2") }, "Correlation");
    [-1, -0.5, 0, 0.5, 1].forEach((value, i) => {
      add("rect", { x: 510, y: 116 + i * 40, width: 28, height: 28, fill: mix(token("--c-seq-0"), value < 0 ? colours[1] : colours[0], Math.abs(value)) });
      add("text", { x: 550, y: 136 + i * 40, fill: token("--fg-2") }, value.toFixed(1));
    });
    holder.replaceChildren(svg);
  }

  function render(data) {
    const targetRange = extent(data.sample.map((row) => row[7]));
    const targetColours = data.sample.map((row) => {
      const fraction = (row[7] - targetRange[0]) / (targetRange[1] - targetRange[0]);
      return fraction < 0.5 ? mix(colours[1], token("--c-seq-2"), fraction * 2) : mix(token("--c-seq-2"), colours[0], (fraction - 0.5) * 2);
    });
    heatmap(data);
    document.querySelectorAll("[data-walk-result]").forEach((node) => { node.textContent = data.results[Number(node.dataset.walkResult)]["Validation MSE"].toFixed(3); });
    document.querySelectorAll("[data-walk-metric]").forEach((node) => { node.textContent = data.testMetrics[node.dataset.walkMetric].toFixed(node.dataset.walkMetric === "r2" ? 5 : 4); });
    const groupRange = extent(data.conditionalGroups.flatMap((group) => group.points.map((point) => point[1])));

    containers.forEach((container) => {
      const name = container.dataset.walkChart;
      const number = Number(name.split("-").at(-1));
      if (name.startsWith("raw-")) {
        create(container, [points(xy(data.sample, number, 7))], data.features[number], "y");
      } else if (name.startsWith("history-")) {
        create(container, [line(xy(data.history, 0, number + 1), { borderWidth: 1.3 })], "Observation index", ["x_1", "x_6", "y"][number], { scales: { x: { ...axis("Observation index"), min: 0, max: data.rows } } });
      } else if (name === "baseline") {
        bars(container, data.results.slice(0, 3), ["Linear: x_6", "Linear: x_4, x_6", "Linear: all seven"]);
      } else if (name === "rbf") {
        const minimum = data.rbfCentres[0] - 3 * data.rbfWidth;
        const maximum = data.rbfCentres.at(-1) + 3 * data.rbfWidth;
        create(container, data.rbfCentres.map((centre, i) => line(Array.from({ length: 180 }, (_, j) => {
          const x = minimum + (maximum - minimum) * j / 179;
          return { x, y: Math.exp(-0.5 * ((x - centre) / data.rbfWidth) ** 2) };
        }), { label: `Centre ${centre.toFixed(2)}`, borderColor: colours[i] })), "x_4", "Basis value");
      } else if (name.startsWith("pair-")) {
        const [x, y] = [[1, 0], [4, 2], [5, 3]][number];
        create(container, [points(xy(data.sample, x, y), { backgroundColor: targetColours })], data.features[x], data.features[y]);
      } else if (name.startsWith("difference-")) {
        create(container, [points(xy(data.differences, number, 2))], number === 0 ? "x_1 − 1.10 x_2" : "x_3 − 0.81 x_5", "y");
      } else if (name === "additions") {
        bars(container, [data.results[2], data.results[5], data.results[6]], ["Linear: all seven", "+ squared difference", "+ pairwise products"]);
      } else if (name === "lag") {
        sweep(container, data.lagSweep, data.bestLag, "Delay (observations earlier)");
      } else if (name === "lag-residual" || name === "tuned-residual") {
        create(container, [points(xy(name === "lag-residual" ? data.lagResiduals : data.tunedResiduals))], "x_1 − 1.10 x_2", "Training residual", { plugins: { walkReferenceLines: { zero: true } } });
      } else if (name.startsWith("conditional-")) {
        const group = data.conditionalGroups[number];
        create(container, [points(xy(group.points)), line(xy(group.line), { borderColor: colours[1], label: `Fitted slope ${group.slope.toFixed(2)}` })], "x_7", "Training residual", {
          scales: { y: { ...axis("Training residual"), min: groupRange[0], max: groupRange[1] } },
          plugins: { walkReferenceLines: { zero: true } },
        });
      } else if (name === "ratio") {
        sweep(container, data.ratioSweep, data.ratio35, "Scale applied to x_5");
      } else if (name === "binned") {
        create(container, [line(xy(data.binnedResiduals), { pointRadius: 3 })], "x_1 − 1.10 x_2", "Mean residual per bin", { plugins: { walkReferenceLines: { zero: true } } });
      } else if (name === "frequency") {
        sweep(container, data.frequencySweep, data.bestFrequency, "Sine frequency (radians per unit)");
      } else if (name === "summary") {
        bars(container, data.results, ["Linear: x_6", "Linear: x_4, x_6", "Linear: all seven", "Quadratic: x_4, x_6", "RBF: x_4, x_6", "+ squared difference", "+ pairwise products", "+ delayed products", "+ conditional x_7", "+ tuned scale", "+ sine basis function"], true);
      } else if (name === "test-predictions") {
        const range = extent(data.testPredictions.flat());
        create(container, [points(xy(data.testPredictions)), line(range.map((value) => ({ x: value, y: value })), { borderColor: colours[1], borderDash: [5, 5], label: "Perfect prediction" })], "Observed y", "Predicted y");
      } else if (name === "test-residuals") {
        create(container, [points(data.testPredictions.map(([observed, predicted]) => ({ x: predicted, y: observed - predicted })))], "Predicted y", "Test residual", { plugins: { walkReferenceLines: { zero: true } } });
      } else {
        throw new Error(`Unknown walkthrough chart: ${name}`);
      }
    });
    Reveal.layout();
    document.documentElement.dataset.walkthroughReady = "true";
  }

  async function start() {
    try {
      const [response] = await Promise.all([fetch("./assets/regression-walkthrough.json"), document.fonts.ready]);
      if (!response.ok) throw new Error(`Chart data request failed (${response.status}).`);
      render(await response.json());
    } catch (error) {
      console.error("Regression walkthrough:", error);
      document.documentElement.dataset.walkthroughReady = "error";
      document.querySelectorAll(".walk-chart-status").forEach((node) => {
        if (node.textContent) node.textContent = "Chart unavailable. Serve the deck over HTTP and reload.";
      });
    }
  }

  if (Reveal.isReady()) start();
  else Reveal.on("ready", start);
})();
