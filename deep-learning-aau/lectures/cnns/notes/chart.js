    window.addEventListener("DOMContentLoaded", () => {

      // centred rectangle: width 1, centred at 0
      const rect = x => (Math.abs(x) <= 0.5 ? 1 : 0);

      const xs = Array.from({ length: 400 }, (_, i) => -2 + i * 0.01);

      const f = xs.map(x => rect(x));

      const t = 0.3; // slide parameter
      const g_shifted = xs.map(x => rect(t - x)); // flipped + shifted

      // triangle centred at 0
      const conv = xs.map(x => {
        if (Math.abs(x) < 1) return 1 - Math.abs(x);
        return 0;
      });

      new Chart(document.getElementById("convolution-chart"), {
        type: "line",
        data: {
          labels: xs,
          datasets: [
            {
              label: "f(τ)",
              data: f,
              borderColor: "blue",
              pointRadius: 0
            },
            {
              label: "g(t - τ)",
              data: g_shifted,
              borderColor: "red",
              pointRadius: 0
            },
            {
              label: "(f * g)(t)",
              data: conv,
              borderColor: "green",
              pointRadius: 0
            }
          ]
        },
        options: {
          elements: { line: { tension: 0 } },
          scales: {
            x: { type: "linear" },
            y: { min: 0, max: 1.2 }
          }
        }
      });

    });