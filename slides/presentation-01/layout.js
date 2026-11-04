/* Shared sizing for this deck's Chart.js canvases and an opt-in bounds audit.
   Open ?check-layout to measure every slide after fonts, maths and plots load. */
(() => {
  "use strict";
  const entries = [];
  let scheduled = false;
  let auditing = false;

  function dimensions(element, fallback) {
    return element.clientWidth > 0 && element.clientHeight > 0
      ? [element.clientWidth, element.clientHeight]
      : fallback;
  }

  function fitMath(root = document.querySelector(".reveal > .slides")) {
    root.querySelectorAll(".katex-display").forEach((display) => {
      if (!display.clientWidth) return;
      display.style.fontSize = "";
      const math = display.querySelector(".katex-html");
      if (!math) return;
      const available = display.getBoundingClientRect().width;
      const width = math.getBoundingClientRect().width;
      if (width > available + 1) {
        const size = parseFloat(getComputedStyle(display).fontSize);
        display.style.fontSize = `${size * available / width * 0.99}px`;
      }
    });
  }

  function refresh() {
    scheduled = false;
    if (auditing) return;
    fitMath();
    entries.forEach(({ chart, element, fallback }) => {
      if (!element.clientWidth || !element.clientHeight) return;
      const [width, height] = dimensions(element, fallback);
      if (Math.abs(chart.width - width) > 1 || Math.abs(chart.height - height) > 1) chart.resize(width, height);
    });
  }

  function schedule() {
    if (!scheduled && !auditing) {
      scheduled = true;
      requestAnimationFrame(refresh);
    }
  }

  // Measure live slides, including all fragments, at their actual 1280 x 720
  // layout size. Preserve navigation and styles, then restore the current view.
  async function audit() {
    await document.fonts.ready;
    const slideRoot = document.querySelector(".reveal > .slides");
    const slides = [...slideRoot.children].filter((element) => element.tagName === "SECTION");
    const reveal = slideRoot.parentElement;
    const rootStyle = slideRoot.getAttribute("style");
    const revealStyle = reveal.getAttribute("style");
    const failures = [];
    const chartAreas = [];
    const crampedCharts = [];
    const restore = (element, original) => original === null ? element.removeAttribute("style") : element.setAttribute("style", original);
    auditing = true;
    reveal.style.cssText += ";position:fixed;width:1280px;height:720px;left:0;top:0;transform:none;";
    slideRoot.style.cssText += ";width:1280px;height:720px;position:absolute;left:0;top:0;transform:none;zoom:1;";
    try {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const style = slide.getAttribute("style");
        slide.style.cssText += ";display:block;position:absolute;left:0;top:0;width:1280px;height:720px;transform:none;";
        fitMath(slide);
        const boundary = slide.getBoundingClientRect();
        const out = [];
        for (const element of slide.querySelectorAll("*")) {
          if (element.closest("aside.notes, .katex-mathml") || ["SCRIPT", "STYLE"].includes(element.tagName)) continue;
          if (getComputedStyle(element).display === "none" || !element.getClientRects().length) continue;
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const overflow = Math.max(boundary.left - box.left, boundary.top - box.top, box.right - boundary.right, box.bottom - boundary.bottom);
          if (overflow > 1) out.push({ element: element.tagName.toLowerCase(), text: element.textContent.trim().slice(0, 90), overflow: Math.round(overflow * 10) / 10 });
          if (["P", "H1", "H2", "PRE", "TH", "TD"].includes(element.tagName) && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2) {
            out.push({ element: element.tagName.toLowerCase(), text: element.textContent.trim().slice(0, 90), overflow: element.scrollWidth - element.clientWidth, reason: "text exceeds its box" });
          }
        }
        for (const entry of entries.filter(({ element }) => slide.contains(element))) {
          const [width, height] = dimensions(entry.element, entry.fallback);
          entry.chart.resize(width, height);
          const area = entry.chart.chartArea;
          if (area) {
            const measurement = { slide: i + 1, chart: entry.element.dataset.walkChart || entry.element.querySelector("canvas")?.id,
              width: Math.round(area.width), height: Math.round(area.height) };
            chartAreas.push(measurement);
            const minimumHeight = entry.element.closest(".walk-history") ? 65 : entry.element.closest(".walk-six, .walk-eight") ? 90 : 130;
            if (area.width < 140 || area.height < minimumHeight) crampedCharts.push(measurement);
          }
        }
        if (out.length) failures.push({ slide: i + 1, title: slide.querySelector("h1,h2")?.textContent, elements: out });
        restore(slide, style);
      }
    } finally {
      restore(slideRoot, rootStyle);
      restore(reveal, revealStyle);
      auditing = false;
      Reveal.layout();
      schedule();
    }
    const report = { slides: slides.length, overflow: failures, crampedCharts, chartAreas };
    window.slideLayoutReport = report;
    console.info("Slide layout audit", report);
    return report;
  }

  const observer = new ResizeObserver(schedule);
  window.SlideLayout = {
    dimensions,
    register(chart, element, fallback) { entries.push({ chart, element, fallback }); observer.observe(element); schedule(); },
    refresh: schedule,
    audit,
  };

  const ready = () => {
    Reveal.on("slidechanged", schedule);
    Reveal.on("resize", schedule);
    new MutationObserver(schedule).observe(document.querySelector(".reveal > .slides"), { childList: true, subtree: true });
    document.fonts.ready.then(schedule);
    if (new URLSearchParams(location.search).has("check-layout")) {
      const check = async () => {
        if (document.documentElement.dataset.walkthroughReady !== "true" || !document.querySelector(".katex")) {
          if (document.documentElement.dataset.walkthroughReady === "error") return;
          setTimeout(check, 100);
          return;
        }
        await document.fonts.ready;
        const report = await audit();
        const panel = document.createElement("div");
        panel.setAttribute("role", "status");
        panel.style.cssText = "position:fixed;inset:auto 16px 16px auto;z-index:1000;max-width:560px;padding:16px;background:var(--bg);color:var(--fg);border:2px solid var(--accent);font:16px/1.4 monospace;";
        panel.textContent = report.overflow.length || report.crampedCharts.length
          ? `${report.overflow.length} slides overflow; ${report.crampedCharts.length} chart areas need more space. Details: window.slideLayoutReport in the console.`
          : `Checked all ${report.slides} slides, including fragments: nothing crosses a slide boundary.`;
        document.body.append(panel);
      };
      check();
    }
  };
  window.addEventListener("beforeprint", () => entries.forEach(({ chart, element, fallback }) => {
    chart.options.devicePixelRatio = 3;
    chart.resize(...dimensions(element, fallback));
  }));
  window.addEventListener("afterprint", () => {
    entries.forEach(({ chart }) => { chart.options.devicePixelRatio = 2; });
    schedule();
  });
  if (Reveal.isReady()) ready();
  else Reveal.on("ready", ready);
})();
