from __future__ import annotations

import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from lofigen_server.config import ConfigError, load_config


ORIGINAL_KEY = b"0123456789abcdef0123456789abcdef"
REPLACEMENT_KEY = b"fedcba9876543210fedcba9876543210"


class HmacKeyLoadingSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir(mode=0o700)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir(mode=0o700)

    def values(self, key_file: Path) -> dict[str, object]:
        return {
            "staging_dir": str(self.staging_dir),
            "run_dir": str(self.run_dir),
            "hmac_key_file": str(key_file),
        }

    def write_key(self, path: Path, key: bytes = ORIGINAL_KEY) -> None:
        path.write_bytes(key)
        path.chmod(0o600)

    def assert_config_error(self, code: str, key_file: Path) -> None:
        with self.assertRaises(ConfigError) as caught:
            load_config(self.values(key_file))
        self.assertEqual(code, caught.exception.code)

    def test_key_symlink_and_symlinked_parent_are_rejected(self) -> None:
        real_key = self.root / "real.key"
        linked_key = self.root / "linked.key"
        self.write_key(real_key)
        linked_key.symlink_to(real_key)
        self.assert_config_error("unsafe_hmac_key_file", linked_key)

        real_parent = self.root / "real-parent"
        real_parent.mkdir(mode=0o700)
        nested_key = real_parent / "hmac.key"
        self.write_key(nested_key)
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(real_parent, target_is_directory=True)
        self.assert_config_error(
            "unsafe_hmac_key_parent",
            linked_parent / "hmac.key",
        )

    def test_key_and_direct_parent_permissions_are_private(self) -> None:
        key_file = self.root / "group-readable.key"
        self.write_key(key_file)
        key_file.chmod(0o640)
        self.assert_config_error("hmac_key_permissions", key_file)

        unsafe_parent = self.root / "unsafe-parent"
        unsafe_parent.mkdir(mode=0o770)
        unsafe_parent.chmod(0o770)
        nested_key = unsafe_parent / "hmac.key"
        self.write_key(nested_key)
        self.assert_config_error("hmac_key_parent_permissions", nested_key)

    def test_key_is_read_from_the_same_descriptor_that_was_validated(self) -> None:
        key_file = self.root / "hmac.key"
        replacement = self.root / "replacement.key"
        self.write_key(key_file)
        self.write_key(replacement, REPLACEMENT_KEY)
        real_read_bytes = Path.read_bytes
        real_fstat = os.fstat
        swapped = False

        def swap_path_once() -> None:
            nonlocal swapped
            if not swapped:
                os.replace(replacement, key_file)
                swapped = True

        def swapping_read_bytes(path: Path) -> bytes:
            if path == key_file:
                swap_path_once()
            return real_read_bytes(path)

        def swapping_fstat(descriptor: int) -> os.stat_result:
            metadata = real_fstat(descriptor)
            if stat.S_ISREG(metadata.st_mode):
                swap_path_once()
            return metadata

        with (
            patch.object(Path, "read_bytes", swapping_read_bytes),
            patch("lofigen_server.config.os.fstat", side_effect=swapping_fstat),
        ):
            config = load_config(self.values(key_file))

        self.assertTrue(swapped)
        self.assertEqual(ORIGINAL_KEY, config.hmac_key)
        self.assertEqual(REPLACEMENT_KEY, key_file.read_bytes())

    def test_parent_swap_cannot_redirect_the_validated_key_open(self) -> None:
        key_parent = self.root / "key-parent"
        detached_parent = self.root / "detached-key-parent"
        attacker_parent = self.root / "attacker-parent"
        key_parent.mkdir(mode=0o700)
        attacker_parent.mkdir(mode=0o700)
        key_file = key_parent / "hmac.key"
        attacker_key = attacker_parent / "hmac.key"
        self.write_key(key_file)
        self.write_key(attacker_key, REPLACEMENT_KEY)
        original_parent_inode = key_parent.stat().st_ino
        real_open = os.open
        real_fstat = os.fstat
        swapped = False

        def swap_parent_once() -> None:
            nonlocal swapped
            if not swapped:
                key_parent.rename(detached_parent)
                key_parent.symlink_to(attacker_parent, target_is_directory=True)
                swapped = True

        def swapping_open(
            path: object,
            flags: int,
            mode: int = 0o777,
            *,
            dir_fd: int | None = None,
        ) -> int:
            if dir_fd is None and Path(path) == key_file:
                swap_parent_once()
            return real_open(path, flags, mode, dir_fd=dir_fd)

        def swapping_fstat(descriptor: int) -> os.stat_result:
            metadata = real_fstat(descriptor)
            if stat.S_ISDIR(metadata.st_mode) and metadata.st_ino == original_parent_inode:
                swap_parent_once()
            return metadata

        with (
            patch("lofigen_server.config.os.open", side_effect=swapping_open),
            patch("lofigen_server.config.os.fstat", side_effect=swapping_fstat),
        ):
            config = load_config(self.values(key_file))

        self.assertTrue(swapped)
        self.assertEqual(ORIGINAL_KEY, config.hmac_key)
        self.assertEqual(REPLACEMENT_KEY, (key_parent / "hmac.key").read_bytes())


if __name__ == "__main__":
    unittest.main()
