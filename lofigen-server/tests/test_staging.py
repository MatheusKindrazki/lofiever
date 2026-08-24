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

    def test_secure_io_creates_and_reads_artifacts_beneath_the_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "staging"
            root.mkdir()
            staging = StagingRoot(root)
            self.addCleanup(staging.close)

            with staging.open_for_write(
                "campaign-1/candidate-1/raw.wav",
                create_parents=True,
            ) as artifact:
                artifact.write(b"RIFF-safe-audio")
            with staging.open_for_read(
                "campaign-1/candidate-1/raw.wav"
            ) as artifact:
                rendered = artifact.read()

            self.assertEqual(b"RIFF-safe-audio", rendered)
            self.assertEqual(
                b"RIFF-safe-audio",
                (root / "campaign-1" / "candidate-1" / "raw.wav").read_bytes(),
            )

    def test_descendant_swap_after_preview_cannot_redirect_secure_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            root = workspace / "staging"
            outside = workspace / "outside"
            root.mkdir()
            outside.mkdir()
            campaign = root / "campaign-1"
            campaign.mkdir()
            canonical_root = root.resolve()
            staging = StagingRoot(root)
            self.addCleanup(staging.close)

            preview = staging.resolve("campaign-1/raw.wav")
            campaign.rename(root / "detached-campaign")
            campaign.symlink_to(outside, target_is_directory=True)

            with self.assertRaises(StagingPathError):
                with staging.open_for_write("campaign-1/raw.wav"):
                    self.fail("secure staging I/O followed a swapped symlink")

            self.assertEqual(canonical_root / "campaign-1" / "raw.wav", preview)
            self.assertFalse((outside / "raw.wav").exists())

    def test_root_path_swap_does_not_redirect_the_open_staging_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            root = workspace / "staging"
            original_root = workspace / "original-staging"
            outside = workspace / "outside"
            root.mkdir()
            outside.mkdir()
            staging = StagingRoot(root)
            self.addCleanup(staging.close)

            root.rename(original_root)
            root.symlink_to(outside, target_is_directory=True)
            with staging.open_for_write("artifact.wav") as artifact:
                artifact.write(b"confined")

            self.assertEqual(b"confined", (original_root / "artifact.wav").read_bytes())
            self.assertFalse((outside / "artifact.wav").exists())

    def test_final_symlink_is_rejected_for_read_and_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            root = workspace / "staging"
            outside = workspace / "outside.wav"
            root.mkdir()
            outside.write_bytes(b"outside")
            (root / "artifact.wav").symlink_to(outside)
            staging = StagingRoot(root)
            self.addCleanup(staging.close)

            with self.assertRaises(StagingPathError):
                with staging.open_for_read("artifact.wav"):
                    self.fail("secure staging read followed a symlink")
            with self.assertRaises(StagingPathError):
                with staging.open_for_write("artifact.wav"):
                    self.fail("secure staging write followed a symlink")

            self.assertEqual(b"outside", outside.read_bytes())


if __name__ == "__main__":
    unittest.main()
