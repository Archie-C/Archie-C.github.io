# Rocket landing physics

`rocket_physics.py` is a dependency-free Python 3.10+ physics module. It has no rendering, controller, or machine-learning dependency. Run the verification suite from the repository root:

```sh
python3 -m unittest discover -s classification_exercise_temp -v
```

## Configuration and use

Construct `Parameters` with values appropriate to the vehicle and flight envelope; `test_rocket_physics.parameters()` is an executable illustration of every required field, using **test-only values**, not a calibrated vehicle. Supply finite, deterministic functions for gravity, density, wind, drag and lift coefficients, and the body-frame centre of pressure. Gravity and density must be nonnegative; drag coefficient must be nonnegative. Coefficient functions must cover the full signed angle range [-π, π] and should be smooth and periodic at its ends; use a model supported by measurement or an explicitly stated approximation in the intended speed and angle-of-attack envelope. The tests use sin(α) for lift purely as a symmetric mathematical example, not a validated aerodynamic model.

Body coordinates are `(right, nose)` in metres relative to a fixed reference on the vehicle. Supply a closed polygon's vertices in order (`hull` does not repeat its first vertex), individual foot contact points, and the engine and dry-centroid locations in that frame. The symmetric cylindrical tank is centred on the body axis. Uniform-density fuel occupies the tank from `tank_bottom` upward, with filled height proportional to remaining fuel. `dry_inertia` is the dry vehicle's centroidal planar moment of inertia. The piecewise-linear terrain consists of increasing `(x, y)` points and is horizontal beyond its endpoints. Hull edges and feet are checked against it, including terrain corners beneath edges.

Create a `State` with centre-of-mass position and velocity, angle, angular rate, fuel mass, actual thrust and actual gimbal. `step(t, state, Command(throttle, gimbal), parameters, h)` advances continuous commands, returning the new state and an optional `Contact` (time, state, world contact point). `simulate(initial, actions, parameters)` yields time-stamped snapshots for discrete actions 0–9, held for `control_interval`, until the action sequence ends or contact occurs. The internal physics step is `timestep`, with shorter segments at control transitions and as needed for actuator stability. Reading or displaying yielded snapshots does not advance the model.

Throttle zero commands engine off; otherwise the commanded thrust is `min_thrust + throttle * (max_thrust - min_thrust)`. The configured low, medium and high throttle levels are strictly increasing positive normalized values. Gimbal commands are normalized; positive is the thrust vector to the left. Both actuators respond continuously with the configured time and rate limits. Fuel exhaustion cuts thrust immediately; no ignition delay or restart limitation is modelled.

## Model and numerical limits

The centre of mass, moment of inertia, force application arms, and forces are recalculated at each RK4 stage. The engine applies effective thrust, with fuel consumption based on actual thrust. Rotation uses the specified effective closure `I * angular_acceleration = torque`; exhaust angular-momentum flux is not separately modelled. The aerodynamic model is low order and omits shocks, plume interactions, and detailed fin effects. It is the caller's responsibility to select a physically defensible envelope and coefficients.

First ground contact terminates the flight; there is no post-impact model. Fuel and actuator crossings are bracketed and located to `event_tolerance` in time. For ground contact, a cubic continuous extension of the RK4 step is searched from the beginning of the step, including for brief or grazing contacts between endpoints. Bounds on hull motion, centre-of-mass shift and terrain slope reject only intervals that cannot contact the terrain on that interpolated trajectory. An unresolved interval at the time tolerance is treated conservatively as contact at its nonpenetrating start: an extremely close near miss can therefore stop the simulation early within that numerical resolution. Event tolerance is a time tolerance, not a spatial one. Like any numerical integration, the interpolated trajectory approximates the continuous equations; choose a timestep appropriate to the dynamics and verify event-time convergence by refinement. The module raises errors for invalid initial states, non-finite derivatives, invalid environmental quantities, and unresolved boundary overshoot; it does not use state clamps to conceal such errors.

