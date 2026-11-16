# Rocket regression exercise

The Python `Controller` class implements `predict_action(observation)`, returning `(thrust, gimbal)`: finite normalized values in `[0, 1]` and `[-1, 1]`. The observation contains the 12 values listed on the exercise page. Optional `load(path)` loads uploaded weights. Browser evaluation uses four simulator scenarios.

## Continuous MPC expert

`rocket_expert.py` supplies an expert with the same interface. It replans every 0.1 seconds, optimizing coast time, burn duration, and eight pairs of continuous thrust/gimbal controls. A variable-mass nonlinear prediction model includes gravity, drag, lift, engine torque, aerodynamic torque and fuel consumption. RK4 rollouts and batched complex-step derivatives support a bounded SciPy least-squares solver. The previous plan supplies the next solve's initial guess.

The objective prioritizes a centred, upright touchdown at 0.3 m/s, with small fuel, duration and control-smoothness penalties. Soft penalties discourage premature ground contact, excessive tilt and fuel exhaustion. The engine-off phase is separate from the powered phase because any positive thrust command produces at least the calibrated minimum thrust. Ignition is rounded to the preceding simulation command boundary.

This is a locally optimized MPC expert, not a proof of global optimality. Its search assumes one coast phase followed by one powered landing burn, instantaneous actuators, the current calibrated atmosphere/aerodynamics and locally constant measured wind. Path penalties are sampled at prediction nodes; they are not hard collision guarantees. The authoritative simulator determines first contact and landing success. `diagnostics` reports solver convergence, cost, evaluation count and scaled terminal error; reaching the solver's evaluation budget can return an approximate plan.

From this directory, install the expert's dependencies and evaluate it:

```sh
python -m pip install -r requirements-expert.txt
python rocket_expert.py
python -m unittest test_expert.py
```

The default command prints results without saving flight recordings. Select scenarios with repeated `--scenario` options. To generate fresh regression demonstrations, a report, and recordings explicitly:

```sh
python rocket_expert.py --random-runs 100 --seed 42 --dataset /path/to/landings.csv --report /path/to/report.json --replays /path/to/replays
```

Random starts vary position, velocity, tilt, angular rate, fuel and constant wind. A seed makes these starts reproducible. The CSV contains `run_id`, `step`, the 12 observation columns, continuous targets `thrust` and `gimbal`, and the final flight `success` flag. `run_id`, `step` and `success` are metadata rather than model inputs. Failed flights are retained with `success=0`; the command returns a nonzero exit code if any flight fails. No classification datasets or prerecorded flights are bundled.

For local simulation, use `expert.command` with `evaluate_closed_loop(..., control_mode='continuous')`. For the exercise upload, use `rocket_expert.py` directly; the browser worker loads NumPy and SciPy. Browser timing depends on the machine; the native solver is intended primarily for generating expert demonstrations offline.

Validation on the four predefined scenarios produced four successful landings scoring 99.60–99.70/100. Solver time was approximately 2–19 seconds per complete flight in the tested native Python environment. Six additional starts with varied position, velocity, attitude, fuel and wind also landed successfully, scoring 99.47–99.69/100. These results characterize the tested starts, not all possible initial states.

## Dataset generator

`generate_dataset.py` now defaults to a stratified mixture of flight phases. Generate a fresh dataset separately from any older batch:

```sh
python generate_dataset.py --runs 1000 --seed 42 --output landings-varied.csv
```

Every seed-shuffled block of 20 flights has the following composition. Height means clearance above the lowest foot, accounting for centre of mass and tilt.

| Profile | Flights | Initial clearance | Fuel | Purpose |
| --- | --- | --- | --- | --- |
| Descent | 20% | 330–900 m | 7,000–14,000 kg | Wider high-altitude conditions |
| Mid-flight | 20% | 70–360 m | 4,000–11,000 kg | Intermediate states, including running engines |
| Approach | 25% | 1–80 m | 2,000–6,500 kg | Near-ground and low-fuel coverage |
| Recovery | 20% | 65–320 m | 3,500–10,000 kg | Larger tilt, angular-rate and lateral-velocity errors |
| Crosswind | 15% | 330–900 m | 7,000–14,000 kg | Stronger winds and the calibrated altitude-dependent crosswind |

