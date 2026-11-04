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


  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart, args, options) {
      if (!options.enabled) return;
      chart.ctx.save();
      chart.ctx.font = `15px ${font.family}`;
      chart.ctx.fillStyle = token("--fg");
      chart.ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        chart.ctx.fillText(chart.data.datasets[0].data[i].toFixed(3), bar.x + 7, bar.y);
      });
      chart.ctx.restore();
    },
  };

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
      plugins: [referenceLines, valueLabels],
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

    if (container.closest(".walk-six, .walk-eight, .walk-history")) {
      for (const name of ["x", "y"]) {
        chart.options.scales[name].ticks.font = { ...font, size: 12 };
        chart.options.scales[name].ticks.maxTicksLimit = 4;
        chart.options.scales[name].title.font = { ...font, size: 13 };
      }
      chart.update("none");
    }
    SlideLayout.register(chart, container, [Number(container.dataset.width), Number(container.dataset.height)]);
    container.querySelector(".walk-chart-status").textContent = "";
    return chart;
  }


  function bars(container, results, logarithmic = false) {
    const values = results.map((row) => row["Validation MSE"]);
    return create(container, [{
      label: "Validation MSE", data: values,
      backgroundColor: values.map((value) => value === Math.min(...values) ? colours[0] : `${colours[1]}aa`),
      borderWidth: 0, barPercentage: 0.72,
    }], "Validation MSE (lower is better)", "", {
      type: "bar", indexAxis: "y",
      scales: {
        x: { ...axis("Validation MSE (lower is better)"), type: logarithmic ? "logarithmic" : "linear",
          ...(logarithmic ? {} : { beginAtZero: true }),
          max: logarithmic ? 10 ** Math.ceil(Math.log10(Math.max(...values)) + 0.1) : Math.max(...values) * 1.18 },
        y: { ...axis(""), type: "category", labels: results.map((row) => row.label), grid: { display: false },
          ticks: { color: token("--c-label"), font: { ...font, size: results.length > 10 ? 15 : 19 } } },
      },
      plugins: { valueLabels: { enabled: true } },
    });
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


  function table(holder, headers, rows, decorate) {
    const table = document.createElement("table");
    table.className = "walk-table";
    const head = document.createElement("thead");
    const top = document.createElement("tr");
    headers.forEach((text) => { const th = document.createElement("th"); th.scope = "col"; th.textContent = text; top.append(th); });
    head.append(top); table.append(head);
    const body = document.createElement("tbody");
    rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.forEach((text, c) => { const td = document.createElement("td"); td.textContent = text; decorate?.(td, r, c); tr.append(td); });
      body.append(tr);
    });
    table.append(body); holder.replaceChildren(table);
  }

  function scaleMap(data) {
    const holder = document.querySelector("[data-walk-scale]");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 560 460");
    svg.setAttribute("class", "walk-scale-map");
    const add = (name, attrs, text) => {
      const node = document.createElementNS(ns, name);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      if (text !== undefined) node.textContent = text;
      svg.append(node); return node;
    };
    const xs = [...new Set(data.scaleSurface.map((r) => r.c35))].sort((a,b) => a-b);
    const ys = [...new Set(data.scaleSurface.map((r) => r.c12))].sort((a,b) => a-b);
    const logs = extent(data.scaleSurface.map((r) => Math.log10(r["Validation MSE"])));
    data.scaleSurface.forEach((row) => {
      const selected = row.c12 === data.ratio12 && row.c35 === data.ratio35;
      const fraction = (Math.log10(row["Validation MSE"]) - logs[0]) / (logs[1] - logs[0]);
      const rect = add("rect", { x: 64 + xs.indexOf(row.c35)*34, y: 26 + ys.indexOf(row.c12)*34,
        width: 34, height: 34, fill: mix(colours[0], token("--bg-2"), fraction),
        stroke: selected ? colours[1] : token("--bg"), "stroke-width": selected ? 3 : 0.5 });
      const title = document.createElementNS(ns, "title"); title.textContent = `c12=${row.c12}; c35=${row.c35}; validation MSE=${row["Validation MSE"].toFixed(4)}`; rect.append(title);
    });
    xs.forEach((value,i) => add("text", {x:81+i*34, y:422, "text-anchor":"middle"}, value.toFixed(2)));
    ys.forEach((value,i) => add("text", {x:54, y:48+i*34, "text-anchor":"end"}, value.toFixed(2)));
    add("text", {x:250,y:450,"text-anchor":"middle"}, "c35 (scale applied to x_5)");
    add("text", {x:64,y:16}, "c12");
    add("text", {x:448,y:125}, "Darker"); add("text", {x:448,y:147}, "is better");
    add("text", {x:448,y:185}, "Log MSE");
    holder.replaceChildren(svg);
  }

  function fillTables(data) {
    document.querySelectorAll("[data-walk-table]").forEach((holder) => {
      const name = holder.dataset.walkTable;
      if (name === "scales") {
        table(holder, ["Pair", "Input r", "Mean ratio", "Slope"], data.scaleRows.map((row) =>
          [row.Pair, row["Input correlation"].toFixed(4), row["Initial scale"].toFixed(2), row["Fitted slope"].toFixed(3)]));
      } else if (name === "branches") {
        const regions = ["none", "indicator", ...data.features];
        const best = Math.min(...data.branchWinners.map((r) => r["Validation MSE"]));
        const rows = regions.map((region) => [region === "none" ? "No region term" : region === "indicator" ? "Indicator" : `Slope for ${region}`,
          ...[false,true].map((square) => data.branchWinners.find((r) => r.Region === region && r.Square === square)["Validation MSE"].toFixed(3))]);
        table(holder, ["Best after tuning", "No square", "Square"], rows,
          (td,r,c) => { if (c > 0 && Number(rows[r][c]) === Number(best.toFixed(3))) td.classList.add("walk-best"); });
      } else if (name === "delay-inputs") {
        const rows = data.delayExample.source.map((row,t) => [t,row[2],row[4],row[3],row[5],
          ...(t < 2 ? ["missing","missing","missing"] : [data.delayExample.source[t-2][2],data.delayExample.source[t-2][4],data.delayExample.source[t-2][2]-2*data.delayExample.source[t-2][4]]),row[7]]);
        table(holder, ["Row t","x₃,t","x₅,t","x₄,t","x₆,t","x₃,t−2","x₅,t−2","dₜ₋₂","Target yₜ"], rows,
          (td,r,c) => { if (c>=1 && c<=4) td.classList.add("walk-current"); if(c>=5&&c<=7) td.classList.add("walk-earlier"); if(c===8)td.classList.add("walk-target"); if(r<2&&c>=5&&c<=7)td.classList.add("walk-missing"); if((r===1&&[1,2].includes(c))||(r===3&&c>=5)) td.classList.add("walk-trace"); });
      } else if (name === "delay-design") {
        const rows = data.delayExample.design.map((row,i) => [i+2,1,`[${row.slice(1,8).join(", ")}]`,...row.slice(8),data.delayExample.source[i+2][7]]);
        table(holder, ["Row t","1","7 current columns","qₜ²","dₜx₄,t","dₜx₆,t","dₜ₋₂x₄,t","dₜ₋₂x₆,t","Target yₜ"], rows,
          (td,r,c) => { if(c>=2&&c<=5)td.classList.add("walk-current"); if(c===6||c===7)td.classList.add("walk-earlier"); if(c===8)td.classList.add("walk-target"); if(r===1&&c>=6)td.classList.add("walk-trace"); });
      } else throw new Error(`Unknown walkthrough table: ${name}`);
    });
  }

  function render(data) {
    heatmap(data); scaleMap(data); fillTables(data);
    document.querySelectorAll("[data-walk-value]").forEach((node) => {
      const value = node.dataset.walkValue.split(".").reduce((obj,key) => obj[key], data);
      node.textContent = node.dataset.digits === undefined ? value.toLocaleString() : Number(value).toFixed(Number(node.dataset.digits));
    });
    const targetRange = data.targetRange;
    const sharedTarget = { y: { ...axis("y"), min: Math.floor(targetRange[0]/10)*10, max: Math.ceil(targetRange[1]/10)*10 } };
    const targetColours = data.sample.map((row) => {
      const fraction = (row[7]-targetRange[0])/(targetRange[1]-targetRange[0]);
      return fraction < 0.5 ? mix(colours[1],token("--c-seq-2"),fraction*2) : mix(token("--c-seq-2"),colours[0],(fraction-0.5)*2);
    });
    const residual = (container, panel, scales={}) => create(container,
      [points(xy(panel.points)),line(xy(panel.means),{borderColor:colours[4],pointRadius:2,label:"Binned mean residual"})],
      panel.label,"Training residual",{scales,plugins:{walkReferenceLines:{zero:true}}});
    containers.forEach((container) => {
      const name = container.dataset.walkChart;
      const number = Number(name.split("-").at(-1));
      if (name.startsWith("raw-")) {
        create(container,[points(xy(data.sample,number,7),{pointRadius:1.4})],data.features[number],"y",{scales:sharedTarget});
      } else if (name.startsWith("history-")) {
        create(container,[line(xy(data.history,0,number+1),{borderWidth:1.2})],number===2?"Original row index":"","",{
          scales:{x:{...axis(number===2?"Original row index":""),min:data.split.start,max:data.split.validation}}});
      } else if (data.groups[name]) {
        bars(container,data.groups[name],["summary","ablation"].includes(name));
      } else if (name === "x4-residual") {
        residual(container,data.x4Residual);
      } else if (name === "rbf") {
        const minimum=data.rbfCentres[0]-2*data.rbfWidth, maximum=data.rbfCentres.at(-1)+2*data.rbfWidth;
        create(container,data.rbfCentres.map((centre,i)=>line(Array.from({length:140},(_,j)=>{
          const x=minimum+(maximum-minimum)*j/139; return {x,y:Math.exp(-0.5*((x-centre)/data.rbfWidth)**2)};
        }),{borderColor:colours[i],label:`Centre ${centre.toFixed(1)}`})),"x_4","Basis value");
      } else if (name.startsWith("pair-")) {
        const pair=data.pairs[number];
        create(container,[points(xy(data.sample,data.features.indexOf(pair.b),data.features.indexOf(pair.a)),{pointRadius:1.6,backgroundColor:targetColours})],pair.b,pair.a);
      } else if (name.startsWith("difference-")) {
        const pair=data.pairs[number];
        create(container,[points(xy(pair.points),{pointRadius:1.3}),line(xy(pair.means),{borderColor:colours[4],pointRadius:2,label:"Binned mean target"})],
          `${pair.a} − ${pair.scale.toFixed(2)} ${pair.b}`,"y",{scales:sharedTarget});
      } else if (name === "first-residual") {
        residual(container,data.firstResidual);
      } else if (name.startsWith("interaction-")) {
        const panel=data.interactionTrends[number];
        const comparable=data.interactionTrends.flatMap((p)=>p.groups.flat());
        const xRange=extent(comparable.map((r)=>r[0]));
        const yRange=extent(comparable.map((r)=>r[1]));
        create(container,panel.groups.map((rows,i)=>line(xy(rows),{borderColor:colours[i],pointRadius:3,label:`Quartile ${i+1}`})),
          `x_3 − ${data.initialRatio35.toFixed(2)} x_5`,"Mean training residual",{
            scales:{x:{...axis(`x_3 − ${data.initialRatio35.toFixed(2)} x_5`),min:xRange[0],max:xRange[1]},
                    y:{...axis("Mean training residual"),min:yRange[0],max:yRange[1]}},
            plugins:{legend:{display:true,position:"top",labels:{font:{...font,size:12},boxWidth:16,padding:8}},walkReferenceLines:{zero:true}}});
      } else if (["errors-independent", "errors-correlated", "errors-lag-omitted", "errors-lag-included"].includes(name)) {
        const example = data.independenceExample;
        const lagged = name.startsWith("errors-lag-");
        const rows = lagged ? example.lagErrors : example.errors;
        const column = ["errors-independent", "errors-lag-omitted"].includes(name) ? 1 : 2;
        const limit = Math.ceil(Math.max(...rows.flatMap((row) => row.slice(1).map(Math.abs))));
        create(container, [line(xy(rows, 0, column), { borderColor: colours[column - 1], borderWidth: 1.6, pointRadius: 2 })],
          "Observation order", "Error", {
            scales: { x: { ...axis("Observation order"), min: rows[0][0], max: rows.at(-1)[0] },
              y: { ...axis("Error"), min: -limit, max: limit } },
            plugins: { walkReferenceLines: { zero: true } },
          });
      } else if (name === "errors-mean") {
        create(container, [
          line(xy(data.independenceExample.meanDensity, 0, 1), { label: "Independent", borderWidth: 3 }),
          line(xy(data.independenceExample.meanDensity, 0, 2), { label: "Positively correlated", borderColor: colours[1], borderWidth: 3, borderDash: [7, 4] }),
        ], "Average error across 100 observations", "Probability density", {
          scales: { y: { ...axis("Probability density"), beginAtZero: true } },
          plugins: { legend: { display: true, position: "top", labels: { font: { ...font, size: 15 }, boxWidth: 24 } } },
        });
      } else if (name === "lag") {
        const baseline=data.allResults.find((r)=>r.Model==="Linear: all seven")["Validation MSE"];
        create(container,[line(xy(data.lagSweep,0,1),{pointRadius:3,label:"All seven + earlier difference"}),
          line(xy(data.lagSweep,0,2),{pointRadius:3,borderColor:colours[1],label:"Square + current and delayed products"}),
          line([{x:0,y:baseline},{x:25,y:baseline}],{borderColor:colours[2],borderDash:[5,5],label:"All-seven baseline"})],
          "Delay (observations earlier)","Validation MSE",{plugins:{legend:{display:true,position:"top",labels:{font:{...font,size:16},boxWidth:24}},walkReferenceLines:{selected:data.bestLag}}});
      } else if (name.startsWith("lag-residual-")) {
        const range=extent(data.lagResiduals.flatMap((p)=>p.points.map((r)=>r[1])));
        residual(container,data.lagResiduals[number],{y:{...axis("Training residual"),min:range[0],max:range[1]}});
      } else if (name.startsWith("region-")) {
        const panel=data.regions[number];
        create(container,panel.groups.flatMap((group,i)=>[
          points(xy(group.points),{backgroundColor:`${colours[i]}44`,pointRadius:1.2}),
          line(xy(group.means),{borderColor:colours[i],pointRadius:2,label:group.positive?"d12 > 0":"d12 <= 0"})]),
          panel.feature,"Residual",{scales:{y:{...axis("Residual"),min:data.regionRange[0],max:data.regionRange[1]}},plugins:{walkReferenceLines:{zero:true}}});
      } else if (name === "tuned-residual") {
        const range=extent(data.tunedResiduals.points.map((r)=>r[0]));
        residual(container,data.tunedResiduals,{x:{...axis(data.tunedResiduals.label),min:range[0],max:range[1]}});
      } else if (name === "binned") {
        const range=extent(data.tunedResiduals.points.map((r)=>r[0]));
        create(container,[line(xy(data.binnedResiduals),{pointRadius:3})],data.tunedResiduals.label,"Mean residual (zoomed)",{
          scales:{x:{...axis(data.tunedResiduals.label),min:range[0],max:range[1]}},plugins:{walkReferenceLines:{zero:true}}});
      } else if (name === "frequency") {
        const baseline=data.allResults.find((r)=>r.Model==="Selected tuned branch")["Validation MSE"];
        create(container,[line(xy(data.frequencySweep),{pointRadius:2,label:"With sine + cosine"}),
          line([{x:data.frequencySweep[0][0],y:baseline},{x:data.frequencySweep.at(-1)[0],y:baseline}],{borderColor:colours[2],borderDash:[5,5],label:"Without periodic pair"})],
          "Angular frequency (radians per unit)","Validation MSE",{plugins:{legend:{display:true,position:"top",labels:{font:{...font,size:13},boxWidth:20}},walkReferenceLines:{selected:data.bestFrequency}}});
      } else if (name === "test-predictions") {
        const range=extent(data.testPredictions.flat());
        create(container,[points(xy(data.testPredictions)),line(range.map((x)=>({x,y:x})),{borderColor:colours[1],borderDash:[5,5]})],"Observed y","Predicted y");
      } else if (name === "test-residuals") {
        create(container,[points(data.testPredictions.map(([observed,predicted])=>({x:predicted,y:observed-predicted})))],
          "Predicted y","Test residual",{plugins:{walkReferenceLines:{zero:true}}});
      } else throw new Error(`Unknown walkthrough chart: ${name}`);
    });
    Reveal.layout();
    document.documentElement.dataset.walkthroughReady = "true";
  }

  async function start() {
    try {
      const [response]=await Promise.all([fetch("./assets/regression-walkthrough.json"),document.fonts.ready]);
      if(!response.ok)throw new Error(`Chart data request failed (${response.status}).`);
      render(await response.json());
    } catch(error) {
      console.error("Regression walkthrough:",error);
      document.documentElement.dataset.walkthroughReady="error";
      document.querySelectorAll(".walk-chart-status").forEach((node)=>{
        if(node.textContent)node.textContent="Chart unavailable. Serve the deck over HTTP and reload.";
      });
    }
  }
  if(Reveal.isReady())start();else Reveal.on("ready",start);
})();
