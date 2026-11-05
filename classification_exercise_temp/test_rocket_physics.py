import math
import unittest
from dataclasses import replace

from rocket_physics import (Command, Parameters, State, clearance, derivative,
                            discrete_command, forces, mass_properties, simulate, step)


def parameters(**changes):
    # Illustrative test scales only, not calibrated flight hardware.
    p = Parameters(dry_mass=10, dry_centroid=(0, 1), dry_inertia=8,
        fuel_capacity=10, tank_bottom=0, tank_height=2, tank_radius=0.5,
        engine=(0, -1), hull=((-0.5, 0), (0.5, 0), (0.5, 3), (-0.5, 3)),
        feet=((-1, -0.5), (1, -0.5)), area=1, length=3,
        min_thrust=0, max_thrust=100, isp=10, g0=10,
        thrust_tau=0.5, thrust_rate=1000, gimbal_max=0.3,
        gimbal_tau=0.5, gimbal_rate=2, cmq=1, speed_epsilon=0.01,
        throttle_levels=(0.2, 0.5, 1), control_interval=0.2,
        timestep=0.02, event_tolerance=1e-10, gravity=lambda y: 10,
        density=lambda y: 0, wind=lambda y, t: (0, 0),
        drag_coefficient=lambda a: 1, lift_coefficient=math.sin,
        centre_of_pressure=lambda a: (0, 2), terrain=((-1000, -1000), (1000, -1000)))
    return replace(p, **changes)


def state(**changes):
    return replace(State(0, 100, 0, 0, 0, 0, 5, 0, 0), **changes)


def advance(s, p, duration, command=Command(0, 0)):
    t = 0.0
    while t < duration - 1e-12:
        h = min(p.timestep, duration - t)
        s, contact = step(t, s, command, p, h)
        if contact: return s, contact
        t += h
    return s, None


