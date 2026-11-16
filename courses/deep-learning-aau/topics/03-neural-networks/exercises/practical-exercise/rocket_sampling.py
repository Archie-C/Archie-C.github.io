"""Stratified, feasible flight-phase sampling for continuous expert demonstrations."""
from dataclasses import dataclass, replace
import math

import numpy as np

from rocket_calibration import configuration
from rocket_physics import clearance, mass_properties
from rocket_scoring import CONFIG

# Every block of twenty runs has this mix, in a seed-dependent shuffled order.
PROFILE_COUNTS = dict(descent=4, mid_flight=4, approach=5, recovery=4, crosswind=3)
SAMPLER_VERSION = 'mixed-flight-phases-v1'


@dataclass
class FlightCase:
    profile: str
    scenario: str
    initial: object
    constant_wind: tuple | None
    gusts: dict | None
    clearance: float


def profile_for_run(seed, run_id):
    profiles = [name for name, count in PROFILE_COUNTS.items() for _ in range(count)]
    block, slot = divmod(run_id, len(profiles))
    rng = np.random.default_rng(np.random.SeedSequence([seed, block, 917]))
    return str(rng.permutation(profiles)[slot])


def sample_mixed_case(seed, run_id):
    """Sample correlated height/speed pairs, engine states and recovery errors.

    Feasibility checks reject penetration, insufficient stopping distance and
    insufficient estimated burn fuel; successful landing is still measured by
    the authoritative simulator, not assumed by this sampler.
    """
    profile = profile_for_run(seed, run_id)
    rng = np.random.default_rng(np.random.SeedSequence([seed, run_id, 918]))
    uniform = lambda low, high: float(rng.uniform(low, high))
    scenario = 'centred_descent'
    constant = None
    gusts = None
    if profile == 'crosswind' and rng.random() < .35:
        scenario = 'crosswind_diagnostics'
    else:
        strength = 8.5 if profile == 'crosswind' else 7.
        base_x, base_y = uniform(-strength, strength), uniform(-1.5, 1.5)
        if rng.random() < (.6 if profile == 'crosswind' else .25):
            gusts = dict(base_x=base_x, base_y=base_y, amplitude_x=uniform(.5, 2.5),
                         amplitude_y=uniform(.1, .6), period=uniform(3., 9.),
                         phase=uniform(-math.pi, math.pi), shear=uniform(-2., 2.))
        else:
            constant = (base_x, base_y)
    p, template = configuration(scenario)
    for _ in range(100):
        if profile in ('descent', 'crosswind'):
            fuel = uniform(7000., 14000.)
            gap = uniform(330., 900.)
            span, speed_x, angle, angular_rate = 60., 11., .12, .025
            speed_floor, speed_ceiling, braking_fraction = 35., 85., .85
            engine_on = rng.random() < .15
        elif profile == 'mid_flight':
            fuel = uniform(4000., 11000.)
            gap = uniform(70., 360.)
            span, speed_x, angle, angular_rate = 32., 6., .09, .025
            speed_floor, speed_ceiling, braking_fraction = 8., 55., .75
            engine_on = rng.random() < .8
        elif profile == 'approach':
            fuel = uniform(2000., 6500.)
            # Log sampling deliberately includes short, near-contact approaches.
            gap = math.exp(uniform(math.log(1.), math.log(80.)))
            span = min(18., 2.+gap*.18)
            speed_x, angle, angular_rate = min(3., .3+gap*.04), .025, .008
            speed_floor, speed_ceiling, braking_fraction = .5, 20., .6
            engine_on = rng.random() < .5
        else:
            fuel = uniform(3500., 10000.)
            gap = uniform(65., 320.)
            span, speed_x, angle, angular_rate = 35., 8., .16, .05
            speed_floor, speed_ceiling, braking_fraction = 6., 45., .65
            engine_on = rng.random() < .7
        mass, centre, _ = mass_properties(fuel, p)
        acceleration = p.max_thrust/mass-p.g0
        maximum_speed = min(speed_ceiling, braking_fraction*math.sqrt(2*acceleration*gap))
        if maximum_speed <= speed_floor:
            continue
        theta = uniform(-angle, angle)
        # Set height by actual lowest-foot clearance, including tilt and COM.
        foot_depth = max(-(foot[1]-centre[1])*math.cos(theta)-foot[0]*math.sin(theta)
                         for foot in p.feet)
        throttle = uniform(.05, 1.) if engine_on else 0.
        initial = replace(template, x=uniform(-span, span), y=gap+foot_depth,
                          vx=uniform(-speed_x, speed_x), vy=-uniform(speed_floor, maximum_speed),
                          theta=theta, omega=uniform(-angular_rate, angular_rate), fuel=fuel,
                          thrust=(p.min_thrust+throttle*(p.max_thrust-p.min_thrust)) if engine_on else 0.,
                          gimbal=uniform(-.7, .7)*p.gimbal_max if engine_on else 0.)
        distance = clearance(initial, p)[0]
        stop_distance = initial.vy**2/(2*acceleration)
        burn_fuel = p.max_thrust*(-initial.vy/acceleration)/(p.isp*p.g0)
        lateral_ok = True
        if gap < 330.:
            outward = max(0., initial.vx*math.copysign(1., initial.x))
            stop_x = abs(initial.x) + outward**2/(2*1.5)
            lateral_ok = (stop_x < CONFIG.d_ref*.9
                          and abs(initial.vx) <= max(1., 1.2*gap/max(-initial.vy, 1.)))
        if lateral_ok and distance > max(.2, 1.15*stop_distance) and fuel > 1.5*burn_fuel:
            return p, FlightCase(profile, scenario, initial, constant, gusts, distance)
    raise ValueError(f'could not sample a feasible {profile} start for run {run_id}')
