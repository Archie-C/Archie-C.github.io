"""Continuous nonlinear MPC for the calibrated rocket landing exercise.

Optimize coast time, powered-flight duration and piecewise-constant controls to
reach a soft, upright touchdown. Nonlinear least squares provides a local
solution; this nonconvex problem has no claimed global optimality guarantee.
"""
import math

import numpy as np
from scipy.optimize import least_squares

from rocket_calibration import configuration
from rocket_physics import Command
from rocket_scoring import CONFIG


class Controller:
    """Exercise-compatible expert; predict_action returns (thrust, gimbal)."""

    version = 'continuous-mpc-v1'

    def __init__(self, knots=8, max_nfev=45, touchdown_speed=.3):
        if type(knots) is not int or knots < 3 or type(max_nfev) is not int or max_nfev < 5:
            raise ValueError('knots must be at least 3 and max_nfev at least 5')
        if not math.isfinite(touchdown_speed) or not 0 < touchdown_speed < CONFIG.max_descent:
            raise ValueError('touchdown_speed must be positive and below the landing limit')
        self.touchdown_speed = touchdown_speed
        self.knots = knots
        self.max_nfev = max_nfev
        self.p, _ = configuration()
        if self.p.actuator_delay:
            raise ValueError('this expert requires the instantaneous-actuator calibration')
        self.solver_settings = dict(knots=knots, max_nfev=max_nfev, touchdown_speed=touchdown_speed)
        self.reset()

    def reset(self):
        self.plan = None
        self.diagnostics = {}
        self.burning = False

    def _mass_centre(self, fuel):
        p = self.p
        fuel_c = p.tank_bottom + p.tank_height*fuel/p.fuel_capacity/2
        return (p.dry_mass*p.dry_centroid[1] + fuel*fuel_c)/(p.dry_mass+fuel)

    def _dynamics(self, s, u, wind):
        """Vectorized calibrated instantaneous-actuator dynamics, complex-safe."""
        p = self.p
        x, y, vx, vy, theta, omega, fuel = s
        throttle, gimbal = u[:2]
        mass = p.dry_mass + fuel
        height = p.tank_height * fuel / p.fuel_capacity
        fuel_c = p.tank_bottom + height / 2
        centre = (p.dry_mass * p.dry_centroid[1] + fuel * fuel_c) / mass
        inertia = (p.dry_inertia + p.dry_mass * (p.dry_centroid[1] - centre)**2
                   + fuel * (3*p.tank_radius**2 + height**2)/12 + fuel*(fuel_c-centre)**2)
        # A zero/off engine is represented explicitly by a separate coast phase.
        thrust = u[2] * (p.min_thrust + throttle * (p.max_thrust-p.min_thrust))
        angle = gimbal * p.gimbal_max
        ft_x, ft_y = -thrust*np.sin(theta+angle), thrust*np.cos(theta+angle)
        rx, ry = vx-wind[0], vy-wind[1]
        speed = np.sqrt(rx*rx + ry*ry + 1e-12)
        sa = (np.sin(theta)*ry + np.cos(theta)*rx)/speed
        ca = (np.sin(theta)*rx - np.cos(theta)*ry)/speed
        q = .5 * 1.225 * np.exp(-np.where(y.real > 0, y, 0)/8500) * speed**2 * p.area
        drag, lift = -q*(.65 + 15*sa*sa), -q*1.2*sa*ca
        aero_x, aero_y = (drag*rx-lift*ry)/speed, (drag*ry+lift*rx)/speed
        cp_y = p.centre_of_pressure(0)[1]-centre
        torque = (-(centre-p.engine[1])*thrust*np.sin(angle)
                  -cp_y*(np.sin(theta)*aero_y+np.cos(theta)*aero_x)
                  -q*p.length**2*p.cmq*omega/(2*np.where(speed.real > p.speed_epsilon, speed, p.speed_epsilon)))
        return np.array([vx, vy, (ft_x+aero_x)/mass, (ft_y+aero_y)/mass-p.g0,
                         omega, torque/inertia, -thrust/(p.isp*p.g0)])

    def _rollout(self, z, initial, wind):
        """Batched RK4 prediction, including complex perturbations for Jacobians."""
        n = self.knots
        coast, duration = z[:2]
        controls = z[2:].reshape(n, 2, -1)
        state = np.broadcast_to(initial[:, None], (7, z.shape[1])).copy().astype(z.dtype)
        history = []
        for k in range(n+1):
            if k == 0:
                dt = coast / 8
                u = np.zeros((3, z.shape[1]), dtype=z.dtype)
                substeps = 8
            else:
                dt = duration / n / 4
                u = np.vstack((controls[k-1], np.ones(z.shape[1])))
                substeps = 4
            for _ in range(substeps):
                a = self._dynamics(state, u, wind)
                b = self._dynamics(state+dt*a/2, u, wind)
                c = self._dynamics(state+dt*b/2, u, wind)
                d = self._dynamics(state+dt*c, u, wind)
                state = state + dt*(a+2*b+2*c+d)/6
            history.append(state)
        return np.array(history)

    def _residual(self, z, initial, wind):
        history = self._rollout(z, initial, wind)
        final = history[-1]
        fuel = final[6]
        centre = self._mass_centre(fuel)
        # Terminal tracking errors dominate fuel/time and smoothness regularization.
        terminal = (final-np.array([0, 0, 0, -self.touchdown_speed, 0, 0, 0])[:, None])[:6]
        terminal[1] -= centre
        terminal /= np.array([1., .3, .3, .2, .008, .008])[:, None]
        controls = z[2:].reshape(self.knots, 2, -1)
        smooth = np.diff(controls, axis=0).reshape(-1, z.shape[1])*.03
        effort = (initial[6]-fuel)[None, :]/20000
        # Penalize premature contact, large tilt and exhausting fuel anywhere
        # along the prediction. Piecewise smooth hinges retain complex-step
        # derivatives on their active branches.
        path_fuel = history[:, 6]
        path_centre = self._mass_centre(path_fuel)
        tilt = history[:, 4]
        feet = history[:, 1]-path_centre*np.cos(tilt)-9*np.sqrt(np.sin(tilt)**2+1e-10)
        violation = lambda value: np.where(value.real < 0, value, 0)
        path = np.vstack((violation(feet[:-1])*2, violation(path_fuel)/100,
                          violation(.5-tilt)*20, violation(.5+tilt)*20))
        return np.vstack((terminal, smooth, effort, .005*(z[0]+z[1])[None, :], path))

    def _solve(self, observation):
        initial = observation[:7].copy()
        wind = observation[9:11]
        n = self.knots
        p = self.p
        if self.plan is None:
            centre = self._mass_centre(initial[6])
            altitude = max(.1, initial[1]-centre)
            acceleration = p.max_thrust/(p.dry_mass+initial[6])-p.g0
            speed = max(1., -initial[3])
            coast = max(0., (math.sqrt(max(0., (speed*speed+2*p.g0*altitude)*acceleration/(acceleration+p.g0)))-speed)/p.g0)
            duration = max(.15, (speed+p.g0*coast)/acceleration)
            guess = np.r_[coast, duration, np.tile([.8, 0.], n)]
        else:
            guess = self.plan.copy()
            dt = p.control_interval
            if guess[0] >= dt:
                guess[0] -= dt
            else:
                remaining = dt-guess[0]
                guess[0] = 0
                old_time = guess[1]
                guess[1] = max(.05, old_time-remaining)
                old = guess[2:].reshape(n, 2)
                at = remaining + np.arange(n)*guess[1]/n
                guess[2:] = np.column_stack([np.interp(at, np.arange(n)*old_time/n, old[:, j]) for j in range(2)]).ravel()
        lower = np.r_[0., .04, np.tile([1e-5, -1.], n)]
        upper = np.r_[0.0000001 if self.burning else 15., 35., np.tile([1., 1.], n)]
        guess = np.clip(guess, lower+1e-10, upper-1e-10)
        cached = {}
        def evaluate(z):
            if 'z' not in cached or not np.array_equal(z, cached['z']):
                batch = np.tile(z[:, None], (1, len(z)+1)).astype(complex)
                batch[:, 1:] += 1e-20j*np.eye(len(z))
                r = self._residual(batch, initial, wind)
                cached.update(z=z.copy(), residual=r[:, 0].real, jac=r[:, 1:].imag/1e-20)
            return cached
        result = least_squares(lambda z: evaluate(z)['residual'], guess,
                               jac=lambda z: evaluate(z)['jac'], bounds=(lower, upper),
                               max_nfev=self.max_nfev, ftol=1e-6, xtol=1e-6, gtol=1e-6)
        self.plan = result.x
        self.diagnostics = dict(converged=bool(result.success), cost=float(result.cost),
                                evaluations=int(result.nfev), coast_seconds=float(result.x[0]),
                                burn_seconds=float(result.x[1]),
                                terminal_error=float(np.linalg.norm(result.fun[:6])))
        return result.x

    def predict_action(self, observation):
        obs = np.asarray(observation, dtype=float)
        if obs.shape != (12,) or not np.all(np.isfinite(obs)) or not 0 <= obs[6] <= self.p.fuel_capacity:
            raise ValueError('observation must contain 12 finite values and fuel within tank capacity')
        if obs[6] == 0:
            return (0., 0.)
        plan = self._solve(obs)
        # Start at the preceding command boundary. Rounding ignition later
        # can make a fuel-efficient maximum-thrust landing irrecoverable.
        if plan[0] > self.p.control_interval and not self.burning:
            return (0., 0.)
        self.burning = True
        return (float(plan[2]), float(plan[3]))

    def command(self, observation):
        """Adapter for evaluate_closed_loop(control_mode='continuous')."""
        return Command(*self.predict_action(observation))


