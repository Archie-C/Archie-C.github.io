# Rocket landing expert

The simulator uses a Falcon 9-inspired calibrated model, deterministic physics and the `touchdown-v1.0` first-contact scorer. `ExpertController` selects one of ten discrete actions every 0.10 seconds. Its five-step predictive search and the 0.01-second physics timestep are unchanged; the selected expert achieved 241/300 successful landings in the earlier held-out evaluation.

Install Python 3.10+ and `python3 -m pip install -r requirements.txt`. Generate a CSV with:

```sh
python3 generate_dataset.py --runs 100 --seed 42 --output landings.csv
```

Each independently sampled start varies position, velocity, orientation, rotation, fuel and constant horizontal and vertical wind. Nominal, challenging and extreme ranges are sampled. Runs end at first contact or after 20 seconds; unsuccessful contacts and timeouts remain in the CSV. Each row contains an observation immediately before an expert decision, its action (0–9), and the final run outcome. Run IDs are unique within the file; the seed makes the dataset reproducible. `success` is outcome metadata and must not be used as a controller observation or classifier input.

The twelve observation columns are in SI units (angles in radians): pad-relative horizontal position and centre-of-mass height, horizontal and vertical velocities, orientation, angular velocity, remaining fuel, actual thrust and gimbal, horizontal and vertical wind, and air density. Upward velocity, anticlockwise orientation and leftward thrust deflection are positive.

Start the interactive browser simulator with `python3 rocket_server.py` and open <http://127.0.0.1:8765>. The simulator can export its recordings and import existing `rocket-run-v1` JSON recordings for replay; controller source is not needed for replay.

Run checks with:

```sh
python3 -m unittest test_dataset test_rocket_physics test_scoring test_calibration test_rocket_rendering
node test_rendering.js
```

The regression tests run the expert on 18 previously successful starts and take considerably longer than the other tests. `test_browser.js` is an optional browser end-to-end check; start the server first and supply `CHROME_PATH` if needed.
