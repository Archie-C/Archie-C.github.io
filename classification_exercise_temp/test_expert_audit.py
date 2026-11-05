import csv
from dataclasses import replace
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from rocket_calibration import configuration
from rocket_expert_audit import audit_labels
from rocket_expert_benchmark import benchmark
from rocket_expert_dataset import export_draft


class LabelAuditTests(unittest.TestCase):
    def test_checks_archived_flight_and_recovery_labels(self):
        _, initial = configuration('centred_descent')
        cases = [dict(case_id=f'case-{i}', scenario='centred_descent',
                      initial=replace(initial, x=4. * i)) for i in range(2)]
        report = benchmark(cases, ['discrete_expert'], max_time=.1)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'source.json.gz'
            with gzip.open(archive, 'wt', encoding='utf-8') as target:
                json.dump(report, target, allow_nan=False)
            dataset = root / 'draft'
            export_draft(report, dataset, recovery_per_episode=1)
            self.assertEqual(audit_labels(dataset, archive),
                             {'expert flight': 2, 'perturbed recovery state': 2})
            path = dataset / 'train.csv'
            with path.open(newline='', encoding='utf-8') as source:
                rows = list(csv.reader(source))
            rows[1][-1] = str((int(rows[1][-1]) + 1) % 10)
            with path.open('w', newline='', encoding='utf-8') as target:
                csv.writer(target).writerows(rows)
            with self.assertRaisesRegex(ValueError, 'flight label'):
                audit_labels(dataset, archive)


if __name__ == '__main__':
    unittest.main()
