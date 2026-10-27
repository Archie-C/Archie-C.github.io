/* Question 2: edit these pairs to change the scatter plot. */
(() => {
  const observations = [
    { x: 22, y: 7.8 },
    { x: 28, y: 6.5 },
    { x: 31, y: 7.1 },
    { x: 35, y: 5.9 },
    { x: 40, y: 5.2 },
    { x: 45, y: 4.6 },
    { x: 50, y: 4.9 },
    { x: 55, y: 3.4 },
    { x: 62, y: 3.0 },
    { x: 68, y: 2.1 },
  ];

  const createCharts = () => {
    const styles = getComputedStyle(document.documentElement);
    const token = (name) => styles.getPropertyValue(name).trim();
    const font = { family: token("--font-mono"), size: 18 };
    const width = 1120;
    const height = 360;

    // Ordinary least squares, calculated from the same data as the scatter plot.
    const meanX = observations.reduce((sum, point) => sum + point.x, 0) / observations.length;
    const meanY = observations.reduce((sum, point) => sum + point.y, 0) / observations.length;
    const numerator = observations.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
    const denominator = observations.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    const slope = numerator / denominator;
    const intercept = meanY - slope * meanX;
    const predict = (age) => slope * age + intercept;

    const equation = document.getElementById("age-exercise-fit-equation");
    const formula = `\\hat{y} = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`;
    if (window.katex) {
      window.katex.render(formula, equation, { throwOnError: false });
    } else {
      // The maths plugin loads asynchronously; it will typeset this when ready.
      equation.textContent = `$${formula}$`;
    }

    // The fixed canvas can render even while reveal.js hides this slide.
    // Account for the deck's transform scale to keep points and text sharp.
    const screenPixelRatio = () => Math.max(
      2,
      window.devicePixelRatio * Math.max(1, Reveal.getScale()),
    );

    const axis = (title) => ({
      border: { color: token("--c-axis"), width: 1 },
      grid: { color: token("--c-grid"), tickColor: token("--c-tick") },
      ticks: { color: token("--c-label"), font },
      title: {
        display: true,
        text: title,
        color: token("--c-label"),
        font: { ...font, size: 20 },
      },
    });

    const createChart = (canvasId, showFit = false) => new Chart(document.getElementById(canvasId), {
      type: "scatter",
      data: {
        datasets: [{
          label: "Weekly exercise",
          data: observations,
          pointBackgroundColor: token(showFit ? "--fg" : "--c-cat-1"),
          pointBorderColor: token(showFit ? "--fg" : "--c-cat-1"),
          pointRadius: 5,
          pointHoverRadius: 7,
          order: 0,
        }, ...(showFit ? [{
          type: "line",
          label: "Least-squares fit",
          data: [{ x: 20, y: predict(20) }, { x: 70, y: predict(70) }],
          borderColor: token("--c-cat-1"),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          order: 1,
        }] : [])],
      },
      options: {
        responsive: false,
        animation: false,
        devicePixelRatio: screenPixelRatio(),
        layout: { padding: { top: 8, right: 12 } },
        scales: {
          x: { ...axis("Age (years)"), min: 20, max: 70 },
          y: { ...axis("Exercise (hours/week)"), min: 0, max: 9 },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.dataset.type !== "line",
            backgroundColor: token("--bg"),
            borderColor: token("--rule"),
            borderWidth: 1,
            titleColor: token("--fg"),
            bodyColor: token("--fg-2"),
            titleFont: font,
            bodyFont: font,
            displayColors: false,
            padding: 12,
            callbacks: {
              title: (items) => `Age: ${items[0].parsed.x} years`,
              label: (item) => `Exercise: ${item.parsed.y} hours/week`,
            },
          },
        },
      },
    });

    const charts = [
      createChart("age-exercise-chart"),
      createChart("age-exercise-fit-chart", true),
    ];

    const resize = (ratio) => {
      charts.forEach((chart) => {
        chart.options.devicePixelRatio = ratio;
        chart.resize(width, height);
      });
    };

    Reveal.on("resize", () => resize(screenPixelRatio()));
    window.addEventListener("beforeprint", () => resize(3));
    window.addEventListener("afterprint", () => resize(screenPixelRatio()));
  };

  // Use the final fonts for canvas text, including direct links to other slides.
  const start = () => document.fonts.ready.then(createCharts);
  if (Reveal.isReady()) {
    start();
  } else {
    Reveal.on("ready", start);
  }
})();
