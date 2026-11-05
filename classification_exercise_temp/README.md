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

The verification suite covers the specified V-01–V-15 cases, action mapping, actuator response, terrain-corner, transient and grazing contacts, coupled refinement, and a control transition. The frame-rate check verifies the physics API's independence from snapshot consumption; no rendering system is included.

## Flight interface

Start the local server with Python 3.10 or newer:

```sh
python3 classification_exercise_temp/rocket_server.py
```

Open <http://127.0.0.1:8765/>. The server binds only to localhost and has one shared flight session. The scenario uses **illustrative, uncalibrated** values; it is not a flight-hardware model. Start, pause and reset the flight with the buttons. Throttle and gimbal are normalized commands; actual actuator values appear in telemetry. Discrete actions and their hold interval come from the active configuration. Drag the canvas to pan, scroll to zoom, and use Reset camera to restore automatic framing. All critical controls are keyboard operable. With the flight canvas focused, Up/Down adjust throttle, holding Left/Right steers, and Space pauses or resumes; steering is released on blur. The detail inset has its own clearly labelled scale. The trail and vectors are visual aids; vectors use 1 metre per 10 newtons, and velocity uses a one-second scale. Positive angle and gimbal rotate the applied thrust left; the nozzle points the opposite way.

The replay timeline selects authoritative recorded frames. Play, step, and seek do not advance physics. Export saves a `rocket-run-v1` JSON recording; import accepts that schema up to 64 MB for read-only inspection. Replay uses exact recorded frames; the live scene interpolates between received states only when a clearance bound proves the interpolated pose is safe, and contact is shown at the exact recorded pose. The telemetry is the latest recorded snapshot, while the scene can display a slightly delayed interpolated pose. Closing the page or losing the heartbeat pauses the live flight. Reset starts a new run and discards the previous live recording, so export it first if needed.

### Local HTTP interface

All JSON uses SI units and radians. `GET /api/run` returns `{record, lag}`; retrieving it never advances physics. After an initial full response, `GET /api/run?run_id=<id>&after=<sequence>` returns only snapshots after that sequence along with current metadata; the cursor is rejected for an unknown run or a future sequence. A `rocket-run-v1` record contains a configuration snapshot and identifier, initial state, ordered snapshots, accepted control changes, and any terminal event. Each snapshot includes the run ID, sequence, simulation time, full physics state, current command, centre of mass and read-only diagnostics. `lag` is accumulated simulation-time debt in seconds. Commands and controls are `POST` requests containing the current `run_id`:

- `/api/command`: `command_sequence` (strictly increasing) and either `action` (0–9) or normalized `throttle` and `gimbal`. An optional `effective_time` schedules the command at an exact future control boundary; scheduled commands must be submitted in boundary order. The response acknowledges accepted values and effective simulation time. Up to 128 accepted commands may await a control boundary. Commands sharing that boundary are applied in sequence order, with the last one held afterwards.
- `/api/control`: `operation` is `start`, `pause`, or `speed`; the latter also requires `speed` of 0.25, 0.5, 1, 2 or 5.
- `/api/reset`: creates a new ready run. `/api/offline` accepts the current `run_id` and an `actions` array (maximum 10,000), and returns a separate record generated with `simulate()`.

The worker uses fixed physics steps and simulation-time control boundaries. To bound memory without discarding states, a flight stops with a visible capacity event before its recording would exceed 20,000 snapshots; at most 20,000 commands can be accepted. Offline sequences are rejected before generation if their worst-case recording would exceed the same snapshot limit. Wall-clock speed affects pacing only. It accumulates debt rather than skipping steps, and pauses after two seconds without a client heartbeat. Errors are reported explicitly. This is a local, single-user development server, not an authenticated public service. Configuration identifiers cover the serialized numerical parameters, explicit illustrative environment and coefficient definitions, and a SHA-256 hash of the physics module. The Python module's event tolerance and numerical limitations described above also apply to rendered contact.

### Rendering checks

Run the Python suite and the dependency-free JavaScript geometry and packet checks:

```sh
python3 -m unittest discover -s classification_exercise_temp -v
node classification_exercise_temp/test_rendering.js
```

For an optional real-browser check, start the server in another terminal, install a recent Node.js with built-in `WebSocket`, and run `CHROME_PATH=/path/to/chromium node classification_exercise_temp/test_browser.js` (on Windows set `CHROME_PATH` in the shell if Chrome is not in its usual location). The test drives a real flight, keyboard input, pause, replay, contact and high-DPI/responsive layouts, and writes screenshots to the operating system's temporary directory. It resets/uses the shared local session.
