from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SERVER_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = SERVER_ROOT / "src"


class LofigenServerCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir()
        self.key_file = self.root / "hmac.key"
        self.key_file.write_bytes(b"k" * 32)
        self.key_file.chmod(0o600)

    def run_cli(
        self,
        *arguments: str,
        environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        clean_environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("LOFIGEN_")
        }
        clean_environment["PYTHONPATH"] = str(SOURCE_ROOT)
        clean_environment.update(environment or {})

        return subprocess.run(
            [sys.executable, "-m", "lofigen_server", *arguments],
            cwd=SERVER_ROOT,
            env=clean_environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def valid_arguments(self) -> list[str]:
        return [
            "--check-config",
            "--staging-dir",
            str(self.staging_dir),
            "--hmac-key-file",
            str(self.key_file),
        ]

    def test_check_config_uses_safe_defaults_without_exposing_paths(self) -> None:
        result = self.run_cli(*self.valid_arguments())

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {
                "bind": "127.0.0.1",
                "port": 8787,
                "protocolVersion": "1",
                "status": "ok",
                "workerId": "local-worker",
            },
            json.loads(result.stdout),
        )
        self.assertNotIn(str(self.root), result.stdout)

    def test_cli_overrides_environment_for_configurable_port(self) -> None:
        result = self.run_cli(
            *self.valid_arguments(),
            "--port",
            "9000",
            environment={"LOFIGEN_PORT": "8899"},
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(9000, json.loads(result.stdout)["port"])

    def test_startup_fails_closed_without_hmac_key_file(self) -> None:
        result = self.run_cli(
            "--check-config",
            "--staging-dir",
            str(self.staging_dir),
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "hmac_key_required"}, "status": "error"},
            json.loads(result.stderr),
        )
        self.assertNotIn(str(Path.home()), result.stderr)

    def test_startup_rejects_wildcard_bind_even_when_non_loopback_is_explicit(self) -> None:
        result = self.run_cli(
            *self.valid_arguments(),
            "--bind",
            "0.0.0.0",
            "--allow-non-loopback",
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "unsafe_bind"}, "status": "error"},
            json.loads(result.stderr),
        )


if __name__ == "__main__":
    unittest.main()