def main(argv=None):
    """Benchmark the expert; optionally export continuous demonstrations."""
    import argparse
    from dataclasses import asdict, replace
    import csv
    import json
    from pathlib import Path
    import time

    from rocket_calibration import SCENARIOS
    from rocket_closed_loop import evaluate_closed_loop

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', action='append', choices=tuple(SCENARIOS),
                        help='Repeat to select scenarios; defaults to all four.')
    parser.add_argument('--dataset', type=Path, help='Optional continuous-control training CSV.')
    parser.add_argument('--report', type=Path, help='Optional JSON evaluation summary.')
    parser.add_argument('--replays', type=Path, help='Optional directory for newly generated flight recordings.')
    parser.add_argument('--random-runs', type=int, default=0,
                        help='Append this many reproducible, perturbed descent starts.')
    parser.add_argument('--seed', type=int, default=20261111)
    args = parser.parse_args(argv)
    if args.random_runs < 0:
        parser.error('--random-runs must be nonnegative')
    cases = [(name, *configuration(name), None) for name in (args.scenario or SCENARIOS)]
    rng = np.random.default_rng(args.seed)
    for _ in range(args.random_runs):
        parameters, initial = configuration('centred_descent')
        initial = replace(initial, x=float(rng.uniform(-35, 35)), y=float(rng.uniform(400, 750)),
                          vx=float(rng.uniform(-6, 6)), vy=float(rng.uniform(-75, -40)),
                          theta=float(rng.uniform(-.06, .06)), omega=float(rng.uniform(-.008, .008)),
                          fuel=float(rng.uniform(9000, 13000)))
        wind = (float(rng.uniform(-5, 5)), float(rng.uniform(-1, 1)))
        cases.append(('centred_descent', parameters, initial, wind))
    summaries, rows = [], []
    for run_id, (scenario, parameters, initial, wind) in enumerate(cases):
        expert = Controller()
        started = time.perf_counter()
        result = evaluate_closed_loop(expert.command, initial, parameters, scenario,
                                      max_time=60., control_mode='continuous', measure_time=True, constant_wind=wind)
        scoring = result['scoring']
        count = len(result['decisions'])
        summary = dict(run_id=run_id, scenario=scenario, initial_state=asdict(initial),
                       constant_wind=wind, scoring=scoring, decisions=count,
                       solver_seconds=result['policy_seconds'],
                       elapsed_seconds=time.perf_counter()-started,
                       termination=result['termination_reason'])
        summaries.append(summary)
        print(f"{run_id} {scenario}: {'SUCCESS' if scoring['success'] else 'FAILED'} "
              f"score={scoring['score']:.2f} solver={result['policy_seconds']:.2f}s "
              f"decisions={count}", flush=True)
        for step, decision in enumerate(result['decisions']):
            rows.append([run_id, step, *decision['observation'],
                         decision['command']['throttle'], decision['command']['gimbal'],
                         int(scoring['success'])])
        if args.replays:
            args.replays.mkdir(parents=True, exist_ok=True)
            (args.replays / f'{run_id}_{scenario}.json').write_text(
                json.dumps(result['replay'], allow_nan=False), encoding='utf-8')
    if args.dataset:
        args.dataset.parent.mkdir(parents=True, exist_ok=True)
        with args.dataset.open('w', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            # Keep observation column names consistent with the exercise guide.
            columns = ('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass',
                       'actual_thrust', 'actual_gimbal', 'wind_x', 'wind_y', 'air_density')
            writer.writerow(['run_id', 'step', *columns, 'thrust', 'gimbal', 'success'])
            writer.writerows(rows)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summaries, indent=2, allow_nan=False), encoding='utf-8')
    return 0 if all(item['scoring']['success'] for item in summaries) else 1


if __name__ == '__main__':
    raise SystemExit(main())
