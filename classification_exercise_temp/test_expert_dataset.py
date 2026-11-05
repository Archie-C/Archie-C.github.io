import csv
import json
from pathlib import Path
import tempfile
import unittest
from dataclasses import replace

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES
from rocket_expert_benchmark import benchmark
from rocket_expert_dataset import export_draft


class DatasetTests(unittest.TestCase):
    def make_report(self, distance):
        _, initial = configuration('centred_descent')
        cases = [dict(case_id='one', scenario='centred_descent', initial=initial),
                 dict(case_id='two', scenario='centred_descent', initial=replace(initial, x=initial.x+distance))]
        return benchmark(cases, ['discrete_expert'], max_time=.1)

    def test_episode_split_and_schema(self):
        report = self.make_report(4.)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'draft'
            manifest = export_draft(report, path, seed=7)
            self.assertEqual(manifest['episode_counts'], {'train': 1, 'validation': 1})
            groups = []
            for split in ('train', 'validation'):
                with (path / f'{split}.csv').open(newline='', encoding='utf-8') as data:
                    rows = list(csv.reader(data))
                self.assertEqual(rows[0], [*OBSERVATION_NAMES, 'action'])
                self.assertEqual(len(rows), 2)
                self.assertIn(int(rows[1][-1]), range(10))
                metadata = json.loads((path / f'{split}_metadata.jsonl').read_text())
                groups.append(metadata['group'])
            self.assertNotEqual(*groups)
            self.assertEqual(manifest['status'], 'experimental; not approved for release')
            with self.assertRaisesRegex(ValueError, 'empty'):
                export_draft(report, path)

    def test_recovery_samples_are_deterministic_and_provenanced(self):
        report = self.make_report(4.)
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp) / 'one', Path(tmp) / 'two'
            a = export_draft(report, first, seed=7, recovery_per_episode=1)
            b = export_draft(report, second, seed=7, recovery_per_episode=1)
            self.assertEqual(a, b)
            for split in ('train', 'validation'):
                self.assertEqual((first / f'{split}.csv').read_bytes(), (second / f'{split}.csv').read_bytes())
                metadata = [json.loads(line) for line in (first / f'{split}_metadata.jsonl').read_text().splitlines()]
                self.assertEqual([row['provenance'] for row in metadata],
                                 ['expert flight', 'perturbed recovery state'])
                self.assertEqual(metadata[0]['group'], metadata[1]['group'])

    def test_private_agreement_is_separate_by_episode(self):
        _, initial = configuration('centred_descent')
        cases = [dict(case_id=f'case-{i}', scenario='centred_descent', initial=replace(initial, x=4.*i))
                 for i in range(3)]
        report = benchmark(cases, ['discrete_expert'], max_time=.1)
        with tempfile.TemporaryDirectory() as tmp:
            public, private = Path(tmp) / 'public', Path(tmp) / 'private'
            manifest = export_draft(report, public, private_output=private, seed=7)
            self.assertEqual(manifest['episode_counts'], {'train': 1, 'validation': 1, 'agreement': 1})
            self.assertFalse((public / 'agreement.csv').exists())
            self.assertTrue((private / 'agreement.csv').exists())
            groups = []
            for path in (public / 'train_metadata.jsonl', public / 'validation_metadata.jsonl',
                         private / 'agreement_metadata.jsonl'):
                groups.append(json.loads(path.read_text())['group'])
            self.assertEqual(len(set(groups)), 3)
            self.assertEqual(private.stat().st_mode & 0o077, 0)

    def test_near_duplicate_leakage_is_rejected(self):
        report = self.make_report(.005)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'near-duplicate'):
                export_draft(report, Path(tmp) / 'draft')


if __name__ == '__main__':
    unittest.main()
