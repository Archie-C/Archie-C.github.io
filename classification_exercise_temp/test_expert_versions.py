import hashlib
from pathlib import Path
import unittest

from rocket_expert import EXPERT_VERSION, SOURCE_SHA256
from rocket_expert_versions import load_expert


class ExpertVersionTests(unittest.TestCase):
    def test_current_and_exact_archived_sources(self):
        current = load_expert(EXPERT_VERSION, SOURCE_SHA256)
        self.assertEqual(current.EXPERT_VERSION, EXPERT_VERSION)
        archive = Path(__file__).parent / 'versions' / 'expert-prototype-v0.4' / 'rocket_expert.py'
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        old = load_expert('expert-prototype-v0.4', digest)
        self.assertEqual(old.EXPERT_VERSION, 'expert-prototype-v0.4')
        self.assertEqual(old.SOURCE_SHA256, digest)
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            load_expert('expert-prototype-v0.4', '0' * 64)


if __name__ == '__main__':
    unittest.main()
