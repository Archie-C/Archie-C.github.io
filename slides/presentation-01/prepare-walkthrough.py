"""Regenerate the slide charts' data from the regression walkthrough notebook.

Run from any directory with the notebook's Python dependencies installed:
    python slides/presentation-01/prepare-walkthrough.py

Models are fitted in Python, using the notebook unchanged. The browser only
plots the resulting values, so it does not need a second regression solver.
"""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
from random import Random
from statistics import NormalDist

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def independence_example():
    """Illustrative errors with known coefficients, separate from the exercise data."""
    rng = Random(42)
    n, rho = 100, 0.8
    independent = [rng.gauss(0, 1) for _ in range(n)]
    correlated = [rng.gauss(0, 1)]
    for _ in range(n - 1):
        correlated.append(rho * correlated[-1] + (1 - rho**2)**0.5 * rng.gauss(0, 1))

    # A smooth earlier input is omitted from one prediction and included in the other.
    earlier = rng.gauss(0, 1)
    lag_errors = []
    for t in range(2, n + 2):
        noise = rng.gauss(0, 0.25)
        lag_errors.append([t, 1.2 * earlier + noise, noise])
        earlier = 0.92 * earlier + (1 - 0.92**2)**0.5 * rng.gauss(0, 1)

    # Exact finite-sample variance of a mean for stationary Gaussian AR(1) errors.
    independent_sd = (1 / n)**0.5
    correlated_sd = ((n + 2 * sum((n - k) * rho**k for k in range(1, n))) / n**2)**0.5
    distributions = [NormalDist(0, sd) for sd in (independent_sd, correlated_sd)]
    density = [[x / 100, *(distribution.pdf(x / 100) for distribution in distributions)]
               for x in range(-100, 101)]
    rounded = lambda rows: [[round(value, 6) for value in row] for row in rows]
    return {
        "errors": rounded([[t, independent[t], correlated[t]] for t in range(n)]),
        "lagErrors": rounded(lag_errors),
        "meanDensity": rounded(density),
        "meanSd": [independent_sd, correlated_sd],
    }


