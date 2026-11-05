import math
import unittest
from dataclasses import replace

import rocket_calibration as c
from rocket_physics import Command, clearance, discrete_command, forces, mass_properties, relative_point, step
from rocket_server import Run, offline


class CalibrationTests(unittest.TestCase):
    def test_mass_geometry_and_initial_clearance(self):
        p, s = c.configuration()
        self.assertEqual(mass_properties(0, p), (28000, (0, 23), 5.60e6))
        mass, centre, inertia = mass_properties(12000, p)
        height = 39 * 12000 / 411000
        expected_c = (28000*23 + 12000*(5+height/2))/40000
        expected_i = 5.60e6+28000*(23-expected_c)**2+12000*(height**2/12+1.78**2/4+(5+height/2-expected_c)**2)
        self.assertEqual(mass, 40000)
        self.assertAlmostEqual(centre[1], expected_c)
        self.assertAlmostEqual(inertia, expected_i)
        self.assertAlmostEqual(height, 1.138686, places=5)
        for name in c.SCENARIOS:
            p, s = c.configuration(name)
            self.assertGreater(clearance(s, p)[0], 0)
        self.assertEqual(len(p.hull), 8)
        self.assertEqual(p.feet, ((-9., 0.), (9., 0.)))

    def test_propulsion_aero_and_symmetry(self):
        p, s = c.configuration()
        self.assertEqual(discrete_command(0, p), Command(0, 0))
        for action, target in [(2, 525560), (5, 681650), (8, 845000)]:
            self.assertAlmostEqual(p.min_thrust + discrete_command(action, p).throttle*(p.max_thrust-p.min_thrust), target)
        self.assertEqual(c.density(0), 1.225)
        self.assertAlmostEqual(c.drag_coefficient(0), .65)
        self.assertAlmostEqual(c.drag_coefficient(math.pi/2), 15.65)
        self.assertEqual(c.lift_coefficient(0), 0)
        for angle in [-math.pi, -.3, 0, .3, math.pi]:
            self.assertGreaterEqual(c.drag_coefficient(angle), 0)
            self.assertAlmostEqual(c.drag_coefficient(angle), c.drag_coefficient(angle+2*math.pi))
            self.assertAlmostEqual(c.lift_coefficient(angle), c.lift_coefficient(angle+2*math.pi))
        left = replace(s, theta=0, thrust=500000, gimbal=.05)
        right = replace(left, x=-left.x, vx=-left.vx, gimbal=-left.gimbal)
        self.assertLess(forces(0, left, p)[3], 0)
        a, _ = step(0, left, Command(.5, .5), p, .01)
        b, _ = step(0, right, Command(.5, -.5), p, .01)
        self.assertAlmostEqual(a.x, -b.x)
        self.assertAlmostEqual(a.theta, -b.theta)
        self.assertGreater(forces(0, replace(s, theta=.01, vx=0), p)[2][0], 0)

    def test_terrain_contact_and_wind(self):
        p, _ = c.configuration('near_ground_contact')
        for x in (-60.96, -42.672, 0, 42.672, 60.96):
            self.assertEqual(__import__('rocket_physics').ground_height(x, p.terrain), 0)
        def drop(x):
            s = replace(c.configuration('near_ground_contact')[1], x=x)
            t = 0
            while t < 5:
                s, contact = step(t, s, Command(0, 0), p, .01)
                if contact: return contact
                t += .01
            self.fail('no contact')
        inside, outside = drop(0), drop(100)
        self.assertAlmostEqual(inside.point[1], 0, places=3)
        self.assertGreater(abs(outside.point[0]), 60.96)
        self.assertEqual(__import__('rocket_server').contact_quality(outside, p), 'contact outside envelope')
        cross, s = c.configuration('crosswind_diagnostics')
        self.assertNotEqual(forces(0, s, cross)[1:3], forces(0, s, replace(cross, wind=c.baseline_wind))[1:3])
        self.assertEqual(Run('crosswind_diagnostics').config['wind_model'], 'crosswind-v1')

    def test_powered_contact_refines(self):
        results = []
        for h in (.01, .005):
            p, s = c.configuration('centred_descent')
            for n in range(int(15/h)):
                t = n*h
                s, contact = step(t, s, Command(1 if t >= 2.96-1e-9 else 0, 0), p, h)
                if contact:
                    results.append(contact)
                    break
            else:
                self.fail('no powered contact')
        self.assertAlmostEqual(results[0].time, results[1].time, delta=2e-5)
        self.assertAlmostEqual(results[0].state.vy, results[1].state.vy, delta=1e-3)
        self.assertEqual(__import__('rocket_server').contact_quality(results[0], p), 'candidate safe first contact')

    def test_envelope_and_replay(self):
        r = Run('crosswind_diagnostics')
        self.assertEqual(r.config['profile'], c.NAME)
        self.assertEqual(r.config['environment'], c.metadata('crosswind_diagnostics')['environment'])
        a, b = offline([0]*3, 'crosswind_diagnostics'), offline([0]*3, 'crosswind_diagnostics')
        self.assertEqual([x['state'] for x in a['snapshots']], [x['state'] for x in b['snapshots']])
        self.assertEqual(a['config']['physics_config'], b['config']['physics_config'])
        r.state = replace(r.state, y=1100)
        packet = __import__('rocket_server').state_packet(r, 0, r.state, r.command, 1)
        self.assertIn('altitude', packet['diagnostics']['envelope_violations'])
        self.assertTrue(packet['diagnostics']['envelope_left'])


if __name__ == '__main__': unittest.main()