The verification suite covers the specified V-01–V-15 cases, action mapping, actuator response, terrain-corner, transient and grazing contacts, coupled refinement, and a control transition. The physics frame-rate check verifies the engine's independence from snapshot consumption; the browser and adapter checks below exercise rendering separately.

## Flight interface

Start the local server with Python 3.10 or newer:

```sh
python3 classification_exercise_temp/rocket_server.py
```

Open <http://127.0.0.1:8765/>. The server binds only to localhost and has one shared flight session. The default is the Falcon 9–inspired engineering model (not flight-certified). Choose a scenario to start a new flight; changing it resets the recording. Set throttle and gimbal before selecting Start flight: the default engine-off scenario reaches first contact in about 6.8 seconds. Once a flight ends, select New flight (or Reset) to prepare another run; export the recording first if you want to keep it. Start, pause and reset the flight with the buttons. Throttle and gimbal are normalized commands; actual actuator values appear in telemetry. Discrete actions and their hold interval come from the active configuration. Drag the canvas to pan, scroll to zoom, and use Reset camera to restore automatic framing. All critical controls are keyboard operable. Up/Down adjust throttle, holding Left/Right steers, and Space starts, pauses or resumes from the flight page, including after clicking the flight controls. Menus, text inputs, replay controls and unrelated buttons retain their normal keyboard behavior; steering is released on blur. The detail inset has its own clearly labelled scale. The trail and vectors are visual aids; vectors use 1 metre per 10 newtons, and velocity uses a one-second scale. Positive angle and gimbal rotate the applied thrust left; the nozzle points the opposite way.

The replay timeline selects authoritative recorded frames. Flight controls are disabled during replay; select Return to live in the flight-controls panel to use them again. Play, step, and seek do not advance physics. Export saves a `rocket-run-v1` JSON recording; import accepts that schema up to 64 MB for read-only inspection. Replay uses exact recorded frames; the live scene interpolates between received states only when a clearance bound proves the interpolated pose is safe, and contact is shown at the exact recorded pose. The telemetry is the latest recorded snapshot, while the scene can display a slightly delayed interpolated pose. Closing the page or losing the heartbeat pauses the live flight. Reset starts a new run and discards the previous live recording, so export it first if needed.

### Local HTTP interface

All JSON uses SI units and radians. `GET /api/run` returns `{record, lag}`; retrieving it never advances physics. After an initial full response, `GET /api/run?run_id=<id>&after=<sequence>` returns only snapshots after that sequence along with current metadata; the cursor is rejected for an unknown run or a future sequence. A `rocket-run-v1` record contains a configuration snapshot and identifier, initial state, ordered snapshots, accepted control changes, and any terminal event. Each snapshot includes the run ID, sequence, simulation time, full physics state, current command, centre of mass and read-only diagnostics. `lag` is accumulated simulation-time debt in seconds. Commands and controls are `POST` requests containing the current `run_id`:

- `/api/command`: `command_sequence` (strictly increasing) and either `action` (0–9) or normalized `throttle` and `gimbal`. An optional `effective_time` schedules the command at an exact future control boundary; scheduled commands must be submitted in boundary order. The response acknowledges accepted values and effective simulation time. Up to 128 accepted commands may await a control boundary. Commands sharing that boundary are applied in sequence order, with the last one held afterwards.
- `/api/control`: `operation` is `start`, `pause`, or `speed`; the latter also requires `speed` of 0.25, 0.5, 1, 2 or 5.
- `/api/reset`: creates a new ready run. `/api/offline` accepts the current `run_id` and an `actions` array (maximum 10,000), and returns a separate record generated with `simulate()`.

The worker uses fixed physics steps and simulation-time control boundaries. To bound memory without discarding states, a flight stops with a visible capacity event before its recording would exceed 20,000 snapshots; at most 20,000 commands can be accepted. Offline sequences are rejected before generation if their worst-case recording would exceed the same snapshot limit. Wall-clock speed affects pacing only. It accumulates debt rather than skipping steps, and pauses after two seconds without a client heartbeat. Errors are reported explicitly. This is a local, single-user development server, not an authenticated public service. Configuration identifiers cover the serialized numerical parameters, versioned environment and coefficient definitions, and a SHA-256 hash of the physics module. The Python module's event tolerance and numerical limitations described above also apply to rendered contact.

