"""Build teaching figures from the saved controllers; never retrain them.

Run from the repository root with the environment containing NumPy, SciPy and
Matplotlib. The paired flight is replayed with the same conditions as results.json;
its terminal measurements and the action metrics must reproduce that record.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from practical_figures import build_figures

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXERCISE = ROOT / 'courses/deep-learning-aau/topics/02-classification/exercises/practical-exercise'
MODELS = EXERCISE / 'model_progression'
sys.path[:0] = [str(MODELS), str(EXERCISE)]
from train_models import load_data, metrics
from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import State
from run_uploaded_controller import read_validation_runs

OUT = HERE / 'assets'
INK, MUTED, PURPLE, GRID = '#15120B', '#6B6149', '#6B2C5C', '#DCD2BC'
plt.rcParams.update({'font.family': 'sans-serif', 'font.sans-serif': ['Arial', 'DejaVu Sans'], 'font.size': 15,
                     'text.color': INK, 'axes.labelcolor': INK,
                     'xtick.color': MUTED, 'ytick.color': MUTED,
                     'svg.fonttype': 'none', 'svg.hashsalt': 'classification-practical'})


def figure(rows=1, cols=1, height=4):
    fig, axes = plt.subplots(rows, cols, figsize=(11, height), layout='constrained', squeeze=False)
    fig.patch.set_alpha(0)
    for ax in axes.flat:
        ax.set_facecolor('none')
        ax.spines[['top', 'right']].set_visible(False)
        ax.grid(axis='y', color=GRID)
        ax.set_axisbelow(True)
    return fig, axes


def save(fig, name):
    fig.savefig(OUT / name, transparent=True, metadata={'Date': None})
    plt.close(fig)


def controller(name):
    path = MODELS / f'{name}.py'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Controller().load(MODELS / 'tuned_results' / f'{name}.npz')


def main():
    OUT.mkdir(exist_ok=True)
    recorded = json.loads((MODELS / 'tuned_results/results.json').read_text())
    for filename, key in [('landings.csv', 'training_sha256'), ('validation_runs.csv', 'validation_sha256')]:
        actual = hashlib.sha256((EXERCISE / filename).read_bytes()).hexdigest()
        if actual != recorded[key]:
            raise ValueError(f'{filename} has changed since the recorded comparison')
    ids, _, y = load_data(EXERCISE / 'landings.csv')
    _, val_x, val_y = load_data(EXERCISE / 'validation_runs.csv')
    mask = np.isin(ids, recorded['split']['group_training_flight_ids'])
    counts = np.bincount(y[mask], minlength=10)
    fig, axs = figure()
    ax = axs[0, 0]
    ax.bar(np.arange(10), counts / counts.sum() * 100, color=PURPLE)
    ax.set(xlabel='Expert action', ylabel='Share of training rows (%)', xticks=np.arange(10))
    for i, n in enumerate(counts):
        ax.text(i, 100*n/counts.sum()+.7, f'{100*n/counts.sum():.1f}%', ha='center', fontsize=12)
    ax.set_ylim(0, max(counts/counts.sum()*100)+8)
    save(fig, 'action-frequency.svg')
    data = {'training_counts': counts.tolist(), 'training_rows': int(mask.sum()),
            'source_results_sha256': hashlib.sha256((MODELS / 'tuned_results/results.json').read_bytes()).hexdigest(),
            'models': {}}
    per_class = {}
    for name in ['02_flight_split', '03_class_weighted', '04_constant_velocity', '05_gravity', '06_drag', '07_thrust']:
        model = controller(name)
        observed = metrics(model, val_x, val_y)
        expected = recorded['models'][name]['validation_classification']
        for key in ['accuracy', 'macro_f1']:
            if not np.isclose(observed[key], expected[key], atol=1e-10, rtol=0):
                raise ValueError(f'Saved weights no longer reproduce {name} {key}')
        pred = model.predict(val_x)
        f1 = []
        for c in range(10):
            tp = int(np.sum((pred == c) & (val_y == c)))
            fp = int(np.sum((pred == c) & (val_y != c)))
            fn = int(np.sum((pred != c) & (val_y == c)))
            f1.append(2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.)
        per_class[name] = f1
        data['models'][name] = {'validation': observed, 'per_action_f1': f1,
            'source_sha256': hashlib.sha256((MODELS / f'{name}.py').read_bytes()).hexdigest(),
            'weights_sha256': hashlib.sha256((MODELS / 'tuned_results' / f'{name}.npz').read_bytes()).hexdigest()}
    fig, axs = figure()
    ax = axs[0, 0]
    actions = np.arange(10)
    ax.bar(actions-.19, np.array(per_class['02_flight_split'])*100, width=.38, color=MUTED, label='Unweighted')
    ax.bar(actions+.19, np.array(per_class['03_class_weighted'])*100, width=.38, color=PURPLE, label='Class weighted')
    ax.set(xlabel='Expert action (one versus rest)', ylabel='Validation F1 (%)', xticks=actions, ylim=(0, 105))
    ax.legend(frameon=False)
    save(fig, 'per-action-f1.svg')

    # A worked feature calculation, not a simulated future flight.
    observation = np.array([[0, 100, 0, -20, 0, 0, 10000, 0, 0, 0, 0, 1.225]], dtype=float)
    projections = {name: controller(name)._basis(observation)[0, 12:].reshape(3, 4)
                   for name in ['04_constant_velocity', '05_gravity']}
    data['projection_example'] = {'observation': observation[0].tolist(),
                                 'horizons': [1, 2, 3],
                                 'features': {name: values.tolist() for name, values in projections.items()}}
    fig, axs = figure()
    ax = axs[0, 0]
    t = np.linspace(0, 3, 100)
    ax.plot(t, 100-20*t, color=INK, linestyle=':', label='Free constant-velocity equation')
    ax.plot(t, 100-20*t-.5*9.80665*t*t, color=PURPLE, linestyle=':', label='Free gravity equation')
    for name, label, color in [('04_constant_velocity', 'Constant-velocity features', INK),
                               ('05_gravity', 'Gravity features (stop at contact)', PURPLE)]:
        ax.scatter([1, 2, 3], projections[name][:, 0], s=85, color=color, label=label, zorder=4)
    contact_height = projections['05_gravity'][-1, 0]
    ax.axhline(contact_height, color=MUTED, linewidth=1, linestyle='--')
    ax.text(.05, contact_height+3, 'Estimated upright contact height (COM)', fontsize=12, color=MUTED)
    ax.set(xlabel='Projection horizon (s)', ylabel='Projected COM height (m)', ylim=(-10, 110), xticks=[0, 1, 2, 3])
    ax.legend(frameon=False, fontsize=11, loc='upper right')
    save(fig, 'projection-features.svg')

    build_figures(OUT, data, controller, figure, save)

    case = read_validation_runs(EXERCISE / 'validation_runs.csv')[0]
    paths = {}
    for name in ['06_drag', '07_thrust']:
        print('Replaying validation flight', case['run_id'], name, flush=True)
        p, _ = configuration(case['scenario'])
        initial = State(**{key: float(case[key]) for key in State.__dataclass_fields__})
        outcome = evaluate_closed_loop(controller(name).predict_action, initial, p, case['scenario'],
            max_time=None, constant_wind=(float(case['wind_x']), float(case['wind_y'])))
        expected = recorded['models'][name]['validation_simulations']['runs'][0]['scoring']
        for key in ['vy', 'vx', 'theta', 'omega', 'score', 'contact_time']:
            if not np.isclose(outcome['scoring'][key], expected[key], atol=1e-7, rtol=0):
                raise ValueError(f'Replayed {name} does not reproduce recorded {key}')
        snapshots = outcome['replay']['snapshots']
        sample = snapshots[::25]
        if sample[-1] is not snapshots[-1]:
            sample.append(snapshots[-1])
        paths[name] = {'time': [s['time'] for s in sample],
                       **{key: [s['state'][key] for s in sample] for key in ['y', 'vy', 'fuel', 'thrust']}}
        data['models'][name]['flight_0'] = {'scoring': outcome['scoring'], 'path': paths[name],
            'decisions': [{'time': d['time'], 'action': d['action']} for d in outcome['decisions']]}
    a, b = (data['models'][n]['flight_0']['decisions'] for n in ['06_drag', '07_thrust'])
    first = next(({'time': x['time'], 'drag_action': x['action'], 'thrust_action': z['action']}
                  for x, z in zip(a, b) if x['action'] != z['action']), None)
    data['first_action_disagreement'] = first
    fig, axs = figure(1, 2, 4)
    for name, label, color in [('06_drag', 'Drag model', INK), ('07_thrust', 'Thrust model', PURPLE)]:
        path = paths[name]
        axs[0, 0].plot(path['time'], path['y'], label=label, color=color, linewidth=2.5)
        axs[0, 1].plot(path['time'], path['vy'], label=label, color=color, linewidth=2.5)
    axs[0, 0].set(xlabel='Flight time (s)', ylabel='Centre-of-mass height (m)')
    axs[0, 1].set(xlabel='Flight time (s)', ylabel='Vertical velocity (m/s)')
    axs[0, 1].axhspan(-3, 0, color=PURPLE, alpha=.12, label='Safe contact velocity')
    axs[0, 0].legend(frameon=False, fontsize=12)
    axs[0, 1].legend(frameon=False, fontsize=12)
    save(fig, 'paired-flight.svg')
    fig, axs = figure(1, 2, 4)
    for name, label, color in [('06_drag', 'Drag model', INK), ('07_thrust', 'Thrust model', PURPLE)]:
        path = paths[name]
        axs[0, 0].plot(path['time'], np.array(path['fuel'])/1000, label=label, color=color, linewidth=2.5)
        axs[0, 1].plot(path['time'], np.array(path['thrust'])/1e6, label=label, color=color, linewidth=2)
    axs[0, 0].set(xlabel='Flight time (s)', ylabel='Remaining fuel (tonnes)')
    axs[0, 1].set(xlabel='Flight time (s)', ylabel='Observed thrust (MN)')
    axs[0, 0].legend(frameon=False, fontsize=12)
    save(fig, 'paired-fuel-thrust.svg')
    (OUT / 'walkthrough-data.json').write_text(json.dumps(data, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print('Wrote measured figures and walkthrough-data.json; first disagreement:', first, flush=True)


if __name__ == '__main__':
    main()
