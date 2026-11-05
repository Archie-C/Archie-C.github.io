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

First ground contact terminates the flight; there is no post-impact model. Fuel, actuator-boundary and ground crossings bracketed within a step are located to `event_tolerance` in time. Contact is returned on the nonpenetrating side of the bracket. As with sampled event detection generally, a contact that begins and ends between the endpoints of a physics step can be missed; choose the timestep small enough to resolve the fastest motion and terrain features, and check convergence when choosing it. Event tolerance is a time tolerance, not a spatial one. The module raises errors for invalid initial states, non-finite derivatives, invalid environmental quantities, and unresolved boundary overshoot; it does not use state clamps to conceal such errors.

The verification suite covers the specified V-01–V-15 cases, action mapping, actuator response, a terrain-corner contact and a control transition. The frame-rate check verifies the physics API's independence from snapshot consumption; no rendering system is included.
