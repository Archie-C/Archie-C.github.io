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

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt


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

    data = get("data")
    sample = data.sample(n=2500, random_state=42)
    train_rows = get("train_rows")
    train_sample = np.linspace(0, len(train_rows) - 1, 2000, dtype=int)
    d12_train = get("d12_train")
    x7_train = data["x_7"].to_numpy()[train_rows]
    lag_residual = get("train_residual")
    groups = []
    for positive in [False, True]:
        mask = (d12_train > 0) == positive
        slope, intercept = np.polyfit(x7_train[mask], lag_residual[mask], 1)
        groups.append({
            "positive": positive,
            "slope": float(slope),
            "line": values([[x, slope * x + intercept] for x in [x7_train[mask].min(), x7_train[mask].max()]]),
            "points": values(np.column_stack((x7_train, lag_residual))[train_sample][mask[train_sample]]),
        })

    payload = {
        "source": "exercise_answers/regression_answers.ipynb",
        "sourceCodeSha256": hashlib.sha256("\n".join("".join(c["source"]) for c in notebook["cells"] if c["cell_type"] == "code").encode()).hexdigest(),
        "csvSha256": hashlib.sha256((notebook_path.parent / "data_train.csv").read_bytes()).hexdigest(),
        "features": get("features"),
        "rows": len(data),
        "sample": values(sample[get("features") + ["y"]].to_numpy()),
        "correlations": values(data[get("features") + ["y"]].corr().to_numpy()),
        "history": values(np.column_stack((data.index, data[["x_1", "x_6", "y"]]))[::4]),
        "split": {"start": int(train_rows[0]), "validation": int(get("valid_rows")[0]), "test": int(get("test_rows")[0])},
        "ratio12": float(get("ratio_12")),
        "initialRatio35": float(get("m_inter").ratio_35),
        "ratio35": float(get("ratio_35")),
        "differences": values(np.column_stack((get("d12").loc[sample.index], get("d35").loc[sample.index], sample["y"]))),
        "rbfCentres": values(get("rbf_centres")),
        "rbfWidth": float(get("m_rbf").width),
        "results": get("results"),
        "lagSweep": values(np.column_stack((get("lag_values"), get("lag_errors")))),
        "bestLag": get("best_lag"),
        "lagResiduals": values(np.column_stack((d12_train, lag_residual))[train_sample]),
        "conditionalGroups": groups,
        "ratioSweep": values(np.column_stack((get("ratio_candidates"), get("ratio_errors")))),
        "tunedResiduals": values(np.column_stack((d12_train, get("residual")))[train_sample]),
        "binnedResiduals": values(np.column_stack((get("centres"), get("averages")))),
        "frequencySweep": values(np.column_stack((get("frequencies"), get("frequency_errors")))),
        "bestFrequency": get("best_frequency"),
        "testPredictions": values(np.column_stack((get("y")[get("test_rows")], get("test_pred")))),
        "testMetrics": {"mse": float(get("final_mse")), "r2": float(get("final_r2"))},
    }
    assert min(payload["results"], key=lambda row: row["Validation MSE"]) == payload["results"][-1]
    output = folder / "assets/regression-walkthrough.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Saved {output.name}: {output.stat().st_size:,} bytes, {len(payload['results'])} model comparisons.")


if __name__ == "__main__":
    main()
