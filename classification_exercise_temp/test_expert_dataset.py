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

    def test_near_duplicate_leakage_is_rejected(self):
        report = self.make_report(.005)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'near-duplicate'):
                export_draft(report, Path(tmp) / 'draft')


if __name__ == '__main__':
    unittest.main()
