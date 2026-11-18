# Classification model progression

Each numbered Python file is a standalone, NumPy-only `Controller` compatible with the exercise interface. Train and save weights for each file separately; stage-specific version numbers prevent accidentally loading another stage's weights. Each stage adds to the preceding one:

1. `01_normalization.py`: the original scaffold, corrected so normalization is fitted during training and reused for validation and prediction. It otherwise keeps the scaffold's optimizer and unweighted loss.
2. `02_flight_split.py`: the same raw-observation softmax model, with an optional flight-level training/validation split when `run_ids` is supplied to `fit`. With explicit validation arrays, the caller is responsible for splitting by flight. Without either, it trains on all supplied rows.
3. `03_class_weighted.py`: inverse-frequency class weights fitted from the training partition only, applied to the cross-entropy gradient and training loss. Validation loss remains unweighted.
4. `04_constant_velocity.py`: adds projected height, vertical speed, angle and angular speed at 1, 2 and 3 seconds with constant velocities.
5. `05_gravity.py`: includes gravity in those projections.
6. `06_drag.py`: adds velocity-dependent drag, wind and drag torque, recalculated at each integration step.
7. `07_thrust.py`: adds measured current thrust and gimbal to the projected force and torque.

Stages 2–7 have identical training and inference interfaces. The first model retains the scaffold interface. The only difference between the first two models is the **data partition**, not the representation or learning rule; if they are given the same already-split data, their learned predictions should match apart from numerical rounding. The provided comparison deliberately gives *all* stages the same flight split, to make later comparisons fair. To study the original row-split mistake itself, run stage 1 using the original notebook's row split, then compare it to stage 2 trained on a flight split; note that the evaluation partitions differ, so their scores do not isolate model quality.

## Train

From this directory, or from anywhere with the path adjusted:

```sh
python train_models.py --epochs 2000 --learning-rate 0.01
python train_models.py --model 04_constant_velocity --epochs 2000
```

The default input is the exercise's `landings.csv`; use `--data PATH` to change it. The script assigns whole `run_id`s to train/validation/test (approximately 80/10/10 by flight), using `--seed 42` by default, and writes one weights file per selected model and `metrics.json` to `results/` (override with `--output`). Metrics report row-level accuracy and macro F1 for validation and test; the saved flight IDs make the split inspectable. Keep the test partition for final comparisons and use validation for tuning; repeated model selection on test scores makes the test optimistic. No landing success is implied by classification metrics.

To train one directly, load its file as a module and call `Controller(...).fit(train_X, train_y, validation_X, validation_y)`, followed by `save(path)`. Input columns are `x, y, vx, vy, theta, omega, fuel_mass, actual_thrust, actual_gimbal, wind_x, wind_y, air_density`, in that order. Stages 2–7 can instead use `fit(X, y, run_ids=ids)` for an internal 80/20 flight split. The online runner supplies `run_ids` when it supports that argument; stage 1 intentionally keeps the original scaffold's no-internal-split behavior.

## Trajectory assumptions

The four projected quantities are appended to the 12 raw observations. Integration uses 0.25-second steps with acceleration fixed within each step. Height is centre-of-mass height relative to the pad. A flat-pad hull/foot clearance calculation approximates first contact; when a step crosses the ground, the state is interpolated to contact and held for subsequent horizons. This is a feature approximation, not the simulator's exact contact solver or a prediction of a safe landing.

Drag uses two-dimensional air-relative velocity, the exercise's angle-dependent drag coefficient and force application point. Lift and angular damping are deliberately omitted, to keep the drag stage interpretable. The drag rollout updates horizontal speed for its effect on airspeed but does not use horizontal position or terrain. Density, wind, fuel mass, inertia, current thrust and gimbal are fixed over each rollout. Thrust is zero when fuel is empty; it is the *observed* physical thrust in newtons, not a candidate future action. The simulator changes mass and forces over time, so these features are approximate and become less reliable over longer horizons.

Normalization, split corrections and class weights alone do not count as the exercise's required informed feature changes. The trajectory stages are a basis for further feature engineering; check the exercise's submission requirements separately.

## Tuned models and validation flights

`tune_and_evaluate.py` produces the tuned weights and `results.json` in `tuned_results/`. Run it from the repository root using the repository's Python environment (with NumPy and SciPy):

```sh
.venv/Scripts/python -u courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise/model_progression/tune_and_evaluate.py
```

For each stage, it trains three L-BFGS softmax fits with L2 penalties 0, 0.001 and 0.01, selecting by macro F1 on an internal tuning partition. The first model uses a random-row split to represent the original workflow. Later models use a common, flight-level split. The selected weights are saved in the standalone controller's normal format. The per-candidate optimizer status, iteration count, split IDs, data and source hashes are recorded in `results.json`; a fit may reach its iteration limit before convergence. The unweighted first stage and weighted later stages optimize their respective cross-entropy objectives. These saved fits were trained with L-BFGS rather than each file's built-in gradient-descent `fit()` routine.

After selection, the script measures expert-action agreement on the 1,095 labelled observations in `validation_runs.csv`, then runs the actual closed-loop simulator on each of its ten starting flights. The original scaffold normalization bug is also evaluated as the same stage-1 weights with single-observation inputs reduced to zero. `results.json` records each flight's first-contact outcome, score, failure reasons and diagnostics. Validation and training contain no exactly matching observations. Validation run IDs are local to their own file and should not be used to infer overlap with training run IDs.

The results are a small, fixed evaluation set: landing counts can change by 10 percentage points with a single flight, and the labelled observations within a flight are correlated. The evaluation reports all attempted flights, with zero landing score for failures. It does not establish generalization to unseen distributions, and comparisons between the row-split and flight-split stages change the training examples as well as the tuning protocol. The separate test dataset was not used for these comparisons.

Generate the exercise 2 slide deck from the recorded results with `python make_slides.py`. The deck alternates the explanation of each change with its measured validation difference, including regressions. The slide generator requires completed results for all seven stages.
