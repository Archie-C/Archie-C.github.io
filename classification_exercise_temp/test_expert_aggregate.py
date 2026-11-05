import gzip
import json
from pathlib import Path
import unittest

from rocket_expert_aggregate import summarize_reports


class AggregateTests(unittest.TestCase):
    def test_complete_report_and_inconsistent_metrics(self):
        root = Path(__file__).parent / 'benchmarks'
        with gzip.open(root / 'diagnostic-controllers-v0.5-full-report.json.gz', 'rt') as source:
            diagnostic = json.load(source)
        with gzip.open(root / 'feasibility-v1.0-controllers-v0.5-full-report.json.gz', 'rt') as source:
            feasibility = json.load(source)
        result = summarize_reports(diagnostic, feasibility)
        self.assertEqual(len(result['sets']['diagnostic']['cases']), 12)
        self.assertEqual(len(result['sets']['feasibility']['cases']), 12)
        self.assertTrue(result['final_target_met'])
        self.assertEqual(result['sets']['diagnostic']['policies']['discrete_expert']['metrics']['successful_runs'], 6)
        self.assertEqual(result['sets']['feasibility']['policies']['discrete_expert']['metrics']['successful_runs'], 12)
        feasibility['policies']['discrete_expert']['metrics']['successful_runs'] = 11
        with self.assertRaisesRegex(ValueError, 'aggregate differs'):
            summarize_reports(diagnostic, feasibility)


if __name__ == '__main__':
    unittest.main()