### Rendering checks

Run the Python suite and the dependency-free JavaScript geometry and packet checks:

```sh
python3 -m unittest discover -s classification_exercise_temp -v
node classification_exercise_temp/test_rendering.js
```

For an optional real-browser check, start the server in another terminal, install a recent Node.js with built-in `WebSocket`, and run `CHROME_PATH=/path/to/chromium node classification_exercise_temp/test_browser.js` (on Windows set `CHROME_PATH` in the shell if Chrome is not in its usual location). The test drives a real flight, keyboard input, pause, replay, contact and high-DPI/responsive layouts, and writes screenshots to the operating system's temporary directory. It resets/uses the shared local session.


## Falcon 9–inspired coastal profile v1.0

`rocket_calibration.configuration(name)` returns the complete `Parameters` and centre-of-mass `State`; the server, offline simulations and recordings use this same profile. Presets are `demo_descent`, `centred_descent`, `crosswind_diagnostics` and `near_ground_contact`. Only the third uses the deterministic crosswind. These are invented recovery scenarios and are not guaranteed landable. A scenario change creates a fresh run and configuration identifier. Replay displays recorded states and the recorded geometry/environment snapshot, including old recordings; it does not recompute old flights using current defaults.

The profile is a two-dimensional, one-engine recovery-stage approximation, not a flight-certified model or SpaceX flight software. The other eight engines are inactive. Four real legs are reduced to two foot points; out-of-plane tipping is not modelled. A single equivalent tank replaces separate propellant tanks. Fin shapes are decorative; no fin actuator exists. First contact terminates the physics: candidate safe first contact only applies the engineering limits to the initial contact and does not establish survivability or upright stability. Off-pad terrain and visual decor are not surveyed; decorative objects have no collision geometry.

Provenance tags in every configuration snapshot: **P** published in the cited source, **E** chosen engineering approximation, **D** derived. Stage height and diameter are P [S1,S2]; hull details, dry centroid/inertia, feet and tank are E. Dry mass and Isp are E, based on the historical estimated values in [S4]; the nominal historical 411 t capacity is P [S4], not the landing fuel. Thrust is P/D [S1,S3]; actuator limits and settings are E. Gravity and wind are E; sea-level density is P [S5]. The proposed concrete and apron dimensions are P/D [S6], while terrain, elevation and surroundings are E. The 2025 SLC-40 dimensions describe a **proposed design**, not a surveyed built facility.

The aerodynamic functions and centre of pressure are E surrogates, not measured coefficients or predictive CFD. The reference area is 10.5209 m²; effective drag areas are approximately 6.84 m² tail-first and 164.65 m² broadside, versus 178.49 m² projected cylindrical side area. The 8,500 m exponential scale height is E; at 1,000 m it gives approximately 1.089 kg/m³, versus approximately 1.112 kg/m³ in the standard atmosphere, about 2.1% low. The calibration envelope is 0–1,000 m centre-of-mass altitude, 0–130 m/s air-relative speed and |α| ≤ 35°. Telemetry reports excursions without clamping forces and remembers if the envelope was left earlier. An undefined α at zero airspeed is recorded as null.

At 40,000 kg, full thrust/weight is about 2.15 and minimum enabled thrust/weight is about 1.23. Even minimum enabled thrust exceeds weight, so a timed burn is necessary rather than hovering. Fuel exhaustion cuts thrust. The base integration step is 0.01 s, the command hold 0.1 s, and the event tolerance 1e-5 s. Values and estimates are versioned in code; changing assumptions requires a new profile version and renewed verification.

### Trial trajectories

