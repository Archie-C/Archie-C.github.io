# Tuned progression: validation results

Models were selected using an internal tuning split, then evaluated on the separate validation dataset: 1,095 labelled observations from 10 flights. All flight results are closed-loop runs; failed flights contribute zero to mean landing score. See results.json for every flight, hyperparameter candidate and optimizer status.

| Model | Accuracy | Macro F1 | Successful flights | Mean score | Selected L2 | Iterations |
|---|---:|---:|---:|---:|---:|---:|
| Original scaffold prediction | 67.0% | 8.0% | 0/10 | 0.0/100 | same as stage 1 | same as stage 1 |
| 01_normalization | 78.4% | 20.4% | 1/10 | 9.1/100 | 0.0 | 300 |
| 02_flight_split | 78.5% | 21.3% | 1/10 | 8.1/100 | 0.0 | 300 |
| 03_class_weighted | 45.7% | 27.8% | 4/10 | 30.8/100 | 0.0 | 300 |
| 04_constant_velocity | 50.2% | 28.7% | 7/10 | 63.5/100 | 0.0 | 300 |
| 05_gravity | 55.4% | 34.7% | 8/10 | 72.5/100 | 0.0 | 300 |
| 06_drag | 54.4% | 33.7% | 9/10 | 80.4/100 | 0.0 | 300 |
| 07_thrust | 58.2% | 31.6% | 0/10 | 0.0/100 | 0.0 | 300 |

The first model uses a row-level training/tuning split; the others use a flight-level split. The slide deck compares each stage with its predecessor, so the split comparison also changes the training data. Several fits reached the iteration limit. These results describe this small validation set, not a guarantee of future landing performance.
