from __future__ import annotations

import hashlib
import hmac
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest

from lofigen_server import ServerConfig
from lofigen_server.server import create_server


FIXED_NOW = 1_700_000_000
FIXED_KEY = b"0123456789abcdef0123456789abcdef"


def signed_headers(
    method: str,
    path: str,
    body: bytes,
    *,
    nonce: str,
    timestamp: int = FIXED_NOW,
) -> dict[str, str]:
    body_digest = hashlib.sha256(body).hexdigest()
    message = "\n".join(
        [method.upper(), path, str(timestamp), nonce, body_digest]
    ).encode("utf-8")
    signature = hmac.new(FIXED_KEY, message, hashlib.sha256).hexdigest()
    return {
        "X-Lofiever-Timestamp": str(timestamp),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": signature,
    }


class LofigenServerSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        staging_dir = root / "staging"
        staging_dir.mkdir()
        key_file = root / "hmac.key"
        key_file.write_bytes(FIXED_KEY)
        key_file.chmod(0o600)
        config = ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=staging_dir,
            hmac_key_file=key_file,
            hmac_key=FIXED_KEY,
        )
        self.logs = io.StringIO()
        self.server = create_server(
            config,
            clock=lambda: FIXED_NOW,
            log_stream=self.logs,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=False)
        self.thread.start()
        self.addCleanup(self._stop_server)

    def _stop_server(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(
        self,
        method: str,
        path: str,
        *,
        body: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, object]]:
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        return response.status, payload

    def test_hmac_headers_are_case_insensitive_as_required_by_http(self) -> None:
        headers = {
            name.lower(): value
            for name, value in signed_headers(
                "GET",
                "/v1/capabilities",
                b"",
                nonce="header-case-00000001",
            ).items()
        }

        status, payload = self.request(
            "GET",
            "/v1/capabilities",
            headers=headers,
        )

        self.assertEqual(200, status)
        self.assertEqual("1", payload["protocolVersion"])


if __name__ == "__main__":
    unittest.main()
