from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
from http.client import HTTPConnection
import io
from pathlib import Path
import socket
import tempfile
import threading
from typing import Iterator
import unittest

from lofigen_server.config import ServerConfig, load_config
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_KEY = b"0123456789abcdef0123456789abcdef"
FIXED_NOW = 1_700_000_000
WORKER_ID = "m5-local"


def unused_loopback_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])
    finally:
        probe.close()


def signed_headers(nonce: str) -> dict[str, str]:
    message = "\n".join(
        [
            "LOFIEVER-HMAC-SHA256-V1",
            WORKER_ID,
            "GET",
            "/v1/capabilities",
            str(FIXED_NOW),
            nonce,
            hashlib.sha256(b"").hexdigest(),
        ]
    ).encode("utf-8")
    return {
        "X-Lofiever-Signature-Version": "1",
        "X-Lofiever-Worker-Id": WORKER_ID,
        "X-Lofiever-Timestamp": str(FIXED_NOW),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": hmac.new(
            FIXED_KEY,
            message,
            hashlib.sha256,
        ).hexdigest(),
    }


def request_capabilities(server: LofigenHttpServer, nonce: str) -> int:
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request(
        "GET",
        "/v1/capabilities",
        headers=signed_headers(nonce),
    )
    response = connection.getresponse()
    response.read()
    connection.close()
    return response.status


@contextmanager
def running_server(config: ServerConfig) -> Iterator[LofigenHttpServer]:
    server = create_server(
        config,
        clock=lambda: FIXED_NOW,
        log_stream=io.StringIO(),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=False)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class NonceStoreIdentityTests(unittest.TestCase):
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

    def config_for(self, run_dir: Path) -> ServerConfig:
        return load_config(
            {
                "bind": "127.0.0.1",
                "port": unused_loopback_port(),
                "worker_id": WORKER_ID,
                "staging_dir": str(self.staging_dir),
                "run_dir": str(run_dir),
                "hmac_key_file": str(self.key_file),
            }
        )

    def initialize_empty_store(self, run_dir: Path) -> None:
        run_dir.mkdir(mode=0o700)
        server = create_server(
            self.config_for(run_dir),
            clock=lambda: FIXED_NOW,
            log_stream=io.StringIO(),
        )
        server.server_close()

    def test_run_directory_swap_does_not_reset_replay_state(self) -> None:
        alternate_run = self.root / "alternate-run"
        self.initialize_empty_store(alternate_run)
        nonce = "run-dir-swap-00000001"

        with running_server(self.config_for(self.run_dir)) as server:
            self.assertEqual(200, request_capabilities(server, nonce))
            detached_run = self.root / "detached-run"
            self.run_dir.rename(detached_run)
            self.run_dir.symlink_to(alternate_run, target_is_directory=True)

            replay_status = request_capabilities(server, nonce)

        self.assertEqual(401, replay_status)

    def test_final_database_swap_does_not_reset_replay_state(self) -> None:
        alternate_run = self.root / "alternate-run"
        self.initialize_empty_store(alternate_run)
        nonce = "database-swap-00000001"

        with running_server(self.config_for(self.run_dir)) as server:
            self.assertEqual(200, request_capabilities(server, nonce))
            database = self.run_dir / "hmac-nonces.sqlite3"
            detached_database = self.run_dir / "original-nonces.sqlite3"
            database.rename(detached_database)
            database.symlink_to(alternate_run / "hmac-nonces.sqlite3")

            replay_status = request_capabilities(server, nonce)

        self.assertEqual(401, replay_status)


if __name__ == "__main__":
    unittest.main()
