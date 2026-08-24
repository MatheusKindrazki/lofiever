from __future__ import annotations

from contextlib import contextmanager
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import threading
import tempfile
from typing import Iterator
import unittest

from lofigen_server import ServerConfig
from lofigen_server.server import LofigenHttpServer, create_server


ACE_STEP_COMMIT = "14c0211d5a0653b0f63e27686f4c3f151b4d8629"
FIXED_NOW = 1_700_000_000
FIXED_KEY = b"0123456789abcdef0123456789abcdef"


@contextmanager
def running_server(
    config: ServerConfig,
    *,
    log_stream: io.StringIO,
) -> Iterator[LofigenHttpServer]:
    server = create_server(config, clock=lambda: FIXED_NOW, log_stream=log_stream)
    thread = threading.Thread(target=server.serve_forever, daemon=False)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(
    server: LofigenHttpServer,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes = b"",
) -> tuple[int, dict[str, str], dict[str, object]]:
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    response_body = response.read()
    response_headers = {key.lower(): value for key, value in response.getheaders()}
    connection.close()
    return response.status, response_headers, json.loads(response_body)


class LofigenServerHttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir()
        self.key_file = self.root / "hmac.key"
        self.key_file.write_bytes(FIXED_KEY)
        self.key_file.chmod(0o600)
        self.logs = io.StringIO()
        self.config = ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=self.staging_dir,
            hmac_key_file=self.key_file,
            hmac_key=FIXED_KEY,
            hmac_window_seconds=300,
            device="mps",
            lm_backend="mlx",
            model_id=None,
            model_revision=None,
            vae_chunk=None,
            batch_ceiling=1,
        )

    def test_health_is_public_minimal_and_reports_no_loaded_model(self) -> None:
        with running_server(self.config, log_stream=self.logs) as server:
            status, headers, payload = request(server, "GET", "/v1/health")

        self.assertEqual(200, status)
        self.assertEqual("no-store", headers["cache-control"])
        self.assertEqual("nosniff", headers["x-content-type-options"])
        self.assertEqual(
            {
                "batchCeiling",
                "device",
                "draining",
                "freeDisk",
                "freeStagingBytes",
                "jobsInFlight",
                "lmBackend",
                "modelId",
                "modelRevision",
                "protocolVersion",
                "status",
                "uptimeSeconds",
                "vaeChunk",
            },
            set(payload),
        )
        self.assertEqual("ok", payload["status"])
        self.assertEqual("1", payload["protocolVersion"])
        self.assertEqual("mps", payload["device"])
        self.assertEqual("mlx", payload["lmBackend"])
        self.assertIsNone(payload["modelId"])
        self.assertIsNone(payload["modelRevision"])
        self.assertIsNone(payload["vaeChunk"])
        self.assertEqual(1, payload["batchCeiling"])
        self.assertEqual(payload["freeDisk"], payload["freeStagingBytes"])
        self.assertGreater(payload["freeStagingBytes"], 0)
        self.assertEqual(0, payload["jobsInFlight"])
        self.assertFalse(payload["draining"])
        self.assertEqual(0, payload["uptimeSeconds"])
        serialized = json.dumps(payload)
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn(FIXED_KEY.decode(), serialized)

    def test_capabilities_rejects_an_unsigned_request(self) -> None:
        with running_server(self.config, log_stream=self.logs) as server:
            status, headers, payload = request(server, "GET", "/v1/capabilities")

        self.assertEqual(401, status)
        self.assertEqual("HMAC-SHA256", headers["www-authenticate"])
        self.assertEqual(
            {"error": {"code": "authentication_failed"}, "status": "error"},
            payload,
        )

    def test_capabilities_accepts_the_rfc_hmac_vector(self) -> None:
        headers = {
            "X-Lofiever-Timestamp": str(FIXED_NOW),
            "X-Lofiever-Nonce": "nonce-0123456789abcdef",
            "X-Lofiever-Signature": "c1c0a5e0ac691215320aa5b036f72dc5d91725ceae9e031492c57548fb96a16c",
        }

        with running_server(self.config, log_stream=self.logs) as server:
            status, _, payload = request(
                server,
                "GET",
                "/v1/capabilities",
                headers=headers,
            )

        self.assertEqual(200, status)
        self.assertEqual(
            {
                "batchCeiling": 1,
                "device": "mps",
                "durationSeconds": {"maximum": 184, "minimum": 150},
                "engine": {
                    "name": "ace-step-1.5",
                    "repoCommit": ACE_STEP_COMMIT,
                    "upstreamApiVersion": "1",
                },
                "generationAvailable": False,
                "lmBackend": "mlx",
                "modelId": None,
                "modelLoaded": False,
                "modelRevision": None,
                "protocolVersion": "1",
                "referenceAudio": False,
                "vaeChunk": None,
                "workerId": "m5-local",
            },
            payload,
        )


if __name__ == "__main__":
    unittest.main()
