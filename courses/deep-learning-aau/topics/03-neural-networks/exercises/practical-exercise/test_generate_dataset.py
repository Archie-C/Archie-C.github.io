"""Dataset integrity, deterministic sampling and interrupted-batch recovery."""
import csv
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rocket_closed_loop import make_observation
import generate_dataset as generation


def fake_flight(policy, initial, parameters, scenario, **kwargs):
    observation = make_observation(initial, 0, parameters).tolist()
    return dict(replay=dict(status='contact'), scoring=dict(success=False, score=0.),
                termination_reason='first ground contact', policy_seconds=.01,
                decisions=[dict(observation=observation,
                                command=dict(throttle=.24, gimbal=-.37))])


class DatasetTests(unittest.TestCase):
    def test_invalid_worker_counts_do_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'data.csv'
            for workers in (0, -1, True, 1.5):
                with self.assertRaisesRegex(ValueError, 'workers must be a positive integer'):
                    generation.generate_dataset(output, workers=workers)
            self.assertFalse(output.exists())

    def test_sampling_is_stable_by_seed_and_run_id(self):
        ranges = generation.validate_ranges(generation.DEFAULT_RANGES)
        _, first, wind = generation.sample_case(42, 8, ranges)
        _, same, same_wind = generation.sample_case(42, 8, ranges)
        _, other, _ = generation.sample_case(42, 9, ranges)
        self.assertEqual(first, same)
        self.assertEqual(wind, same_wind)
        self.assertNotEqual(first, other)
        for key, value in zip(('x', 'y', 'vx', 'vy', 'theta', 'omega', 'fuel_mass'), first.values()):
            self.assertTrue(ranges[key][0] <= value <= ranges[key][1])

    def test_rows_use_normalized_commands_and_eventual_outcome(self):
        p, state, _ = generation.sample_case(4, 0, generation.DEFAULT_RANGES)
        result = fake_flight(None, state, p, 'centred_descent')
        rows = generation.flight_rows(7, result)
        row = dict(zip(generation.CSV_COLUMNS, rows[0]))
        self.assertEqual(row['thrust'], .24)
        self.assertEqual(row['gimbal'], -.37)
        self.assertEqual(row['actual_thrust'], 0.)
        self.assertEqual(row['success'], 0)
        self.assertNotIn('action', row)
        result['decisions'][0]['command']['throttle'] = 1.1
        with self.assertRaises(ValueError):
            generation.flight_rows(7, result)

    @patch.object(generation, 'evaluate_closed_loop', side_effect=fake_flight)
    def test_resume_discards_uncommitted_bytes_and_matches_fresh_batch(self, evaluate):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root/'resumed.csv'
            generation.generate_dataset(output, runs=2, progress=None)
            prefix = output.read_bytes()
            with output.open('ab') as file:
                file.write(b'partial interrupted run,garbage\n')
            resumed = generation.generate_dataset(output, runs=3, resume=True, progress=None)
            self.assertTrue(output.read_bytes().startswith(prefix))
            generation.generate_dataset(root/'fresh.csv', runs=3, progress=None)
            self.assertEqual(output.read_bytes(), (root/'fresh.csv').read_bytes())
            self.assertEqual(len(resumed['runs']), 3)
            rows = list(csv.DictReader(io.StringIO(output.read_text())))
            self.assertEqual([row['run_id'] for row in rows], ['0', '1', '2'])
            self.assertEqual([row['step'] for row in rows], ['0', '0', '0'])
            self.assertEqual(evaluate.call_count, 6)

    @patch.object(generation, 'evaluate_closed_loop', side_effect=fake_flight)
    def test_existing_files_changed_settings_and_edits_are_rejected(self, evaluate):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'data.csv'
            generation.generate_dataset(output, runs=1, progress=None)
            original = output.read_bytes()
            with self.assertRaises(FileExistsError):
                generation.generate_dataset(output, runs=1, progress=None)
            with self.assertRaisesRegex(ValueError, 'different generation settings'):
                generation.generate_dataset(output, runs=2, seed=43, resume=True, progress=None)
            self.assertEqual(output.read_bytes(), original)
            output.write_bytes(original.replace(b'0.24', b'0.25'))
            with self.assertRaisesRegex(ValueError, 'differs from its checkpoint'):
                generation.generate_dataset(output, runs=2, resume=True, progress=None)

    def test_real_expert_parallel_output_and_resume_match_serial(self):
        ranges = dict(generation.DEFAULT_RANGES)
        for key, value in dict(x=0., y=25., vx=0., vy=-2., theta=0., omega=0.,
                               fuel_mass=4000., wind_x=0., wind_y=0.).items():
            ranges[key] = (value, value)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'landings.csv'
            metadata = generation.generate_dataset(output, runs=2, ranges=ranges, sampling='legacy', progress=None)
            with output.open(newline='') as file:
                reader = csv.DictReader(file)
                self.assertEqual(reader.fieldnames, list(generation.CSV_COLUMNS))
                rows = list(reader)
            self.assertEqual(len(metadata['runs']), 2)
            self.assertTrue(all(run['scoring']['success'] for run in metadata['runs']))
            self.assertEqual(sum(run['rows'] for run in metadata['runs']), len(rows))
            self.assertTrue(any(0 < float(row['thrust']) < 1 for row in rows))
            for run_id in ('0', '1'):
                run_rows = [row for row in rows if row['run_id'] == run_id]
                self.assertEqual([int(row['step']) for row in run_rows], list(range(len(run_rows))))
                self.assertTrue(all(row['success'] == '1' for row in run_rows))
            generation.verify_checkpoint(output, metadata)
            parallel_output = Path(directory)/'parallel.csv'
            parallel = generation.generate_dataset(parallel_output, runs=2, ranges=ranges, sampling='legacy',
                                                   workers=2, progress=None)
            self.assertEqual(parallel_output.read_bytes(), output.read_bytes())
            self.assertEqual([run['scoring'] for run in parallel['runs']],
                             [run['scoring'] for run in metadata['runs']])
            # Scheduling is an execution detail: resume with a different size.
            extended = generation.generate_dataset(parallel_output, runs=3, ranges=ranges, sampling='legacy',
                                                   workers=1, resume=True, progress=None)
            self.assertEqual(len(extended['runs']), 3)
            self.assertTrue(parallel_output.read_bytes().startswith(output.read_bytes()))
            generation.verify_checkpoint(parallel_output, extended)


if __name__ == '__main__':
    unittest.main()
