# Rocket landing expert

The simulator uses a Falcon 9-inspired calibrated model, deterministic physics and the `touchdown-v1.0` first-contact scorer. `ExpertController` selects one of ten discrete actions every 0.10 seconds. Its five-step predictive search and the 0.01-second physics timestep are unchanged; the previous expert achieved 241/300 successful landings in an earlier held-out evaluation.

Install Python 3.10+ and `python3 -m pip install -r requirements.txt`. Generate a CSV with:

```sh
python3 generate_dataset.py --runs 100 --seed 42 --output landings.csv
```

Landings run in parallel by default, using up to the available CPU count. Use
`--workers 4` to choose a process count, or `--workers 1` for serial execution.
For the same seed and run count, the output is identical regardless of worker
count. Parallel execution uses more CPU and memory; the best speedup depends on
the machine and number of runs.
The terminal reports completed runs, successful landings, elapsed time, and
the final row count; progress messages are limited to roughly one every five
seconds, plus the first and last completed run.

Each independently sampled start varies position, velocity, orientation, rotation, fuel and constant horizontal and vertical wind. Nominal, challenging and extreme ranges are sampled. Runs end at first contact or after 20 seconds; unsuccessful contacts and timeouts remain in the CSV. Each row contains an observation immediately before an expert decision, its action (0–9), and the final run outcome. Run IDs are unique within the file; the seed makes the dataset reproducible. `success` is outcome metadata and must not be used as a controller observation or classifier input.

The twelve observation columns are in SI units (angles in radians): pad-relative horizontal position and centre-of-mass height, horizontal and vertical velocities, orientation, angular velocity, remaining fuel, actual thrust and gimbal, horizontal and vertical wind, and air density. Upward velocity, anticlockwise orientation and leftward thrust deflection are positive.

Start the interactive browser simulator with `python3 rocket_server.py` and open <http://127.0.0.1:8765>. The simulator can export its recordings and import existing `rocket-run-v1` JSON recordings for replay; controller source is not needed for replay.

To try a controller, choose a trusted Python file in **Run a controller**. The local server creates its `Controller` class, calls `fit(X, y)` with the twelve observation columns and action labels from `landings.csv`, and evaluates a fresh copy of the fitted controller on each of the ten initial states and constant winds in `test_runs.csv`. It calls `predict_action(observation)` at each control interval and ends each flight at contact or after 20 seconds. The results include a replay for each of the first two runs. The uploaded Python runs with the server user's permissions, so only run code you trust; the separate process is not a security sandbox.

`test_runs.csv` accepts either ten saved initial-state rows or a full dataset
from `generate_dataset.py --runs 10`: the evaluator uses each run's `step=0`
row as its initial state. Action classification metrics still use `test_landings.csv`.

The results show measured signed velocities, tilt, angular velocity and landing-foot midpoint offset at first contact, or at the time limit when there is no contact. The diagnostic score applies only at valid first contact: `100 * sum(weight / (1 + abs(measurement) / reference))`. The five weights are 0.30, 0.15, 0.20, 0.15 and 0.20 for vertical velocity, horizontal velocity, tilt, angular velocity and midpoint offset; the references are 3 m/s, 1.5 m/s, 4 degrees, 2 degrees/s and 33.672 m respectively. It provides a gradient for failed landings but does not assess contact geometry or encode the full pass criteria. The displayed mean excludes flights without a valid contact. The versioned `touchdown-v1.0` success and score remain unchanged.

Action accuracy and macro F1 compare `predict_action` with expert action labels in `test_landings.csv`. Macro F1 weights each action present in the targets or predictions equally. The page reports test observations that exactly match training observations; overlapping data is not an independent evaluation. These metrics measure action agreement, not landing success.

Controllers may implement `reset()` to clear flight history. Evaluation calls it at the start of each flight and at run or step boundaries in the test CSV. If a controller's `fit` method explicitly accepts `run_ids` or `steps`, the evaluator supplies those training CSV columns. The example controller uses them to construct consecutive-observation features without crossing flight boundaries; without run IDs, training treats each observation as a separate first step. Its history differences assume the simulator's 0.1-second control interval. `predict_action` maintains history, whereas batch `predict` treats each row as a first observation.

Run checks with:

```sh
python3 -m unittest test_dataset test_rocket_physics test_scoring test_calibration test_rocket_rendering
node test_rendering.js
```

To measure landing success and contact failure reasons on reproducible sampled
starts, run `python benchmark_expert.py --runs 30 --seed 42001 --workers 4`.
Add `--output results.json` to save the per-flight outcomes and final
pre-decision observations. This benchmark uses the same 20-second limit as
dataset generation.

In paired tests of the current expert against the previous version, the
current version landed 27/30 versus 22/30 starts (seed 42001), 25/30 versus
25/30 (seed 72002), and 53/60 versus 48/60 (seed 91041). These samples do not
guarantee success on other starts; fuel, pad position, and the time limit can
still prevent a landing.

The regression tests run the expert on 18 previously successful starts and take considerably longer than the other tests. `test_browser.js` is an optional browser end-to-end check; start the server first and supply `CHROME_PATH` if needed.
