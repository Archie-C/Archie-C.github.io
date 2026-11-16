"""Physical coverage, reproducibility and gust observations for mixed sampling."""
from collections import Counter
import math
import unittest

from rocket_calibration import configuration
from rocket_closed_loop import evaluate_closed_loop
from rocket_physics import Command, clearance
from rocket_sampling import PROFILE_COUNTS, profile_for_run, sample_mixed_case
from rocket_wind import gust_field


class SamplingTests(unittest.TestCase):
    def test_each_block_has_a_balanced_reproducible_mix(self):
        for block in range(3):
            modes = [profile_for_run(42, i) for i in range(20*block, 20*(block+1))]
            self.assertEqual(Counter(modes), PROFILE_COUNTS)
            self.assertEqual(modes, [profile_for_run(42, i) for i in range(20*block, 20*(block+1))])
        self.assertNotEqual([profile_for_run(42, i) for i in range(20)],
                            [profile_for_run(43, i) for i in range(20)])

    def test_starts_cover_missing_domains_and_are_physically_admissible(self):
        cases = []
        for run_id in range(200):
            p, case = sample_mixed_case(42, run_id)
            _, repeated = sample_mixed_case(42, run_id)
            self.assertEqual(case, repeated)
            state = case.initial
            self.assertTrue(all(math.isfinite(v) for v in state.values()))
            self.assertTrue(0 < state.fuel <= p.fuel_capacity)
            self.assertTrue(0 <= state.thrust <= p.max_thrust)
            self.assertTrue(abs(state.gimbal) <= p.gimbal_max)
            self.assertGreater(clearance(state, p)[0], 0.)
            acceleration = p.max_thrust/(p.dry_mass+state.fuel)-p.g0
            self.assertGreater(case.clearance, 1.15*state.vy**2/(2*acceleration))
            cases.append(case)
        self.assertTrue(any(c.initial.y < 50 and c.initial.thrust == 0 for c in cases))
        self.assertTrue(any(c.initial.fuel < 4000 for c in cases))
        self.assertTrue(any(abs(c.initial.vx) > 7 for c in cases))
        self.assertTrue(any(c.initial.thrust > 0 for c in cases))
        self.assertTrue(any(c.gusts is not None for c in cases))
        self.assertTrue(any(c.scenario == 'crosswind_diagnostics' for c in cases))
        self.assertTrue(any(c.constant_wind is not None and abs(c.constant_wind[0]) > 6.6 for c in cases))

    def test_gusts_are_reproducible_and_measured_by_the_expert(self):
        profile = dict(base_x=5., base_y=.3, amplitude_x=2., amplitude_y=.4,
                       period=4., phase=.5, shear=1.)
        field = gust_field(profile)
        self.assertNotEqual(field(500., 0), field(500., 1))
        p, state = configuration('centred_descent')
        result = evaluate_closed_loop(lambda obs: Command(0., 0.), state, p, 'centred_descent',
                                      max_time=.3, control_mode='continuous', wind_profile=profile)
        self.assertEqual(result['replay']['config']['wind_model'], 'smooth-gusts-v1')
        for decision in result['decisions']:
            obs, time = decision['observation'], decision['time']
            expected = field(obs[1], time)
            self.assertAlmostEqual(obs[9], expected[0])
            self.assertAlmostEqual(obs[10], expected[1])
        with self.assertRaises(ValueError):
            evaluate_closed_loop(lambda obs: Command(0., 0.), state, p, 'centred_descent',
                                 wind_profile=profile, constant_wind=(0., 0.))


if __name__ == '__main__':
    unittest.main()
