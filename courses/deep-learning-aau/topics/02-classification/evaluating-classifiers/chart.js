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
    threshold: token("--c-cat-3", "#8B6F47"),
    mono: token("--font-mono", "monospace")
  };

  Chart.defaults.font.family = colour.mono;
  Chart.defaults.color = colour.fg2;

  // The observation order and probabilities also appear in the page table.
  const patients = [
    { observation: 1, trueClass: 1, probability: 0.82 },
    { observation: 2, trueClass: 0, probability: 0.18 },
    { observation: 3, trueClass: 0, probability: 0.67 },
    { observation: 4, trueClass: 1, probability: 0.42 },
    { observation: 5, trueClass: 1, probability: 0.73 },
    { observation: 6, trueClass: 0, probability: 0.31 },
    { observation: 7, trueClass: 1, probability: 0.55 },
    { observation: 8, trueClass: 0, probability: 0.09 },
    { observation: 9, trueClass: 1, probability: 0.91 },
    { observation: 10, trueClass: 0, probability: 0.62 },
    { observation: 11, trueClass: 0, probability: 0.24 },
    { observation: 12, trueClass: 1, probability: 0.38 },
    { observation: 13, trueClass: 0, probability: 0.48 },
    { observation: 14, trueClass: 1, probability: 0.77 }
  ];

  function classify(patient, threshold) {
    return patient.probability >= threshold ? 1 : 0;
  }

  function outcome(patient, threshold) {
    const predicted = classify(patient, threshold);
    if (patient.trueClass === 1 && predicted === 1) return "TP";
    if (patient.trueClass === 0 && predicted === 0) return "TN";
    if (patient.trueClass === 0 && predicted === 1) return "FP";
    return "FN";
  }

  function computeMetrics(data, threshold) {
    const result = { tp: 0, tn: 0, fp: 0, fn: 0 };
    data.forEach(patient => {
      const label = outcome(patient, threshold).toLowerCase();
      result[label] += 1;
    });
    const safeDivide = (numerator, denominator) => denominator ? numerator / denominator : 0;
    result.accuracy = safeDivide(result.tp + result.tn, data.length);
    result.precision = safeDivide(result.tp, result.tp + result.fp);
    result.recall = safeDivide(result.tp, result.tp + result.fn);
    result.f1 = safeDivide(2 * result.precision * result.recall, result.precision + result.recall);
    return result;
  }

  const makeScales = (xTitle, yTitle, xMin, xMax, yMin, yMax, yStep = undefined) => ({
    x: {
      type: "linear", min: xMin, max: xMax,
      grid: { display: false }, border: { color: colour.fg2, width: 1 },
      ticks: { stepSize: 1, color: colour.fg3, font: { family: colour.mono, size: 11 } },
      title: { display: true, text: xTitle, align: "end", color: colour.fg3, font: { family: colour.mono, size: 10, weight: "500" }, padding: { top: 6 } }
    },
    y: {
      min: yMin, max: yMax,
      grid: { color: colour.rule, tickColor: colour.fg3, lineWidth: 1 },
      border: { color: colour.fg2, width: 1 },
      ticks: { ...(yStep ? { stepSize: yStep } : {}), color: colour.fg3, font: { family: colour.mono, size: 11 } },
      title: { display: true, text: yTitle, align: "end", color: colour.fg3, font: { family: colour.mono, size: 10, weight: "500" }, padding: { bottom: 6 } }
    }
  });

  const sharedTooltip = {
    backgroundColor: colour.bg,
    borderColor: colour.rule,
    borderWidth: 1,
    titleColor: colour.fg,
    bodyColor: colour.fg2,
    displayColors: false,
    padding: 10,
    titleFont: { family: colour.mono, size: 12, weight: "600" },
    bodyFont: { family: colour.mono, size: 12 }
  };

  function observationDatasets(threshold) {
    const class0 = patients.filter(patient => patient.trueClass === 0);
    const class1 = patients.filter(patient => patient.trueClass === 1);
    const scatter = (data, label, pointColor) => ({
      label,
      data: data.map(patient => ({ x: patient.observation, y: patient.probability, patient })),
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: pointColor,
      pointBorderColor: pointColor,
      pointBorderWidth: 0
    });
    return [
      scatter(class0, "True class 0", colour.class0),
      scatter(class1, "True class 1", colour.class1),
      {
        type: "line",
        label: "Threshold",
        data: [{ x: 0.5, y: threshold }, { x: 14.5, y: threshold }],
        borderColor: colour.threshold,
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0
      }
    ];
  }

  const predictionOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...sharedTooltip,
        filter: item => item.datasetIndex < 2,
        callbacks: {
          title: items => items.length ? `Patient ${items[0].raw.patient.observation}` : "",
          label: item => {
            const patient = item.raw.patient;
            const threshold = item.chart.$threshold ?? 0.5;
            return [
              `true class: ${patient.trueClass}`,
              `probability: ${patient.probability.toFixed(2)}`,
              `predicted class: ${classify(patient, threshold)}`,
              `outcome: ${outcome(patient, threshold)}`
            ];
          }
        }
      }
    },
    scales: makeScales("patient", "predicted probability", 0.5, 14.5, 0, 1, 0.2)
  });

  const predictionsCanvas = document.getElementById("classificationPredictionsChart");
  if (predictionsCanvas) {
    const chart = new Chart(predictionsCanvas, {
      type: "scatter",
      data: { datasets: observationDatasets(0.5) },
      options: predictionOptions()
    });
    chart.$threshold = 0.5;
  }

  const imbalanceCanvas = document.getElementById("classImbalanceChart");
  if (imbalanceCanvas) {
    new Chart(imbalanceCanvas, {
      type: "bar",
      data: {
        labels: ["Negative", "Positive"],
        datasets: [{
          label: "Patients",
          data: [99, 1],
          backgroundColor: [colour.class0, colour.class1],
          borderWidth: 0,
          maxBarThickness: 70
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: { label: item => `${item.parsed.y} patient${item.parsed.y === 1 ? "" : "s"}` }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: colour.fg2 }, ticks: { color: colour.fg3, font: { family: colour.mono, size: 11 } } },
          y: {
            beginAtZero: true, max: 100,
            grid: { color: colour.rule }, border: { color: colour.fg2 },
            ticks: { stepSize: 20, color: colour.fg3, font: { family: colour.mono, size: 11 } },
            title: { display: true, text: "number of patients", align: "end", color: colour.fg3, font: { family: colour.mono, size: 10 } }
          }
        }
      }
    });
  }

  const thresholdCanvas = document.getElementById("thresholdChart");
  const slider = document.getElementById("thresholdSlider");
  const thresholdChart = thresholdCanvas ? new Chart(thresholdCanvas, {
    type: "scatter",
    data: { datasets: observationDatasets(0.5) },
    options: predictionOptions()
  }) : null;
  if (thresholdChart) thresholdChart.$threshold = 0.5;

  function showMetric(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value.toFixed(2);
  }

  function updateThreshold() {
    if (!slider) return;
    const threshold = Number(slider.value);
    const value = document.getElementById("thresholdValue");
    if (value) value.textContent = threshold.toFixed(2);

    const metrics = computeMetrics(patients, threshold);
    showMetric("thresholdAccuracy", metrics.accuracy);
    showMetric("thresholdPrecision", metrics.precision);
    showMetric("thresholdRecall", metrics.recall);
    showMetric("thresholdF1", metrics.f1);
    ["TP", "TN", "FP", "FN"].forEach(key => {
      const element = document.getElementById(`threshold${key}`);
      if (element) element.textContent = metrics[key.toLowerCase()];
    });

    if (thresholdChart) {
      thresholdChart.$threshold = threshold;
      thresholdChart.data.datasets = observationDatasets(threshold);
      thresholdChart.update();
    }
  }

  if (slider) {
    slider.addEventListener("input", updateThreshold);
    updateThreshold();
  }
});