class Verification(unittest.TestCase):
    def test_v01_v02_ballistic(self):
        s, _ = advance(state(vx=3, vy=4), parameters(), 2)
        self.assertAlmostEqual(s.x, 6, places=9)
        self.assertAlmostEqual(s.y, 88, places=9)
        self.assertAlmostEqual(s.vx, 3, places=9)
        self.assertAlmostEqual(s.vy, -16, places=9)

    def test_v03_v04_gimbal_torque(self):
        p = parameters()
        self.assertAlmostEqual(forces(0, state(thrust=20), p)[3], 0)
        s = state(theta=0.7, thrust=20, gimbal=0.1)
        _, c, _ = mass_properties(s.fuel, p)
        self.assertAlmostEqual(forces(0, s, p)[3], -(c[1] + 1) * 20 * math.sin(0.1))
        self.assertLess(forces(0, s, p)[3], 0)

    def test_v05_constant_acceleration(self):
        p = parameters(gravity=lambda y: 0)
        # No flow approximated: compare exact acceleration at fixed mass using zero thrust
        # and constant gravity, distinct from the ballistic initial conditions.
        p = replace(p, gravity=lambda y: 3)
        s, _ = advance(state(vy=-2, fuel=0), p, 1.5)
        self.assertAlmostEqual(s.y, 100 - 3 - 3 * 1.5**2 / 2, places=9)

    def test_v06_rocket_equation(self):
        p = parameters(gravity=lambda y: 0)
        initial = state(thrust=50)
        final, _ = advance(initial, p, 2, Command(0.5, 0))
        self.assertAlmostEqual(final.vy, p.isp * p.g0 * math.log((p.dry_mass + initial.fuel) / (p.dry_mass + final.fuel)), places=8)

    def test_v07_exhaustion(self):
        p = parameters(gravity=lambda y: 0, timestep=0.2)
        s, _ = advance(state(fuel=0.1, thrust=50), p, 1, Command(0.5, 0))
        self.assertEqual(s.fuel, 0)
        self.assertEqual(s.thrust, 0)
        self.assertAlmostEqual(s.vy, p.isp*p.g0*math.log(10.1/10), places=6)

    def test_v08_mass_geometry(self):
        p = parameters(dry_centroid=(0, 1), tank_bottom=0, tank_height=2)
        mass, c, inertia = mass_properties(10, p)
        self.assertEqual(mass, 20)
        self.assertEqual(c, (0, 1))
        self.assertAlmostEqual(inertia, 8 + 10 * (3*0.5**2 + 2**2)/12)
        _, c, inertia = mass_properties(5, p)
        self.assertAlmostEqual(c[1], 5/6)
        self.assertAlmostEqual(inertia, 8 + 10*(1/6)**2 + 5*(3*0.5**2+1)/12 + 5*(1/3)**2)

    def test_v09_v10_aerodynamics(self):
        p = parameters(density=lambda y: 1, wind=lambda y,t: (2, -1))
        s = state(vx=8, vy=-5, omega=2)
        _, drag, _, _, _, damping = forces(0, s, p)
        self.assertLessEqual(drag[0]*6 + drag[1]*(-4), 0)
        self.assertLess(damping*s.omega, 0)
        self.assertEqual(forces(0, state(vx=2, vy=-1, omega=2), p)[1:], ((0.0, 0.0), (0.0, 0.0), 0.0, 0.0, 0.0))

    def test_v11_reflection(self):
        p = parameters(density=lambda y: 0.5, wind=lambda y,t: (1, 0))
        mirror = replace(p, wind=lambda y,t: (-1, 0))
        a = state(x=2, vx=3, vy=-5, theta=0.2, omega=-0.1, gimbal=0.1, thrust=30)
        b = replace(a, x=-a.x, vx=-a.vx, theta=-a.theta, omega=-a.omega, gimbal=-a.gimbal)
        x, _ = advance(a, p, 1, Command(.5, .4))
        y, _ = advance(b, mirror, 1, Command(.5, -.4))
        for i, (v, w) in enumerate(zip(x.values(), y.values())):
            self.assertAlmostEqual(v, -w if i in (0, 2, 4, 5, 8) else w, places=9)

    def test_v12_fourth_order(self):
        def error(h):
            p = parameters(timestep=h, gravity=lambda y: 0)
            s, _ = advance(state(), p, 1, Command(1, 0))
            return abs(s.thrust - 100*(1-math.exp(-2)))
        self.assertGreater(error(.1)/error(.05), 14)

    def test_v13_contact(self):
        p = parameters(terrain=((-5, 0), (0, 1), (5, 0)), timestep=.5)
        s, event = advance(state(y=5, vy=-1, theta=.2), p, 2)
        self.assertIsNotNone(event)
        self.assertGreaterEqual(clearance(s, p)[0], 0)
        self.assertLess(clearance(s, p)[0], 1e-8)
        self.assertEqual(s, event.state)

    def test_v14_v15_reproducibility_and_sampling(self):
        p = parameters()
        trajectory = list(simulate(state(), [1, 5, 0, 9], p))
        self.assertEqual(trajectory, list(simulate(state(), [1, 5, 0, 9], p)))
        # Consumers can sample at different frame rates without advancing physics.
        slow = list(simulate(state(), [1, 5, 0, 9], p))
        fast = list(simulate(state(), [1, 5, 0, 9], p))
        self.assertEqual(slow[::4], fast[::4])
        self.assertEqual(slow[-1], fast[-1])

    def test_terrain_edge_and_command_transition(self):
        p = parameters(terrain=((-5, 0), (0, 1), (5, 0)), feet=())
        # A terrain peak can touch an edge even when neither vertex does.
        s = state(y=2, fuel=0)
        distance, point = clearance(s, p)
        self.assertAlmostEqual(distance, 0)
        self.assertEqual(point, (0, 1))
        p = parameters(control_interval=0.13, timestep=0.05)
        trajectory = list(simulate(state(), [9, 0], p))
        transition = next(i for i, row in enumerate(trajectory) if abs(row[0] - .13) < 1e-12)
        self.assertLess(trajectory[transition + 1][1].thrust, trajectory[transition][1].thrust)

    def test_large_step_actuator_bounds(self):
        p = parameters(timestep=10, gravity=lambda y: 0)
        s, _ = step(0, state(), Command(1, 1), p, 5)
        self.assertTrue(0 <= s.thrust <= p.max_thrust)
        self.assertTrue(-p.gimbal_max <= s.gimbal <= p.gimbal_max)

    def test_discrete_actions_and_actuators(self):
        p = parameters()
        self.assertEqual(discrete_command(0, p), Command(0, 0))
        self.assertEqual([discrete_command(i, p).gimbal for i in range(1, 10)], [1,0,-1]*3)
        self.assertEqual([discrete_command(i, p).throttle for i in (1,4,7)], list(p.throttle_levels))
        with self.assertRaises(ValueError): discrete_command(10, p)
        s, _ = step(0, state(), Command(1, 1), p, .01)
        self.assertGreater(s.thrust, 0)
        self.assertLess(s.thrust, p.max_thrust)
        self.assertGreater(s.gimbal, 0)
        self.assertLess(s.gimbal, p.gimbal_max)


if __name__ == '__main__':
    unittest.main()