def main():
    folder = Path(__file__).resolve().parent
    notebook_path = folder / "exercise_answers/regression_answers.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    namespace = {"display": lambda *args, **kwargs: None}
    previous_directory = Path.cwd()
    original_show = plt.show
    try:
        os.chdir(notebook_path.parent)
        plt.show = lambda *args, **kwargs: plt.close("all")
        with contextlib.redirect_stdout(io.StringIO()):
            for cell in notebook["cells"]:
                if cell["cell_type"] == "code":
                    exec(compile("".join(cell["source"]), cell["id"], "exec"), namespace)
    finally:
        plt.show = original_show
        plt.close("all")
        os.chdir(previous_directory)

    def get(name):
        return namespace[name]

    def values(array):
        array = np.asarray(array, dtype=float)
        if not np.isfinite(array).all():
            raise ValueError("Chart data must contain only finite values.")
        return np.round(array, 6).tolist()

    data, train = get("data"), get("train")
    train_rows = get("train_rows")
    sample = train.sample(n=min(2500, len(train)), random_state=42)
    train_sample = np.linspace(0, len(train_rows) - 1, min(2000, len(train_rows)), dtype=int)
    sample_rows = sample.index.to_numpy()
    positions = np.searchsorted(train_rows, sample_rows)
    results = get("results")
    by_name = {row["Model"]: row for row in results}

    def comparisons(names):
        return [{**by_name[name], "label": label} for name, label in names]

    def bins(x, y, n=20):
        centres, means, _ = get("binned_means")(x, y, n_bins=n)
        return values(np.column_stack((centres, means)))

    initial12, initial35 = get("initial_ratio_12"), get("initial_ratio_35")
    diff12 = (train["x_1"] - initial12 * train["x_2"]).to_numpy()
    diff35 = (train["x_3"] - initial35 * train["x_5"]).to_numpy()
    residual_all = get("training_residuals")(get("model_all"), get("X_raw"))
    residual_two = get("training_residuals")(get("model_two"), get("X_two"))
    lag_residual = get("train_residual")

    def residual_panel(x, residual, label):
        return {"label": label, "points": values(np.column_stack((x, residual))[train_sample]),
                "means": bins(x, residual, 30)}

    pairs = []
    for a, b in get("correlated_pairs"):
        scale = get("difference_scales")[(a, b)]
        difference = (train[a] - scale * train[b]).to_numpy()
        pairs.append({"a": a, "b": b, "scale": scale,
                      "correlation": float(get("corr").loc[a, b]),
                      "points": values(np.column_stack((difference, train["y"]))[positions]),
                      "means": bins(difference, train["y"], 25)})

    interaction_trends = []
    for feature in ["x_4", "x_6"]:
        quartiles = get("pd").qcut(train[feature], 4, labels=False).to_numpy()
        interaction_trends.append({"feature": feature, "groups": [
            bins(diff35[quartiles == group], residual_all[quartiles == group], 10)
            for group in range(4)]})

    regions = []
    for feature in get("features"):
        groups = []
        for positive in [False, True]:
            mask = (diff12 > 0) == positive
            x = train[feature].to_numpy()
            groups.append({"positive": positive,
                           "points": values(np.column_stack((x, lag_residual))[train_sample][mask[train_sample]]),
                           "means": bins(x[mask], lag_residual[mask], 12)})
        regions.append({"feature": feature, "groups": groups})

    winner = get("chosen")
    surface = get("scale_search")
    surface = surface[(surface["Square"] == get("chosen_square")) &
                      (surface["Region"] == get("chosen_region"))]
    branch_winners = get("branch_winners").to_dict(orient="records")
    summary_names = [
        ("Training mean", "Training mean"), ("Linear: x_6", "Linear x_6"),
        ("Linear: x_4, x_6", "Linear x_4 + x_6"), ("Linear: all seven", "Linear all seven"),
        ("Quadratic: x_4 and x_6", "Quadratic x_4 + x_6"),
        ("RBF: x_4 and x_6", "RBF x_4 + x_6"),
        ("All seven + square", "All seven + square"),
        ("All seven + current products", "All seven + products"),
        ("All seven + square + current products", "Square + products"),
        ("All seven + earlier difference", "Earlier difference"),
        ("Square + current and delayed products", "Delayed products"),
        ("Delayed branch + conditional x_7", "Conditional x_7, initial scales"),
        ("Selected tuned branch", "Selected tuned branch"),
        ("Tuned branch + sine and cosine", "Sine + cosine"),
    ]
    payload = {
        "source": "exercise_answers/regression_answers.ipynb",
        "sourceCodeSha256": hashlib.sha256("\n".join("".join(c["source"]) for c in notebook["cells"] if c["cell_type"] == "code").encode()).hexdigest(),
        "csvSha256": hashlib.sha256((notebook_path.parent / "data_train.csv").read_bytes()).hexdigest(),
        "features": get("features"), "rows": len(data),
        "sample": values(sample[get("features") + ["y"]]),
        "targetRange": values([train["y"].min(), train["y"].max()]),
        "correlations": values(get("corr")),
        "history": values(np.column_stack((train.index, train[["x_1", "x_6", "y"]]))[::4]),
        "split": {"start": int(train_rows[0]), "validation": int(get("valid_rows")[0]),
                  "test": int(get("test_rows")[0]), "trainCount": len(train_rows),
                  "validCount": len(get("valid_rows")), "testCount": len(get("test_rows"))},
        "pairs": pairs, "scaleRows": get("scale_rows"),
        "initialRatio12": initial12, "initialRatio35": initial35,
        "ratio12": get("ratio_12"), "ratio35": get("ratio_35"),
        "rbfCentres": values(get("rbf_centres")), "rbfWidth": float(get("m_rbf").width),
        "x4Residual": residual_panel(train["x_4"].to_numpy(), residual_two, "x_4"),
        "firstResidual": residual_panel(diff12, residual_all, f"x_1 - {initial12:.2f} x_2"),
        "interactionTrends": interaction_trends,
        "independenceExample": independence_example(),
        "lagSweep": values(np.column_stack((get("lag_values"), get("linear_lag_errors"), get("lag_errors")))),
        "bestLag": get("best_lag"), "bestLinearLag": get("best_linear_lag"),
        "lagResiduals": [residual_panel(diff12, lag_residual, f"x_1 - {initial12:.2f} x_2"),
                         residual_panel(diff35, lag_residual, f"x_3 - {initial35:.2f} x_5")],
        "regions": regions, "regionRange": values([lag_residual.min(), lag_residual.max()]),
        "scaleSurface": surface.to_dict(orient="records"), "branchWinners": branch_winners,
        "chosenSquare": get("chosen_square"), "chosenRegion": get("chosen_region"),
        "tunedResiduals": residual_panel(get("d12_train"), get("residual"), f"x_1 - {get('ratio_12'):.2f} x_2"),
        "binnedResiduals": values(np.column_stack((get("centres"), get("averages")))),
        "frequencySweep": values(np.column_stack((get("frequencies"), get("frequency_errors")))),
        "bestFrequency": get("best_frequency"), "roughFrequency": get("initial_frequency"),
        "roughPeriod": float(2 * np.pi / get("initial_frequency")),
        "delayExample": {"inputs": values(get("delay_demo_inputs")[2:]),
                         "design": values(get("delay_demo_Z")[2:]),
                         "source": values(get("delay_demo")[get("features") + ["y"]])},
        "groups": {
            "baseline": comparisons(summary_names[:4]),
            "nonlinear": comparisons([summary_names[2], summary_names[4], summary_names[5], summary_names[3]]),
            "additions": comparisons([summary_names[3], summary_names[6], summary_names[7], summary_names[8]]),
            "regions": comparisons([(summary_names[10][0], "No region term"),
                                     ("Delayed branch + indicator", "Indicator only")] +
                                    [(f"Delayed branch + conditional {f}", f"Indicator + slope for {f}") for f in get("features")]),
            "ablation": comparisons([("Tuned branch + sine and cosine", "Full selected combination")] +
                                     [(f"Final comparison: without {row['Removed']}", f"Without {row['Removed']}")
                                      for row in get("ablation_rows")[1:]]),
            "summary": comparisons(summary_names),
        },
        "allResults": results, "selectedModel": get("selected_name"),
        "testPredictions": values(np.column_stack((get("y")[get("test_rows")], get("test_pred")))),
        "testMetrics": {"mse": float(get("final_mse")), "r2": float(get("final_r2"))},
    }
    assert min(results, key=lambda row: row["Validation MSE"])["Model"] == payload["selectedModel"]
    assert len(payload["pairs"]) == 6
    output = folder / "assets/regression-walkthrough.json"
    output.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Saved {output.name}: {output.stat().st_size:,} bytes, {len(results)} model comparisons.")


if __name__ == "__main__":
    main()
