from pathlib import Path
import tempfile
import unittest

from rocket_expert_release import freeze_dataset


class ReleaseTests(unittest.TestCase):
    def test_existing_output_and_insecure_private_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private = root / 'private'
            private.mkdir(mode=0o755)
            private.chmod(0o755)
            with self.assertRaisesRegex(ValueError, 'already exist'):
                freeze_dataset(root / 'draft', private, root / 'report', root / 'sanity', root)
            with self.assertRaisesRegex(ValueError, 'owner-only'):
                freeze_dataset(root / 'draft', private, root / 'report', root / 'sanity', root / 'release')
            self.assertFalse((root / 'release').exists())


if __name__ == '__main__':
    unittest.main()
