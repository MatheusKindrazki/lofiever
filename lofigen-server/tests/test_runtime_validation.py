from __future__ import annotations

from dataclasses import replace
import io
import math
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from lofigen_server import ServerConfig
from lofigen_server.config import ConfigError, load_config
from lofigen_server.runtime import DrainController
from lofigen_server.safe_logging import SafeJsonLogger
from lofigen_server.server import LofigenHttpServer, create_server
from lofigen_server.staging import StagingRoot


FIXED_KEY = b"0123456789abcdef0123456789abcdef"


def unused_loopback_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])
    finally:
        probe.close()


def descriptors_beneath(root: Path) -> list[str]:
    descriptor_root = Path("/dev/fd")
    if not descriptor_root.exists():
        descriptor_root = Path("/proc/self/fd")
    prefix = str(root.resolve())
    targets: list[str] = []
    for descriptor in descriptor_root.iterdir():
        try:
            target = os.readlink(descriptor)
        except OSError:
            continue
        if target.startswith(prefix):
            targets.append(target)
    return targets


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
        base_config = ServerConfig(
            bind="127.0.0.1",
            port=unused_loopback_port(),
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=self.staging_dir,
            run_dir=self.run_dir,
            hmac_key_file=self.key_file,
            hmac_key=FIXED_KEY,
            hmac_window_seconds=300,
        )

        invalid_values = {
            "wildcard bind": (replace(base_config, bind="0.0.0.0"), "unsafe_bind"),
            "one-byte key": (replace(base_config, hmac_key=b"x"), "invalid_hmac_key"),
            "oversized window": (
                replace(base_config, hmac_window_seconds=301),
                "invalid_hmac_window",
            ),
        }
        for label, (raw_config, code) in invalid_values.items():
            with self.subTest(label=label):
                self.assert_create_rejected(raw_config, code)

        self.staging_dir.chmod(0o755)
        self.assert_create_rejected(base_config, "unsafe_staging_dir")

    def test_boolean_numeric_config_is_rejected_before_http_exposure(self) -> None:
        base_values = {
            **self.values(),
            "vae_chunk": 4,
            "batch_ceiling": 1,
        }
        boolean_fields = {
            "port": "invalid_port",
            "hmac_window_seconds": "invalid_hmac_window",
            "vae_chunk": "invalid_vae_chunk",
            "batch_ceiling": "invalid_batch_ceiling",
        }

        for field, code in boolean_fields.items():
            with self.subTest(field=field):
                with self.assertRaises(ConfigError) as caught:
                    load_config({**base_values, field: True})
                self.assertEqual(code, caught.exception.code)

    def test_direct_http_server_rejects_raw_config_before_bind_or_runtime_handles(self) -> None:
        port = unused_loopback_port()
        missing_key_file = self.root / "missing.key"
        raw_config = ServerConfig(
            bind="0.0.0.0",
            port=port,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=self.staging_dir,
            run_dir=self.run_dir,
            hmac_key_file=missing_key_file,
            hmac_key=b"x",
            hmac_window_seconds=9_999,
        )

        server = None
        try:
            with self.assertRaises(ConfigError) as caught:
                server = LofigenHttpServer(
                    raw_config,
                    clock=lambda: 1_700_000_000,
                    logger=SafeJsonLogger(io.StringIO()),
                    drain_controller=DrainController(),
                    request_timeout_seconds=1,
                    maximum_handlers=1,
                )
        finally:
            if server is not None:
                server.server_close()

        self.assertEqual("unsafe_bind", caught.exception.code)
        self.assertFalse((self.run_dir / "hmac-nonces.sqlite3").exists())
        self.assertEqual([], descriptors_beneath(self.root))
        bind_probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            bind_probe.bind(("0.0.0.0", port))
        finally:
            bind_probe.close()

    def test_invalid_public_http_limits_are_rejected_before_side_effects(self) -> None:
        invalid_limits = [
            ("timeout-true", True, 1),
            ("timeout-false", False, 1),
            ("timeout-nan", math.nan, 1),
            ("timeout-infinity", math.inf, 1),
            ("timeout-zero", 0, 1),
            ("timeout-negative", -1, 1),
            ("handlers-fractional", 1, 1.5),
            ("handlers-nan", 1, math.nan),
            ("handlers-infinity", 1, math.inf),
            ("handlers-true", 1, True),
            ("handlers-false", 1, False),
            ("handlers-zero", 1, 0),
            ("handlers-negative", 1, -1),
        ]

        for label, request_timeout, maximum_handlers in invalid_limits:
            with self.subTest(label=label):
                case_root = self.root / label
                staging_dir = case_root / "staging"
                run_dir = case_root / "run"
                staging_dir.mkdir(parents=True, mode=0o700)
                run_dir.mkdir(mode=0o700)
                key_file = case_root / "hmac.key"
                key_file.write_bytes(FIXED_KEY)
                key_file.chmod(0o600)
                port = unused_loopback_port()
                config = load_config(
                    {
                        "bind": "127.0.0.1",
                        "port": port,
                        "worker_id": "m5-local",
                        "staging_dir": str(staging_dir),
                        "run_dir": str(run_dir),
                        "hmac_key_file": str(key_file),
                    }
                )
                server = None
                try:
                    with self.assertRaises(ValueError) as caught:
                        server = LofigenHttpServer(
                            config,
                            clock=lambda: 1_700_000_000,
                            logger=SafeJsonLogger(io.StringIO()),
                            drain_controller=DrainController(),
                            request_timeout_seconds=request_timeout,
                            maximum_handlers=maximum_handlers,
                        )
                finally:
                    if server is not None:
                        server.server_close()

                self.assertEqual("invalid HTTP safety limits", str(caught.exception))
                self.assertFalse((run_dir / "hmac-nonces.sqlite3").exists())
                self.assertEqual([], descriptors_beneath(case_root))
                bind_probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                try:
                    bind_probe.bind(("127.0.0.1", port))
                finally:
                    bind_probe.close()

    def test_staging_replacement_between_load_and_server_is_rejected(self) -> None:
        config = load_config(self.values())
        original = self.root / "original-staging"
        self.staging_dir.rename(original)
        self.staging_dir.mkdir(mode=0o700)
        self.staging_dir.chmod(0o700)

        self.assert_create_rejected(config, "staging_identity_changed")

    def test_staging_swap_during_server_construction_fails_closed(self) -> None:
        config = load_config(self.values())
        original = self.root / "original-staging"
        swapped = False

        def swapping_staging_root(root: Path, **arguments: object) -> StagingRoot:
            nonlocal swapped
            if not swapped:
                self.staging_dir.rename(original)
                self.staging_dir.mkdir(mode=0o777)
                self.staging_dir.chmod(0o777)
                swapped = True
            return StagingRoot(root, **arguments)

        with patch(
            "lofigen_server.server.StagingRoot",
            side_effect=swapping_staging_root,
        ):
            self.assert_create_rejected(config, "staging_identity_changed")

        self.assertTrue(swapped)

    def test_bind_failure_after_partial_bootstrap_closes_all_runtime_handles(self) -> None:
        occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(occupied.close)
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        values = self.values()
        values["port"] = occupied.getsockname()[1]
        config = load_config(values)

        with self.assertRaises(OSError):
            create_server(config)

        self.assertEqual([], descriptors_beneath(self.root))


if __name__ == "__main__":
    unittest.main()
