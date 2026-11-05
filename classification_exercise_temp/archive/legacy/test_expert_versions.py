import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

from rocket_expert import EXPERT_VERSION, SOURCE_SHA256
import rocket_expert_versions
from rocket_expert_versions import load_expert


class ExpertVersionTests(unittest.TestCase):
    def test_current_and_exact_archived_sources(self):
        archived_current = Path(__file__).resolve().parents[2] / 'versions' / EXPERT_VERSION / 'rocket_expert.py'
        self.assertEqual(hashlib.sha256(archived_current.read_bytes()).hexdigest(), SOURCE_SHA256)
        current = load_expert(EXPERT_VERSION, SOURCE_SHA256)
        self.assertEqual(current.EXPERT_VERSION, EXPERT_VERSION)
        with patch.object(rocket_expert_versions.rocket_expert, 'SOURCE_SHA256', 'different'):
            archived = load_expert(EXPERT_VERSION, SOURCE_SHA256)
        self.assertIsNot(archived, current)
        self.assertEqual(archived.SOURCE_SHA256, SOURCE_SHA256)
        archive = Path(__file__).resolve().parents[2] / 'versions' / 'expert-prototype-v0.4' / 'rocket_expert.py'
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        old = load_expert('expert-prototype-v0.4', digest)
        self.assertEqual(old.EXPERT_VERSION, 'expert-prototype-v0.4')
        self.assertEqual(old.SOURCE_SHA256, digest)
        self.assertIs(load_expert('continuous-reference-prototype-v0.2', digest), old)
        self.assertEqual(load_expert(current.ContinuousReference.version, SOURCE_SHA256).SOURCE_SHA256, current.SOURCE_SHA256)
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            load_expert('expert-prototype-v0.4', '0' * 64)


if __name__ == '__main__':
    unittest.main()
