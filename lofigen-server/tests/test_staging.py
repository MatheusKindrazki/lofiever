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

            self.assertEqual(
                root.resolve() / "campaign-1" / "candidate-1" / "raw.wav",
                resolved,
            )
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

    def test_symlink_cannot_escape_the_staging_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            root = workspace / "staging"
            outside = workspace / "outside"
            root.mkdir()
            outside.mkdir()
            (root / "escape").symlink_to(outside, target_is_directory=True)

            with self.assertRaises(StagingPathError):
                StagingRoot(root).resolve("escape/audio.wav")

    def test_staging_root_itself_cannot_be_a_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            real_root = workspace / "real-staging"
            linked_root = workspace / "linked-staging"
            real_root.mkdir()
            linked_root.symlink_to(real_root, target_is_directory=True)

            with self.assertRaises(StagingPathError):
                StagingRoot(linked_root)


if __name__ == "__main__":
    unittest.main()
