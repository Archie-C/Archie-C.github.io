import csv
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rocket_closed_loop import OBSERVATION_NAMES
from rocket_expert_private import prepare_private
from rocket_expert import DiscreteExpert, SOURCE_SHA256


class PrivateDataTests(unittest.TestCase):
    def test_private_sets_are_separate_and_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            public, private = Path(tmp) / 'public', Path(tmp) / 'private'
            public.mkdir()
            expert = DiscreteExpert()
            policy = dict(name='DiscreteExpert.predict_action', version=expert.version,
                          settings=expert.solver_settings, source_sha256=SOURCE_SHA256)
            for name in ('train', 'validation'):
                with (public / f'{name}.csv').open('w', newline='', encoding='utf-8') as target:
                    writer = csv.writer(target)
                    writer.writerow([*OBSERVATION_NAMES, 'action'])
                    writer.writerow([*([0] * 12), 0])
                (public / f'{name}_metadata.jsonl').write_text(json.dumps({'policy': policy}) + '\n')
            manifest = prepare_private(public, private, agreement_seed=10, evaluation_seed=11,
                                       agreement_count=2, evaluation_count=2, max_time=.1)
            self.assertEqual(manifest['agreement_count'], 2)
            self.assertEqual(private.stat().st_mode & 0o077, 0)
            self.assertTrue((private / 'agreement.csv').exists())
            self.assertEqual(len(json.loads((private / 'evaluation_starts.json').read_text())), 2)
            self.assertFalse((public / 'agreement.csv').exists())
            with patch('rocket_expert_private.envelope_violations', side_effect=[['angle of attack'], []]):
                filtered = prepare_private(public, Path(tmp) / 'filtered', agreement_seed=12, evaluation_seed=13,
                                           agreement_count=2, evaluation_count=2, max_time=.1)
            self.assertEqual(filtered['excluded_agreement_observations'],
                             {'angle of attack': 1, 'observations': 1})
            with self.assertRaisesRegex(ValueError, 'must differ'):
                prepare_private(public, Path(tmp) / 'other', agreement_seed=10, evaluation_seed=10)


if __name__ == '__main__':
    unittest.main()
