from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import tempfile
import threading
from typing import Iterator
import unittest

from lofigen_server import ServerConfig
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_NOW = 1_700_000_000
SHARED_BY_MISTAKE_KEY = b"0123456789abcdef0123456789abcdef"
SIGNATURE_VERSION = "1"
CANONICAL_LABEL = "LOFIEVER-HMAC-SHA256-V1"


def versioned_headers(*, worker_id: str, nonce: str) -> dict[str, str]:
    body_digest = hashlib.sha256(b"").hexdigest()
    message = "\n".join(
        [
            CANONICAL_LABEL,
            worker_id,
            "GET",
            "/v1/capabilities",
            str(FIXED_NOW),
            nonce,
            body_digest,
        ]
    ).encode("utf-8")
    return {
        "X-Lofiever-Signature-Version": SIGNATURE_VERSION,
        "X-Lofiever-Worker-Id": worker_id,
        "X-Lofiever-Timestamp": str(FIXED_NOW),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": hmac.new(
            SHARED_BY_MISTAKE_KEY,
            message,
            hashlib.sha256,
        ).hexdigest(),
    }


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


def request_json(
    server: LofigenHttpServer,
    path: str,
    *,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, object]]:
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request("GET", path, headers=headers or {})
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


class WorkerAudienceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

    def config(self, worker_id: str) -> ServerConfig:
        worker_root = self.root / worker_id
        staging_dir = worker_root / "staging"
        run_dir = worker_root / "run"
        staging_dir.mkdir(parents=True, mode=0o700)
        run_dir.mkdir(mode=0o700)
        key_file = worker_root / "hmac.key"
        key_file.write_bytes(SHARED_BY_MISTAKE_KEY)
        key_file.chmod(0o600)
        return ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id=worker_id,
            staging_dir=staging_dir,
            run_dir=run_dir,
            hmac_key_file=key_file,
            hmac_key=SHARED_BY_MISTAKE_KEY,
        )

    def test_request_signed_for_m5_is_rejected_by_m4_even_with_the_same_key(self) -> None:
        headers = versioned_headers(
            worker_id="m5-local",
            nonce="audience-bound-0000001",
        )

        with running_server(self.config("m5-local")) as m5_server:
            with running_server(self.config("m4-local")) as m4_server:
                m5_status, m5_capabilities = request_json(
                    m5_server,
                    "/v1/capabilities",
                    headers=headers,
                )
                m4_status, m4_payload = request_json(
                    m4_server,
                    "/v1/capabilities",
                    headers=headers,
                )

        self.assertEqual(200, m5_status)
        self.assertEqual("m5-local", m5_capabilities["workerId"])
        self.assertEqual(401, m4_status)
        self.assertEqual("authentication_failed", m4_payload["error"]["code"])

    def test_health_reports_the_stable_worker_identity(self) -> None:
        with running_server(self.config("m5-local")) as server:
            status, health = request_json(server, "/v1/health")

        self.assertEqual(200, status)
        self.assertEqual("m5-local", health["workerId"])


if __name__ == "__main__":
    unittest.main()
