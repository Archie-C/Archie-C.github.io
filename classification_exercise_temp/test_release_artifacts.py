import csv
import gzip
import hashlib
import json
from pathlib import Path
import unittest

import numpy as np

from rocket_calibration import configuration
from rocket_closed_loop import OBSERVATION_NAMES
from rocket_observation_scope import envelope_violations
from rocket_expert_dataset import _near_duplicate


class ReleaseArtifactTests(unittest.TestCase):
    def test_frozen_schema_splits_and_archived_evidence(self):
        root = Path(__file__).parent
        data = root / 'datasets' / 'expert-data-v1.1'
        manifest = json.loads((data / 'manifest.json').read_text(encoding='utf-8'))
        audit = json.loads((root / 'benchmarks' / 'expert-data-v1.1-label-audit.json').read_text(encoding='utf-8'))
        groups, observations = [], []
        for split in ('train', 'validation'):
            path = data / f'{split}.csv'
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), manifest['train_validation_sha256'][path.name])
            with path.open(newline='', encoding='utf-8') as source:
                reader = csv.reader(source)
                self.assertEqual(next(reader), [*OBSERVATION_NAMES, 'action'])
                rows = list(reader)
            values = np.array([[float(v) for v in row[:-1]] for row in rows])
            actions = np.array([int(row[-1]) for row in rows])
            self.assertEqual(values.shape[1], 12)
            self.assertTrue(np.all(np.isfinite(values)))
            self.assertTrue(np.all((actions >= 0) & (actions <= 9)))
            self.assertEqual({str(i): int(np.sum(actions == i)) for i in range(10)}, manifest['class_counts'][split])
            metadata_path = data / f'{split}_metadata.jsonl'
            self.assertEqual(hashlib.sha256(metadata_path.read_bytes()).hexdigest(), audit['dataset_files'][metadata_path.name])
            metadata = [json.loads(line) for line in metadata_path.read_text(encoding='utf-8').splitlines()]
            self.assertEqual(len(rows), len(metadata))
            for value, item in zip(values, metadata):
                p, _ = configuration(item['scenario'])
                self.assertEqual(envelope_violations(value, item['time'], p), [])
            groups.append({item['group'] for item in metadata})
            observations.append(values.tolist())
        self.assertFalse(groups[0] & groups[1])
        self.assertFalse(_near_duplicate(*observations))
        self.assertEqual(audit['counts'], {'expert flight': 1401, 'perturbed recovery state': 180})
        self.assertEqual(manifest['label_audit'], audit['counts'])
        self.assertEqual(manifest['excluded_flight_observations'], {'angle of attack': 54, 'observations': 54})
        source_archive = root / 'benchmarks' / 'feasibility-study-expert-v0.4-full-report.json.gz'
        self.assertEqual(hashlib.sha256(source_archive.read_bytes()).hexdigest(), audit['source_archive_sha256'])
        self.assertEqual(manifest['source_archive_sha256'], audit['source_archive_sha256'])
        for key, name in (('final_report_sha256', 'feasibility-v1.0-full-report.json.gz'),
                          ('sanity_report_sha256', 'classifier-v1.1-full-report.json.gz')):
            digest = hashlib.sha256()
            with gzip.open(root / 'benchmarks' / name, 'rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
            self.assertEqual(digest.hexdigest(), manifest[key])
        teacher = root / 'versions' / audit['teacher_version'] / 'rocket_expert.py'
        self.assertEqual(hashlib.sha256(teacher.read_bytes()).hexdigest(), audit['teacher_source_sha256'])
        self.assertEqual(manifest['final_expert_metrics']['successful_runs'], 12)
        self.assertTrue(manifest['deterministic_replay_verified'])


if __name__ == '__main__':
    unittest.main()
