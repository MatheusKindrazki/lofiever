from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from lofigen_server.staging import StagingPathError, StagingRoot


class StagingConfinementTests(unittest.TestCase):
    def test_only_safe_relative_paths_resolve_below_the_staging_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "staging"
            root.mkdir()
            staging = StagingRoot(root)

            resolved = staging.resolve("campaign-1/candidate-1/raw.wav")

            self.assertEqual(root / "campaign-1" / "candidate-1" / "raw.wav", resolved)
            for unsafe_path in [
                "../outside.wav",
                "/tmp/outside.wav",
                "campaign/../../outside.wav",
                "campaign\\..\\outside.wav",
                "campaign/secret\x00.wav",
            ]:
                with self.subTest(unsafe_path=unsafe_path):
                    with self.assertRaises(StagingPathError):
                        staging.resolve(unsafe_path)


if __name__ == "__main__":
    unittest.main()
