from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SERVER_ROOT = Path(__file__).resolve().parents[1]


class LofigenServerCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir(mode=0o700)
        self.staging_dir.chmod(0o700)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir(mode=0o700)
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
            "--worker-id",
            "m5-local",
            "--staging-dir",
            str(self.staging_dir),
            "--run-dir",
            str(self.run_dir),
            "--hmac-key-file",
            str(self.key_file),
        ]

    def tailscale_environment(
        self,
        *addresses: str,
        exit_code: int = 0,
    ) -> dict[str, str]:
        binary_dir = self.root / f"tailscale-bin-{len(list(self.root.glob('tailscale-bin-*')))}"
        binary_dir.mkdir()
        binary = binary_dir / "tailscale"
        output = "\n".join(addresses)
        binary.write_text(
            f"#!/bin/sh\nprintf '%s\\n' '{output}'\nexit {exit_code}\n",
            encoding="utf-8",
        )
        binary.chmod(0o700)
        return {"PATH": f"{binary_dir}:{os.environ.get('PATH', '')}"}

    def test_check_config_uses_safe_defaults_without_exposing_paths(self) -> None:
        result = self.run_cli(*self.valid_arguments())

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {
                "bind": "127.0.0.1",
                "port": 8787,
                "protocolVersion": "1",
                "status": "ok",
                "workerId": "m5-local",
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
            "--worker-id",
            "m5-local",
            "--staging-dir",
            str(self.staging_dir),
            "--run-dir",
            str(self.run_dir),
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "hmac_key_required"}, "status": "error"},
            json.loads(result.stderr),
        )
        self.assertNotIn(str(Path.home()), result.stderr)

    def test_worker_identity_is_required(self) -> None:
        result = self.run_cli(
            "--check-config",
            "--staging-dir",
            str(self.staging_dir),
            "--run-dir",
            str(self.run_dir),
            "--hmac-key-file",
            str(self.key_file),
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "worker_id_required"}, "status": "error"},
            json.loads(result.stderr),
        )

    def test_staging_directory_must_be_owned_and_private(self) -> None:
        self.staging_dir.chmod(0o750)

        result = self.run_cli(*self.valid_arguments())

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "unsafe_staging_dir"}, "status": "error"},
            json.loads(result.stderr),
        )

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

    def test_environment_must_explicitly_opt_in_to_a_tailscale_bind(self) -> None:
        environment = self.tailscale_environment(
            "100.64.0.10",
            "fd7a:115c:a1e0::10",
        )
        environment.update(
            {
                "LOFIGEN_ALLOW_NON_LOOPBACK": "true",
                "LOFIGEN_BIND": "100.64.0.10",
            }
        )
        result = self.run_cli(
            *self.valid_arguments(),
            environment=environment,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("100.64.0.10", json.loads(result.stdout)["bind"])

    def test_non_loopback_bind_must_be_a_local_tailscale_address(self) -> None:
        rejected = {
            "192.168.1.20": "tailscale_bind_required",
            "203.0.113.20": "tailscale_bind_required",
            "100.64.0.99": "tailscale_address_not_local",
            "fd00::20": "tailscale_bind_required",
        }

        for bind, error_code in rejected.items():
            with self.subTest(bind=bind):
                environment = self.tailscale_environment(
                    "100.64.0.10",
                    "fd7a:115c:a1e0::10",
                )
                result = self.run_cli(
                    *self.valid_arguments(),
                    "--bind",
                    bind,
                    "--allow-non-loopback",
                    environment=environment,
                )

                self.assertEqual(2, result.returncode)
                self.assertEqual(
                    {"error": {"code": error_code}, "status": "error"},
                    json.loads(result.stderr),
                )

    def test_local_tailscale_ipv6_address_is_accepted(self) -> None:
        environment = self.tailscale_environment(
            "100.64.0.10",
            "fd7a:115c:a1e0::10",
        )
        result = self.run_cli(
            *self.valid_arguments(),
            "--bind",
            "fd7a:115c:a1e0::10",
            "--allow-non-loopback",
            environment=environment,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("fd7a:115c:a1e0::10", json.loads(result.stdout)["bind"])

    def test_tailscale_bind_fails_closed_when_local_cli_is_unavailable(self) -> None:
        empty_path = self.root / "empty-path"
        empty_path.mkdir()
        result = self.run_cli(
            *self.valid_arguments(),
            "--bind",
            "100.64.0.10",
            "--allow-non-loopback",
            environment={"PATH": str(empty_path)},
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "tailscale_unavailable"}, "status": "error"},
            json.loads(result.stderr),
        )

    def test_tailscale_bind_fails_closed_when_no_interface_address_is_reported(self) -> None:
        environment = self.tailscale_environment(exit_code=1)
        result = self.run_cli(
            *self.valid_arguments(),
            "--bind",
            "100.64.0.10",
            "--allow-non-loopback",
            environment=environment,
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "tailscale_unavailable"}, "status": "error"},
            json.loads(result.stderr),
        )

    def test_v1_routes_reject_a_different_protocol_major(self) -> None:
        result = self.run_cli(
            *self.valid_arguments(),
            "--protocol-version",
            "2.0.0",
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "invalid_protocol_version"}, "status": "error"},
            json.loads(result.stderr),
        )

    def test_ace_step_upstream_must_stay_on_loopback(self) -> None:
        result = self.run_cli(
            *self.valid_arguments(),
            "--acestep-url",
            "http://192.0.2.10:8001",
        )

        self.assertEqual(2, result.returncode)
        self.assertEqual(
            {"error": {"code": "unsafe_acestep_url"}, "status": "error"},
            json.loads(result.stderr),
        )


if __name__ == "__main__":
    unittest.main()