Positions extend to ±60 m and horizontal speeds to ±11 m/s on high descents. Recovery tilt extends to ±0.16 rad and angular rate to ±0.05 rad/s. Lower starts use correlated, smaller velocity bounds. Approach heights use logarithmic sampling to represent the final few metres. Initial engine states include both engine-off and powered states with varied thrust and gimbal angle.

Wind varies across flights and during flights: constant winds with horizontal components up to ±8.5 m/s, the calibrated altitude-dependent crosswind, and smooth gusts with randomized phase, period, vertical component and height shear. The observations contain the actual instantaneous wind experienced by the simulator. The expert continues replanning against the latest measured wind.

Starts are checked for positive hull/foot clearance, estimated vertical stopping distance, fuel margin, and lateral recovery margin near the pad. These are feasibility estimates, not guarantees of successful landings. Gusts and perturbed recovery starts deliberately make demonstrations more challenging.

Mixed generation uses `DatasetExpert` from `rocket_data_expert.py`. It retains the original nonlinear MPC but chooses a reachable location within the pad for short approaches, derives that goal from the current observation, and allows an engine-off coast if thrust reverses descent. A modest thrust penalty preserves powered steering time. This avoids the original one-burn expert's tendency to climb away from some short or disturbed approaches. The original `Controller` remains the expert for legacy sampling.

The CSV format is unchanged from the continuous-control generator:

```text
run_id,step,x,y,vx,vy,theta,omega,fuel_mass,actual_thrust,actual_gimbal,wind_x,wind_y,air_density,thrust,gimbal,success
```

`thrust` and `gimbal` are normalized commands in `[0, 1]` and `[-1, 1]`. `actual_thrust` and `actual_gimbal` remain physical actuator observations in newtons and radians. Use the 12 observation columns as inputs and `[thrust, gimbal]` as the two regression outputs. `success` is the final landing outcome repeated on the whole flight; failed landings are retained with `success=0`. A controller error stops generation instead of publishing an incomplete flight. Split training and validation by whole `run_id` values, and use separate seeds for independently generated test sets.

The accompanying `landings-varied.metadata.json` records each flight's profile, scenario, initial state, constant wind or gust parameters, score, row count and timings. It also records the mixture recipe version, source hashes, dependency versions and committed CSV byte offsets/hashes. Each run's initial conditions depend only on seed and run ID. Existing files and any batch already running with the old sampler are preserved. Old uniform data cannot be resumed into this mixed distribution; start a new output file.

Resume or extend the new dataset with the same settings:

```sh
python generate_dataset.py --runs 1000 --seed 42 --output landings-varied.csv --resume
```

Resume verifies completed data, preserves whole flights, and removes uncommitted trailing bytes. Changed sampling mode, model, seed, sources or numerical settings are rejected. Increasing `--runs` extends a matching dataset. Use `--sampling legacy` to reproduce the original sampling family in a fresh file. Custom flat JSON bounds via `--ranges bounds.json` require `--sampling legacy`; mixed sampling uses the phase-specific recipes above.

The command-line generator runs up to four flights concurrently, capped by available CPU count. Choose another positive count with `--workers N`; the Python API defaults to `workers=1`. Numerical-library threads are limited to one per worker. At most twice the worker count is submitted ahead, workers return only CSV bytes and summaries, and the parent commits results in run order. Worker count can change on resume. Cancellation terminates outstanding worker jobs and retains committed flights. Replay files are not written.

The parallel execution layer previously reduced a four-flight legacy benchmark from 82.1 to 37.6 seconds with byte-for-byte identical CSV output. Mixed-profile throughput depends on flight length and difficulty. The MPC integration cadence and physics/contact resolution remain unchanged.

```sh
python -m unittest test_generate_dataset.py test_sampling.py test_data_expert.py
```