Run `python3 classification_exercise_temp/calibration_trials.py` to reproduce fixed-time continuous-command trials. In each scenario an engine-off and a full-thrust trial were integrated at 0.01 s. Burns start at 5 s for demo, 4 s for centred and crosswind, and immediately for near-ground; gimbal is zero. These are diagnostics, not a controller. On this baseline, engine-off / powered contact times (s) are demo 6.792 / 7.031, centred 5.763 / 6.133, and crosswind 6.238 / 6.743; corresponding contact vertical speeds (m/s) are -129.32 / -95.44, -100.80 / -62.80, and -120.40 / -74.05. All are too fast for candidate-safe contact. Near-ground engine-off contacts at 0.747 s and -9.32 m/s; immediate full thrust instead carries it above the envelope without contact by 30 s. These trial burn times are therefore unsuitable, not proof of scenario infeasibility.

A separate centred diagnostic with full thrust initiated at approximately 2.96 s produces a concrete foot first contact around 8.90 s and -0.65 m/s in the 0.01 s integration (the numerical command switch occurs on the next step). Refining the same timed burn from 0.010 to 0.005 s gives 8.899482 s at both steps and vertical velocities differing by less than 0.001 m/s. This illustrates available deceleration, not robust control or structural safety. In the fixed trials peak aerodynamic force reached roughly 31–157 kN powered (the largest value occurs after near-ground exits the envelope); peak aerodynamic moment reached roughly 0–113 kN m. A 5° gimbal at 845 kN and the initial centre of mass produces a clockwise torque of roughly 1.24 MN m. Realism outside the stated envelope is not claimed.

[S1] [SpaceX Falcon 9](https://www.spacex.com/vehicles/falcon-9/); [S2] [USSF environmental assessment](https://www.vandenberg.spaceforce.mil/Portals/18/documents/Environmental/SpaceX_Falcon%209%20Cadence%20Increase%20Draft%20SEA%20for%20Public%20Review_COMBINED_REDUCED1.pdf); [S3] [Falcon User’s Guide (2021)](https://www.spacex.com/media/falcon-users-guide-2021-09.pdf); [S4] [NASA-hosted historical data sheet](https://sma.nasa.gov/LaunchVehicle/assets/spacex-falcon-9-data-sheet.pdf); [S5] [US Standard Atmosphere 1976](https://ntrs.nasa.gov/api/citations/19760003955/downloads/19760003955.pdf); [S6] [FAA SLC-40 public meeting script](https://www.faa.gov/media/92771).

## Touchdown scoring and evaluation

Every terminal recording includes `scoring`: success, failure reasons, contact time and surface, first geometry, transformed feet, signed foot-midpoint offset, contact-state centre-of-mass velocities and angles, first-foot velocity, normalized errors and a 0–100 score. A missing contact scores zero. Foot velocity includes rotation and is diagnostic only. The recording configuration contains `touchdown-v1.0` and its pad geometry, thresholds, weights and centre reference; these provisional limits describe first contact, not post-impact stability or survivability. The live flight notes show the score and failure reasons. Exported recordings retain all diagnostics.

`rocket_scoring.score_contact(contact, parameters)` scores the authoritative physics event, not a sampled frame. `ScoringConfig` allows an alternative reference or other rules only under a different version identifier; assign a new, unique identifier whenever changing any rule and retain that configuration with results.

Evaluate a fixed set of 12 deterministic cases (the four calibrated scenarios, each at three horizontal offsets) using one discrete-action sequence for all cases:

```sh
printf '[0, 0, 0]' > /tmp/actions.json
python3 classification_exercise_temp/rocket_evaluation.py run /tmp/actions.json /tmp/evaluation.json --name example
python3 classification_exercise_temp/rocket_evaluation.py leaderboard /tmp/evaluation.json
python3 classification_exercise_temp/rocket_evaluation.py leaderboard --sort mean_successful_quality /tmp/evaluation.json
```

Pass multiple evaluation JSON files to the leaderboard to compare submissions. Its default ordering is success rate, then mean successful quality; the alternative sorts by successful quality, then success rate. With no successes quality is `N/A`. Each saved evaluation contains the scenario-set and scoring versions, aggregate metrics, and each case's result with its complete replay in `runs[].replay`. Save a replay object as a JSON file to import it into the flight lab. An exhausted action sequence is a no-contact failure. Evaluation is of the supplied open-loop sequence; it is not a controller benchmark.
