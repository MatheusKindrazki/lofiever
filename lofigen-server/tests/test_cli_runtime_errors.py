from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from lofigen_server.cli import main
from lofigen_server.staging import StagingPathError


SERVER_ROOT = Path(__file__).resolve().parents[1]
FIXED_KEY = b"0123456789abcdef0123456789abcdef"


class FailingRuntimeServer:
    def __init__(self, sensitive_path: str) -> None:
        self.sensitive_path = sensitive_path
        self.closed = False

    def serve_forever(self) -> None:
        raise OSError(self.sensitive_path)

    def server_close(self) -> None:
        self.closed = True


class CliRuntimeErrorTests(unittest.TestCase):
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

    def arguments(self, *, port: int = 8787) -> list[str]:
        return [
            "--bind",
            "127.0.0.1",
            "--port",
            str(port),
            "--worker-id",
            "m5-local",
            "--staging-dir",
            str(self.staging_dir),
            "--run-dir",
            str(self.run_dir),
            "--hmac-key-file",
            str(self.key_file),
        ]

    def clean_environment(self) -> dict[str, str]:
        return {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("LOFIGEN_")
        }

    def assert_generic_failure(
        self,
        result: subprocess.CompletedProcess[str],
        *,
        code: str,
    ) -> None:
        self.assertEqual(1, result.returncode)
        self.assertEqual(
            {"error": {"code": code}, "status": "error"},
            json.loads(result.stderr),
        )
        self.assertEqual("", result.stdout)
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn(str(Path.home()), result.stderr)
        self.assertNotIn(str(self.root), result.stderr)

    def test_bind_failure_is_structured_and_redacted(self) -> None:
        occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(occupied.close)
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        port = occupied.getsockname()[1]

        result = subprocess.run(
            [sys.executable, "-m", "lofigen_server", *self.arguments(port=port)],
            cwd=SERVER_ROOT,
            env=self.clean_environment(),
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )

        self.assert_generic_failure(result, code="runtime_start_failed")

    def test_sqlite_setup_failure_is_structured_and_redacted(self) -> None:
        nonce_store = self.run_dir / "hmac-nonces.sqlite3"
        nonce_store.symlink_to(Path.home(), target_is_directory=True)

        result = subprocess.run(
            [sys.executable, "-m", "lofigen_server", *self.arguments()],
            cwd=SERVER_ROOT,
            env=self.clean_environment(),
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )

        self.assert_generic_failure(result, code="runtime_start_failed")

    def test_staging_setup_failure_is_structured_and_redacted(self) -> None:
        sensitive_path = str(Path.home() / "private-staging")
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            patch(
                "lofigen_server.server.create_server",
                side_effect=StagingPathError(sensitive_path),
            ),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            exit_code = main(self.arguments())

        self.assertEqual(1, exit_code)
        self.assertEqual("", stdout.getvalue())
        self.assertEqual(
            {
                "error": {"code": "runtime_start_failed"},
                "status": "error",
            },
            json.loads(stderr.getvalue()),
        )
        self.assertNotIn(sensitive_path, stderr.getvalue())

    def test_serve_failure_is_structured_redacted_and_closes_server(self) -> None:
        sensitive_path = str(Path.home() / "private-runtime")
        fake_server = FailingRuntimeServer(sensitive_path)
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            patch("lofigen_server.server.create_server", return_value=fake_server),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            exit_code = main(self.arguments())

        self.assertEqual(1, exit_code)
        self.assertTrue(fake_server.closed)
        self.assertEqual("", stdout.getvalue())
        self.assertEqual(
            {"error": {"code": "runtime_failed"}, "status": "error"},
            json.loads(stderr.getvalue()),
        )
        self.assertNotIn(sensitive_path, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
