window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const token = (name) => styles.getPropertyValue(name).trim();

  const fg = token("--fg");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const bg = token("--bg");
  const rule = token("--rule");

  const class0 = token("--c-cat-2") || "#2C4A7A";
  const class1 = token("--c-cat-1") || "#6B2C5C";
  const boundary = token("--c-cat-3") || "#8B6F47";
  const vector = token("--c-cat-4") || "#52796F";

  const mono = token("--font-mono") || "monospace";

  Chart.defaults.font.family = mono;
  Chart.defaults.color = fg2;

  /*
   * --------------------------------------------------------------------------
   * DATA
   * --------------------------------------------------------------------------
   */

  const rejectedStudents = [
    { x: 32, y: 42 },
    { x: 39, y: 48 },
    { x: 44, y: 38 },
    { x: 47, y: 55 },
    { x: 52, y: 43 },
    { x: 56, y: 51 },
    { x: 58, y: 61 }
  ];

  const admittedStudents = [
    { x: 55, y: 72 },
    { x: 61, y: 67 },
    { x: 65, y: 76 },
    { x: 70, y: 71 },
    { x: 73, y: 82 },
    { x: 80, y: 75 },
    { x: 84, y: 88 }
  ];

  /*
   * --------------------------------------------------------------------------
   * SHARED STYLING
   * --------------------------------------------------------------------------
   */

  const sharedScaleOptions = {
    x: {
      type: "linear",
      min: 25,
      max: 90,
      grid: {
        display: false,
        color: rule,
        tickColor: fg3
      },
      border: {
        color: fg2,
        width: 1
      },
      ticks: {
        stepSize: 10,
        color: fg3,
        font: {
          family: mono,
          size: 11
        }
      },
      title: {
        display: true,
        text: "entrance exam score",
        align: "end",
        color: fg3,
        font: {
          family: mono,
          size: 10,
          weight: "500"
        },
        padding: {
          top: 6
        }
      }
    },

    y: {
      min: 25,
      max: 95,
      grid: {
        color: rule,
        drawTicks: true,
        tickColor: fg3,
        lineWidth: 1
      },
      border: {
        color: fg2,
        width: 1
      },
      ticks: {
        stepSize: 10,
        color: fg3,
        font: {
          family: mono,
          size: 11
        }
      },
      title: {
        display: true,
        text: "interview score",
        align: "end",
        color: fg3,
        font: {
          family: mono,
          size: 10,
          weight: "500"
        },
        padding: {
          bottom: 6
        }
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

    titleFont: {
      family: mono,
      size: 12,
      weight: "600"
    },

    bodyFont: {
      family: mono,
      size: 12
    },

    callbacks: {
      title: (items) => {
        if (!items.length) return "";
        return items[0].dataset.label;
      },

      label: (item) =>
        `exam ${item.parsed.x}, interview ${item.parsed.y}`
    }
  };

  const sharedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 500
    },
    layout: {
      padding: {
        top: 4,
        right: 6,
        bottom: 0,
        left: 0
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: sharedTooltip
    },
    scales: sharedScaleOptions
  };

  /*
   * --------------------------------------------------------------------------
   * HELPERS
   * --------------------------------------------------------------------------
   */

  function decisionBoundaryPoints(
    w1,
    w2,
    w0,
    xMin = 25,
    xMax = 90
  ) {
    if (Math.abs(w2) < 1e-10) {
      const x = -w0 / w1;

      return [
        { x, y: 25 },
        { x, y: 95 }
      ];
    }

    const y1 = -(w1 * xMin + w0) / w2;
    const y2 = -(w1 * xMax + w0) / w2;

    return [
      { x: xMin, y: y1 },
      { x: xMax, y: y2 }
    ];
  }

  function scatterDataset(label, data, colour) {
    return {
      label,
      data,
      pointRadius: 3.8,
      pointHoverRadius: 5,
      pointBackgroundColor: colour,
      pointBorderColor: colour,
      pointBorderWidth: 0
    };
  }

  function boundaryDataset(points) {
    return {
      type: "line",
      label: "Decision boundary",
      data: points,
      borderColor: boundary,
      borderWidth: 1.6,
      pointRadius: 0,
      tension: 0
    };
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 1
   * ADMISSIONS SCATTER
   * --------------------------------------------------------------------------
   */

  const admissionsCanvas =
    document.getElementById("admissionsChart");

  if (admissionsCanvas) {
    new Chart(admissionsCanvas, {
      type: "scatter",

      data: {
        datasets: [
          scatterDataset(
            "Rejected",
            rejectedStudents,
            class0
          ),

          scatterDataset(
            "Admitted",
            admittedStudents,
            class1
          )
        ]
      },

      options: sharedOptions
    });
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 2
   * DECISION BOUNDARY
   *
   * Boundary:
   *
   * 1.2 x1 + 0.8 x2 - 112 = 0
   * --------------------------------------------------------------------------
   */

  const boundaryCanvas =
    document.getElementById("decisionBoundaryChart");

  if (boundaryCanvas) {
    const w1 = 1.2;
    const w2 = 0.8;
    const w0 = -112;

    new Chart(boundaryCanvas, {
      type: "scatter",

      data: {
        datasets: [
          scatterDataset(
            "Rejected",
            rejectedStudents,
            class0
          ),

          scatterDataset(
            "Admitted",
            admittedStudents,
            class1
          ),

          boundaryDataset(
            decisionBoundaryPoints(w1, w2, w0)
          )
        ]
      },

      options: sharedOptions
    });
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 3
   * GEOMETRY OF THE WEIGHT VECTOR
   * --------------------------------------------------------------------------
   */

  const geometryCanvas =
    document.getElementById("decisionGeometryChart");

  if (geometryCanvas) {
    const w1 = 1.2;
    const w2 = 0.8;
    const w0 = -112;

    /*
     * Pick one point on the decision boundary.
     */
    const baseX = 60;
    const baseY = -(w1 * baseX + w0) / w2;

    const weightVectorArrow = {
      id: "weightVectorArrow",
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;

        const xScale = scales.x;
        const yScale = scales.y;
        const startX = xScale.getPixelForValue(baseX);
        const startY = yScale.getPixelForValue(baseY);

        // Find the boundary's direction in screen space so the arrow stays
        // perpendicular even when the plot's x and y scales differ.
        const [edgeA, edgeB] = decisionBoundaryPoints(w1, w2, w0);
        const lineDx = xScale.getPixelForValue(edgeB.x) - xScale.getPixelForValue(edgeA.x);
        const lineDy = yScale.getPixelForValue(edgeB.y) - yScale.getPixelForValue(edgeA.y);
        const lineLength = Math.hypot(lineDx, lineDy);
        if (!lineLength) return;

        // The positive normal points up and to the right for this boundary.
        const normalX = lineDy / lineLength;
        const normalY = -lineDx / lineLength;
        const arrowLength = 48;
        const endX = startX + normalX * arrowLength;
        const endY = startY + normalY * arrowLength;
        const headLength = 8;
        const headAngle = Math.PI / 7;

        ctx.save();
        ctx.strokeStyle = vector;
        ctx.fillStyle = vector;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - headLength * Math.cos(Math.atan2(normalY, normalX) - headAngle),
          endY - headLength * Math.sin(Math.atan2(normalY, normalX) - headAngle)
        );
        ctx.lineTo(
          endX - headLength * Math.cos(Math.atan2(normalY, normalX) + headAngle),
          endY - headLength * Math.sin(Math.atan2(normalY, normalX) + headAngle)
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };

    new Chart(geometryCanvas, {
      type: "scatter",

      data: {
        datasets: [
          scatterDataset(
            "Rejected",
            rejectedStudents,
            class0
          ),

          scatterDataset(
            "Admitted",
            admittedStudents,
            class1
          ),

          boundaryDataset(
            decisionBoundaryPoints(w1, w2, w0)
          )
        ]
      },

      options: {
        ...sharedOptions,

        plugins: {
          ...sharedOptions.plugins,

          tooltip: {
            ...sharedTooltip,

            callbacks: {
              title: (items) => {
                if (!items.length) return "";

                return items[0].dataset.label;
              },

              label: (item) => {
                if (
                  item.dataset.label ===
                  "Weight vector"
                ) {
                  return "w is perpendicular to the boundary";
                }

                return `exam ${item.parsed.x}, interview ${item.parsed.y}`;
              }
            }
          }
        }
      },

      plugins: [weightVectorArrow]
    });
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 5
   * LINEARLY SEPARABLE DATA
   * --------------------------------------------------------------------------
   */

  const separableCanvas =
    document.getElementById("linearlySeparableChart");

  if (separableCanvas) {
    const classA = [
      { x: 1.0, y: 1.5 },
      { x: 1.4, y: 2.0 },
      { x: 1.8, y: 1.2 },
      { x: 2.2, y: 2.4 },
      { x: 2.5, y: 1.7 },
      { x: 2.8, y: 2.6 }
    ];

    const classB = [
      { x: 4.6, y: 4.2 },
      { x: 5.0, y: 5.2 },
      { x: 5.4, y: 4.6 },
      { x: 5.8, y: 5.6 },
      { x: 6.2, y: 4.9 },
      { x: 6.6, y: 5.8 }
    ];

    new Chart(separableCanvas, {
      type: "scatter",

      data: {
        datasets: [
          scatterDataset(
            "Class 0",
            classA,
            class0
          ),

          scatterDataset(
            "Class 1",
            classB,
            class1
          ),

          {
            type: "line",
            label: "Separating boundary",
            data: [
              { x: 1, y: 6 },
              { x: 7, y: 0 }
            ],
            borderColor: boundary,
            borderWidth: 1.6,
            pointRadius: 0,
            tension: 0
          }
        ]
      },

      options: {
        ...sharedOptions,

        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 8,
            grid: {
              display: false
            },
            border: {
              color: fg2,
              width: 1
            },
            ticks: {
              stepSize: 1,
              color: fg3,
              font: {
                family: mono,
                size: 11
              }
            },
            title: {
              display: true,
              text: "x₁",
              align: "end",
              color: fg3,
              font: {
                family: mono,
                size: 10
              }
            }
          },

          y: {
            min: 0,
            max: 7,
            grid: {
              color: rule
            },
            border: {
              color: fg2,
              width: 1
            },
            ticks: {
              stepSize: 1,
              color: fg3,
              font: {
                family: mono,
                size: 11
              }
            },
            title: {
              display: true,
              text: "x₂",
              align: "end",
              color: fg3,
              font: {
                family: mono,
                size: 10
              }
            }
          }
        }
      }
    });
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 6
   * NON-LINEARLY SEPARABLE DATA
   * --------------------------------------------------------------------------
   */

  const nonSeparableCanvas =
    document.getElementById(
      "nonLinearlySeparableChart"
    );

  if (nonSeparableCanvas) {
    const innerClass = [
      { x: 3.5, y: 3.6 },
      { x: 4.0, y: 4.1 },
      { x: 4.3, y: 3.5 },
      { x: 3.8, y: 4.5 },
      { x: 4.5, y: 4.2 }
    ];

    const outerClass = [
      { x: 1.0, y: 1.2 },
      { x: 1.3, y: 6.2 },
      { x: 2.3, y: 2.0 },
      { x: 2.0, y: 5.8 },
      { x: 5.8, y: 1.5 },
      { x: 6.4, y: 5.9 },
      { x: 5.5, y: 5.1 },
      { x: 6.6, y: 2.6 }
    ];

    new Chart(nonSeparableCanvas, {
      type: "scatter",

      data: {
        datasets: [
          scatterDataset(
            "Class 0",
            innerClass,
            class0
          ),

          scatterDataset(
            "Class 1",
            outerClass,
            class1
          )
        ]
      },

      options: {
        ...sharedOptions,

        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 8,
            grid: {
              display: false
            },
            border: {
              color: fg2,
              width: 1
            },
            ticks: {
              stepSize: 1,
              color: fg3,
              font: {
                family: mono,
                size: 11
              }
            },
            title: {
              display: true,
              text: "x₁",
              align: "end",
              color: fg3,
              font: {
                family: mono,
                size: 10
              }
            }
          },

          y: {
            min: 0,
            max: 7,
            grid: {
              color: rule
            },
            border: {
              color: fg2,
              width: 1
            },
            ticks: {
              stepSize: 1,
              color: fg3,
              font: {
                family: mono,
                size: 11
              }
            },
            title: {
              display: true,
              text: "x₂",
              align: "end",
              color: fg3,
              font: {
                family: mono,
                size: 10
              }
            }
          }
        }
      }
    });
  }

  /*
   * --------------------------------------------------------------------------
   * FIGURE 4
   * INTERACTIVE DECISION BOUNDARY
   * --------------------------------------------------------------------------
   */

  const interactiveCanvas =
    document.getElementById(
      "interactiveBoundaryChart"
    );

  if (interactiveCanvas) {
    const interactiveChart = new Chart(
      interactiveCanvas,
      {
        type: "scatter",

        data: {
          datasets: [
            scatterDataset(
              "Rejected",
              rejectedStudents,
              class0
            ),

            scatterDataset(
              "Admitted",
              admittedStudents,
              class1
            ),

            boundaryDataset(
              decisionBoundaryPoints(
                1.2,
                0.8,
                -112
              )
            )
          ]
        },

        options: {
          ...sharedOptions,

          animation: false
        }
      }
    );

    const w1Slider =
      document.getElementById("w1Slider");

    const w2Slider =
      document.getElementById("w2Slider");

    const w0Slider =
      document.getElementById("w0Slider");

    const w1Value =
      document.getElementById("w1Value");

    const w2Value =
      document.getElementById("w2Value");

    const w0Value =
      document.getElementById("w0Value");

    function updateBoundary() {
      if (
        !w1Slider ||
        !w2Slider ||
        !w0Slider
      ) {
        return;
      }

      const w1 =
        Number(w1Slider.value);

      const w2 =
        Number(w2Slider.value);

      const w0 =
        Number(w0Slider.value);

      if (w1Value) {
        w1Value.textContent =
          w1.toFixed(1);
      }

      if (w2Value) {
        w2Value.textContent =
          w2.toFixed(1);
      }

      if (w0Value) {
        w0Value.textContent =
          w0.toFixed(0);
      }

      interactiveChart.data.datasets[2].data =
        decisionBoundaryPoints(
          w1,
          w2,
          w0
        );

      interactiveChart.update("none");
    }

    [
      w1Slider,
      w2Slider,
      w0Slider
    ].forEach((slider) => {
      if (slider) {
        slider.addEventListener(
          "input",
          updateBoundary
        );
      }
    });

    updateBoundary();
  }
});
