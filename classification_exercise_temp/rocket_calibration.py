"""Versioned Falcon 9-inspired recovery profile; SI units and radians.

P = published, E = engineering approximation, D = derived. See README for
source links, model limitations and the corresponding provenance by group.
"""
import math
from rocket_physics import Parameters, State

NAME = 'falcon9_coastal_landing_v1'
REVISION = '1.0'
COEFFICIENT_MODEL = 'effective-periodic-v1'
ATMOSPHERE_MODEL = 'exponential-8500m-v1'
LANDING_ZONE_MODEL = 'faa-proposed-slc40-cross-section-v1'
CONCRETE_EDGE = 42.672
APRON_EDGE = 60.960
TERRAIN = ((-250., -.70), (-160., -.35), (-95., -.12), (-65., 0.),
           (-60.960, 0.), (-42.672, 0.), (42.672, 0.), (60.960, 0.),
           (65., 0.), (95., -.12), (160., -.35), (250., -.70))
SCENARIOS = {
    # x, y, vx, vy, tilt degrees, angular rate degrees/s, fuel, thrust, gimbal
    'demo_descent': (20., 700., -2., -70., 2., 0., 12000., 0., 0.),
    'centred_descent': (0., 450., 0., -48., 0., 0., 9000., 0., 0.),
    'crosswind_diagnostics': (-18., 600., 7., -65., -3., .5, 12000., 0., 0.),
    'near_ground_contact': (0., 25., 0., -2., 0., 0., 4000., 0., 0.),
}
PROVENANCE = {
    'dimensions': 'P: S1,S2; E: centroid, inertia, feet, engine and hull details; D: reference area/length',
    'mass_and_tank': 'E: dry mass (historical estimate S4), tank and landing fuel; P: historical capacity S4; D: moving mass properties',
    'propulsion': 'P: thrust S1,S3; E: Isp historical estimate S4, gimbal, actuators and throttle levels; D: thrust conversion',
    'environment': 'P: sea-level density S5; E: gravity approximation, scale height and winds',
    'aerodynamics': 'E: surrogate coefficients, centre of pressure, damping and regularisation',
    'landing_zone': 'P/D: proposed dimensions S6; E: terrain, elevation and decor',
    'integration_and_scenarios': 'E: timesteps, event tolerance and initial states',
}


def gravity(y, t=None): return 9.80665

def density(y, t=None): return 1.225 * math.exp(-max(y, 0.) / 8500.)

def baseline_wind(y, t): return (0., 0.)

def crosswind_wind(y, t): return (4. + 3. * (1. - math.exp(-max(y, 0.) / 300.)), 0.)

def drag_coefficient(alpha): return .65 + 15. * math.sin(alpha)**2

def lift_coefficient(alpha): return -.60 * math.sin(2. * alpha)

def centre_of_pressure(alpha): return (0., 37.)


def configuration(name='demo_descent'):
    if name not in SCENARIOS:
        raise ValueError('unknown scenario')
    wind = crosswind_wind if name == 'crosswind_diagnostics' else baseline_wind
    p = Parameters(dry_mass=28000., dry_centroid=(0., 23.), dry_inertia=5.60e6,
        fuel_capacity=411000., tank_bottom=5., tank_height=39., tank_radius=1.78,
        engine=(0., 1.), hull=((-1.83, 1.60), (1.83, 1.60), (1.83, 43.60),
        (1.65, 45.20), (1.65, 48.768), (-1.65, 48.768), (-1.65, 45.20), (-1.83, 43.60)),
        feet=((-9., 0.), (9., 0.)), area=10.5209, length=48.768,
        min_thrust=482000., max_thrust=845000., isp=282., g0=9.80665,
        thrust_tau=.15, thrust_rate=1.5e6, gimbal_max=math.radians(5.), gimbal_tau=.10,
        gimbal_rate=math.radians(10.), cmq=.60, speed_epsilon=1., throttle_levels=(.12, .55, 1.),
        control_interval=.10, timestep=.010, event_tolerance=1e-5, gravity=gravity,
        density=density, wind=wind, drag_coefficient=drag_coefficient,
        lift_coefficient=lift_coefficient, centre_of_pressure=centre_of_pressure, terrain=TERRAIN)
    x, y, vx, vy, theta, omega, fuel, thrust, gimbal = SCENARIOS[name]
    return p, State(x, y, vx, vy, math.radians(theta), math.radians(omega), fuel, thrust, gimbal)


def metadata(name):
    if name not in SCENARIOS: raise ValueError('unknown scenario')
    wind_id = 'crosswind-v1' if name == 'crosswind_diagnostics' else 'zero-wind-v1'
    return dict(profile=NAME, revision=REVISION, scenario=name, provenance=PROVENANCE,
        coefficient_model=COEFFICIENT_MODEL, atmosphere_model=ATMOSPHERE_MODEL,
        wind_model=wind_id, landing_zone_model=LANDING_ZONE_MODEL,
        environment=dict(gravity='9.80665 m/s²', density='1.225 * exp(-max(y, 0) / 8500) kg/m³',
            wind=('(4 + 3*(1-exp(-max(y,0)/300)), 0) m/s' if wind_id == 'crosswind-v1' else '(0, 0) m/s'),
            drag_coefficient='0.65 + 15*sin(alpha)^2', lift_coefficient='-0.60*sin(2*alpha)',
            centre_of_pressure='(0, 37) m in body coordinates'),
        pad=dict(concrete_edge=CONCRETE_EDGE, apron_edge=APRON_EDGE))
