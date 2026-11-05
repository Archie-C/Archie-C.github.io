import math
import unittest
from dataclasses import replace

import rocket_calibration as calibration
from rocket_physics import Contact, mass_properties, relative_point
from rocket_scoring import CONFIG, ScoringConfig, aggregate, score_contact
from rocket_server import offline


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.p, self.base = calibration.configuration('near_ground_contact')

    def contact(self, **changes):
        s = replace(self.base, **dict({'x': 0, 'vx': 0, 'vy': 0, 'theta': 0, 'omega': 0}, **changes))
        _, centre, _ = mass_properties(s.fuel, self.p)
        feet = [relative_point(foot, centre, s.theta) for foot in self.p.feet]
        s = replace(s, y=-min(y for _, y in feet))
        first = min(feet, key=lambda foot: foot[1])
        return Contact(1.25, s, (s.x + first[0], s.y + first[1]))

    def test_perfect_and_thresholds(self):
        self.assertEqual(score_contact(self.contact(), self.p)['score'], 100)
        for field, limit, sign in [('vy', 3, -1), ('vx', 1.5, 1), ('theta', math.pi/45, 1), ('omega', math.pi/90, 1)]:
            for factor, expected in [(1-1e-7, True), (1, True), (1+1e-7, False)]:
                with self.subTest(field=field, factor=factor):
                    self.assertEqual(score_contact(self.contact(**{field: sign*limit*factor}), self.p)['success'], expected)
        self.assertFalse(score_contact(self.contact(vy=1e-9), self.p)['success'])
        for field, limit in [('vx', 1.5), ('theta', math.pi/45), ('omega', math.pi/90)]:
            for factor, expected in [(1-1e-7, True), (1, True), (1+1e-7, False)]:
                self.assertEqual(score_contact(self.contact(**{field: -limit*factor}), self.p)['success'], expected)

    def test_geometry_and_missing(self):
        self.assertFalse(score_contact(None, self.p)['success'])
        for x in (40, 100):
            self.assertFalse(score_contact(self.contact(x=x), self.p)['success'])
        c = self.contact()
        self.assertFalse(score_contact(replace(c, point=(0, c.point[1])), self.p)['success'])
        hull_first = replace(self.p, feet=tuple((x, y+3) for x, y in self.p.feet))
        self.assertFalse(score_contact(c, hull_first)['success'])
        for offset, expected in [(CONFIG.pad_right - 9, True), (CONFIG.pad_right - 9 - 1e-6, True), (CONFIG.pad_right - 9 + 1e-6, False)]:
            self.assertEqual(score_contact(self.contact(x=offset), self.p)['success'], expected)
        self.assertFalse(score_contact(self.contact(), replace(self.p, feet=()))['success'])

    def test_monotonic_and_foot_velocity(self):
        for field, values in [('vx', (0, 1)), ('vy', (0, -2)), ('theta', (0, .03)), ('omega', (0, .02)), ('x', (0, 10))]:
            scores = [score_contact(self.contact(**{field: v}), self.p)['score'] for v in values]
            self.assertLess(scores[1], scores[0])
        c = self.contact(omega=.02)
        r = score_contact(c, self.p)
        x, y = r['feet'][0]
        self.assertAlmostEqual(r['foot_velocity'][0], c.state.vx - c.state.omega*(y-c.state.y))
        self.assertAlmostEqual(r['foot_velocity'][1], c.state.vy + c.state.omega*(x-c.state.x))
        self.assertEqual(r, score_contact(c, self.p))



if __name__ == '__main__': unittest.main()
