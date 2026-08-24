from __future__ import annotations

import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from lofigen_server import ServerConfig
from lofigen_server.config import ConfigError, load_config
from lofigen_server.server import create_server


FIXED_KEY = b"0123456789abcdef0123456789abcdef"


def unused_loopback_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])
    finally:
        probe.close()


class RuntimeConfigValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir(mode=0o700)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir(mode=0o700)
        self.key_file = self.root / "hmac.key"
        self.key_file.write_bytes(FIXED_KEY)
        self.key_file.chmod(0o600)

    def values(self) -> dict[str, object]:
        return {
            "bind": "127.0.0.1",
            "port": unused_loopback_port(),
            "protocol_version": "1",
            "worker_id": "m5-local",
            "staging_dir": str(self.staging_dir),
            "run_dir": str(self.run_dir),
            "hmac_key_file": str(self.key_file),
            "hmac_window_seconds": 300,
        }

    def assert_create_rejected(self, config: ServerConfig, code: str) -> None:
        server = None
        try:
            with self.assertRaises(ConfigError) as caught:
                server = create_server(config)
            self.assertEqual(code, caught.exception.code)
        finally:
            if server is not None:
                server.server_close()

    def test_create_server_revalidates_a_raw_server_config(self) -> None:
        self.staging_dir.chmod(0o755)
        raw_config = ServerConfig(
            bind="0.0.0.0",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=self.staging_dir,
            run_dir=self.run_dir,
            hmac_key_file=self.key_file,
            hmac_key=b"x",
            hmac_window_seconds=301,
        )

        self.assert_create_rejected(raw_config, "unsafe_bind")

    def test_staging_replacement_between_load_and_server_is_rejected(self) -> None:
        config = load_config(self.values())
        original = self.root / "original-staging"
        self.staging_dir.rename(original)
        self.staging_dir.mkdir(mode=0o777)
        self.staging_dir.chmod(0o777)

        self.assert_create_rejected(config, "unsafe_staging_dir")

    def test_staging_swap_during_server_construction_fails_closed(self) -> None:
        config = load_config(self.values())
        original = self.root / "original-staging"
        real_open = os.open
        swapped = False

        def swapping_open(
            path: object,
            flags: int,
            mode: int = 0o777,
            *,
            dir_fd: int | None = None,
        ) -> int:
            nonlocal swapped
            if not swapped and dir_fd is None and Path(path) == self.staging_dir:
                self.staging_dir.rename(original)
                self.staging_dir.mkdir(mode=0o777)
                self.staging_dir.chmod(0o777)
                swapped = True
            return real_open(path, flags, mode, dir_fd=dir_fd)

        with patch("lofigen_server.staging.os.open", side_effect=swapping_open):
            self.assert_create_rejected(config, "staging_identity_changed")

        self.assertTrue(swapped)


if __name__ == "__main__":
    unittest.main()
