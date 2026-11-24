# Classification model progression

Each numbered Python file is a standalone, NumPy-only `Controller` compatible with the exercise interface. All eight are generated from the same template and differ only in the switches at the top of the file (`CLASS_WEIGHTS`, `OPTIMIZER`, `PROJECTION`, `GRAVITY`, `DRAG`, `THRUST`, `HORIZONTAL`). Stage-specific version numbers prevent accidentally loading another stage's weights. Each stage adds to the preceding one:

1. `01_flight_split.py`: the scaffold with the normalization fix (statistics fitted during training and reused for validation and prediction), trained with gradient descent on a flight-level split. `fit(X, y, run_ids=ids)` performs an internal 80/20 flight split; with explicit validation arrays the caller is responsible for splitting by flight.
2. `02_class_weighted.py`: inverse-frequency class weights fitted from the training partition only, applied to the cross-entropy gradient and training loss. Validation loss remains unweighted.
3. `03_lbfgs.py`: the same features and weighted loss, but trained with L-BFGS and an L2 penalty `0.5 * l2 * ||W||²` on every weight except the bias, instead of gradient descent with early stopping.
4. `04_constant_velocity.py`: adds projected height, vertical speed, angle and angular speed at 1, 2 and 3 seconds with constant velocities.
5. `05_gravity.py`: includes gravity in those projections.
6. `06_drag.py`: adds velocity-dependent drag, wind and drag torque, recalculated at each integration step.
7. `07_thrust.py`: adds measured current thrust and gimbal to the projected force and torque.
8. `08_horizontal.py`: branches from stage 6 (drag, *without* stage 7's thrust) and also projects horizontal position `x` (pad centre is `x = 0`) and horizontal velocity `vx` at the same 1, 2 and 3 second horizons, giving six projected quantities per horizon instead of four.

Stages 3–8 use L-BFGS. The L-BFGS implementation is in NumPy (two-loop recursion over the last 10 updates, with an Armijo backtracking line search), so the controllers still run where only NumPy is available, such as the browser.

All stages share one interface. `epochs` is the maximum number of weight updates (gradient steps, or L-BFGS iterations). Early stopping is used when validation data is available and `patience` is not `None`: training stops after `patience` epochs without the validation loss improving by more than `min_delta`, and the best weights are restored. Gradient-descent stages default to `patience=50`; L-BFGS stages default to `patience=None`, so they run to convergence and are regularised by `l2` alone. `fit` returns a history dict (also stored as `model.history_`):

```python
history = model.fit(X_train, y_train, X_val, y_val)
history['train_loss'], history['validation_loss']   # losses for the starting weights and after every update
history['validation_metrics']                       # accuracy, macro_f1, per_class_f1, rows (returned weights)
history['best_epoch']                               # the epoch whose weights were returned
history['stopped_epoch'], history['stop_reason']    # 'early_stopping', 'converged' or 'max_epochs'
```

## Shared experiment settings

`experiment.py` holds everything that decides which model is trained: the flight-level split (`flight_split`, seed 42), the hyperparameter grids and fixed settings, and the selection rule. `example.ipynb`, `train_models.py` and `tune_and_evaluate.py` all import it, so the notebook trains the same models that `tuned_results/summary.md` reports.

- Gradient-descent stages (01, 02) search ten learning rates from 3 to 0.01 (log spaced) with `epochs=10000, patience=20, min_delta=1e-3`.
- L-BFGS stages (03 onwards) search `l2` in `(0, 1e-4, 1e-3, 1e-2, 1e-1)` with up to 1,000 iterations and no early stopping.
- The candidate with the highest macro F1 on the validation (tuning) flights is kept.

`grid_search(Controller, X_train, y_train, X_val, y_val)` runs one stage's search and returns the per-candidate rows, the full histories and the selected model.

## Train

From this directory:

```sh
python train_models.py
python train_models.py --model 04_constant_velocity
```

The default input is the exercise's `landings.csv`; use `--data PATH` to change it. The script uses the shared split and search, and writes one weights file per selected model and `metrics.json` (validation and held-out test accuracy and macro F1, the selected hyperparameter and every candidate) to `results/` (override with `--output`). Keep the test partition for final comparisons and use validation for tuning; repeated model selection on test scores makes the test optimistic. No landing success is implied by classification metrics.

To train one directly, use `experiment.load_stage(4)` (or load the file as a module) and call `Controller(...).fit(train_X, train_y, validation_X, validation_y)`, followed by `save(path)`. Input columns are `x, y, vx, vy, theta, omega, fuel_mass, actual_thrust, actual_gimbal, wind_x, wind_y, air_density`, in that order. Any stage can instead use `fit(X, y, run_ids=ids)` for an internal 80/20 flight split.

## Trajectory assumptions

The four projected quantities are appended to the 12 raw observations. Integration uses 0.25-second steps with acceleration fixed within each step. Height is centre-of-mass height relative to the pad. A flat-pad hull/foot clearance calculation approximates first contact; when a step crosses the ground, the state is interpolated to contact and held for subsequent horizons. This is a feature approximation, not the simulator's exact contact solver or a prediction of a safe landing.

Drag uses two-dimensional air-relative velocity, the exercise's angle-dependent drag coefficient and force application point. Lift and angular damping are deliberately omitted, to keep the drag stage interpretable. The drag rollout updates horizontal speed for its effect on airspeed; only stage 8 also reports horizontal position. Terrain is not modelled. Density, wind, fuel mass, inertia, current thrust and gimbal are fixed over each rollout. Thrust is zero when fuel is empty; it is the *observed* physical thrust in newtons, not a candidate future action. The simulator changes mass and forces over time, so these features are approximate and become less reliable over longer horizons.

Normalization, split corrections, class weights and the optimiser alone do not count as the exercise's required informed feature changes. The trajectory stages are a basis for further feature engineering; check the exercise's submission requirements separately.

## Tuned models and validation flights

`tune_and_evaluate.py` produces the tuned weights, `results.json` and `summary.md` in `tuned_results/`. Run it from the repository root using the repository's Python environment:

```sh
.venv/Scripts/python -u courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise/model_progression/tune_and_evaluate.py
```

Add `--model 08_horizontal` (repeatable) to tune only selected stages; their entries are merged into the existing `results.json` provided it used the same data, split and search. Use `--output DIR` to write elsewhere.

Each stage is tuned with `experiment.grid_search` on the shared training and tuning flights. The selected weights are saved in the standalone controller's normal format, and every candidate (hyperparameter, epochs run, stop reason, losses and tuning metrics), the split IDs, the data and the source hashes are recorded in `results.json`.

After selection, the script measures expert-action agreement on the 1,095 labelled observations in `validation_runs.csv`, then runs the actual closed-loop simulator on each of its ten starting flights. The original scaffold normalization bug is also evaluated as the stage-1 weights with single-observation inputs reduced to zero. `results.json` records each flight's first-contact outcome, score, failure reasons and diagnostics. Validation and training contain no exactly matching observations. Validation run IDs are local to their own file and should not be used to infer overlap with training run IDs.

The results are a small, fixed evaluation set: landing counts can change by 10 percentage points with a single flight, and the labelled observations within a flight are correlated. The evaluation reports all attempted flights, with zero landing score for failures. It does not establish generalization to unseen distributions. The held-out test flights were not used for these comparisons.

Generate the exercise 2 slide deck from the recorded results with `python make_slides.py`. The deck alternates the explanation of each change with its measured validation difference, including regressions. The slide generator requires completed results for stages 1–7; stage 8 is not part of the deck.
