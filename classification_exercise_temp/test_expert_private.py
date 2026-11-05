import csv
import json
from pathlib import Path
import tempfile
import unittest

from rocket_closed_loop import OBSERVATION_NAMES
from rocket_expert_private import prepare_private


class PrivateDataTests(unittest.TestCase):
    def test_private_sets_are_separate_and_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            public, private = Path(tmp) / 'public', Path(tmp) / 'private'
            public.mkdir()
            for name in ('train', 'validation'):
                with (public / f'{name}.csv').open('w', newline='', encoding='utf-8') as target:
                    writer = csv.writer(target)
                    writer.writerow([*OBSERVATION_NAMES, 'action'])
                    writer.writerow([*([0] * 12), 0])
            manifest = prepare_private(public, private, agreement_seed=10, evaluation_seed=11,
                                       agreement_count=2, evaluation_count=2, max_time=.1)
            self.assertEqual(manifest['agreement_count'], 2)
            self.assertEqual(private.stat().st_mode & 0o077, 0)
            self.assertTrue((private / 'agreement.csv').exists())
            self.assertEqual(len(json.loads((private / 'evaluation_starts.json').read_text())), 2)
            self.assertFalse((public / 'agreement.csv').exists())
            with self.assertRaisesRegex(ValueError, 'must differ'):
                prepare_private(public, Path(tmp) / 'other', agreement_seed=10, evaluation_seed=10)


if __name__ == '__main__':
    unittest.main()
