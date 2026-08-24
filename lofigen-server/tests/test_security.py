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
        run_dir = root / "run"
        run_dir.mkdir(mode=0o700)
        key_file = root / "hmac.key"
        key_file.write_bytes(FIXED_KEY)
        key_file.chmod(0o600)
        config = ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=staging_dir,
            run_dir=run_dir,
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

    def request_with_duplicate_header(
        self,
        duplicate_name: str,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, object]]:
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.putrequest("GET", "/v1/capabilities")
        for name, value in headers.items():
            connection.putheader(name, value)
            if name == duplicate_name:
                connection.putheader(name, value)
        connection.endheaders()
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

    def test_oversized_drain_payload_is_rejected_without_logging_the_body(self) -> None:
        marker = "sensitive-prompt-marker"
        body = json.dumps({"reason": marker * 100}).encode("utf-8")
        headers = signed_headers(
            "POST",
            "/v1/admin/drain",
            body,
            nonce="oversized-body-0000001",
        )
        headers["Content-Type"] = "application/json"

        status, payload = self.request(
            "POST",
            "/v1/admin/drain",
            body=body,
            headers=headers,
        )

        self.assertEqual(413, status)
        self.assertEqual(
            {"error": {"code": "payload_too_large"}, "status": "error"},
            payload,
        )
        self.assertNotIn(marker, self.logs.getvalue())

    def test_timestamp_must_be_inside_the_bounded_window(self) -> None:
        for offset, nonce in [(-301, "stale-request-0000001"), (301, "future-request-000001")]:
            headers = signed_headers(
                "GET",
                "/v1/capabilities",
                b"",
                nonce=nonce,
                timestamp=FIXED_NOW + offset,
            )

            status, payload = self.request(
                "GET",
                "/v1/capabilities",
                headers=headers,
            )

            self.assertEqual(401, status)
            self.assertEqual(
                {"error": {"code": "authentication_failed"}, "status": "error"},
                payload,
            )

    def test_unbounded_decimal_timestamp_is_rejected_as_structured_unauthorized(self) -> None:
        status, payload = self.request(
            "GET",
            "/v1/capabilities",
            headers={
                "X-Lofiever-Timestamp": "9" * 5_000,
                "X-Lofiever-Nonce": "giant-timestamp-000001",
                "X-Lofiever-Signature": "0" * 64,
            },
        )

        self.assertEqual(401, status)
        self.assertEqual(
            {"error": {"code": "authentication_failed"}, "status": "error"},
            payload,
        )

    def test_each_hmac_header_must_appear_exactly_once(self) -> None:
        header_names = [
            "X-Lofiever-Timestamp",
            "X-Lofiever-Nonce",
            "X-Lofiever-Signature",
        ]

        for index, duplicate_name in enumerate(header_names):
            with self.subTest(duplicate_name=duplicate_name):
                headers = signed_headers(
                    "GET",
                    "/v1/capabilities",
                    b"",
                    nonce=f"duplicate-header-{index:08d}",
                )
                status, payload = self.request_with_duplicate_header(
                    duplicate_name,
                    headers,
                )

                self.assertEqual(401, status)
                self.assertEqual(
                    {
                        "error": {"code": "authentication_failed"},
                        "status": "error",
                    },
                    payload,
                )

    def test_signature_hex_is_canonical_lowercase(self) -> None:
        headers = signed_headers(
            "GET",
            "/v1/capabilities",
            b"",
            nonce="uppercase-signature-0001",
        )
        headers["X-Lofiever-Signature"] = headers[
            "X-Lofiever-Signature"
        ].upper()

        status, payload = self.request(
            "GET",
            "/v1/capabilities",
            headers=headers,
        )

        self.assertEqual(401, status)
        self.assertEqual(
            {"error": {"code": "authentication_failed"}, "status": "error"},
            payload,
        )

    def test_nonce_replay_is_rejected(self) -> None:
        headers = signed_headers(
            "GET",
            "/v1/capabilities",
            b"",
            nonce="replay-nonce-00000001",
        )

        first_status, _ = self.request(
            "GET",
            "/v1/capabilities",
            headers=headers,
        )
        replay_status, replay_payload = self.request(
            "GET",
            "/v1/capabilities",
            headers=headers,
        )

        self.assertEqual(200, first_status)
        self.assertEqual(401, replay_status)
        self.assertEqual(
            {"error": {"code": "authentication_failed"}, "status": "error"},
            replay_payload,
        )

    def test_body_tampering_fails_before_drain(self) -> None:
        signed_body = b'{"reason":"operator_request"}'
        tampered_body = b'{"reason":"maintenance"}'
        headers = signed_headers(
            "POST",
            "/v1/admin/drain",
            signed_body,
            nonce="tampered-body-0000001",
        )
        headers["Content-Type"] = "application/json"

        status, payload = self.request(
            "POST",
            "/v1/admin/drain",
            body=tampered_body,
            headers=headers,
        )
        _, health = self.request("GET", "/v1/health")

        self.assertEqual(401, status)
        self.assertEqual(
            {"error": {"code": "authentication_failed"}, "status": "error"},
            payload,
        )
        self.assertFalse(health["draining"])

    def test_invalid_signature_does_not_consume_the_nonce(self) -> None:
        valid_headers = signed_headers(
            "GET",
            "/v1/capabilities",
            b"",
            nonce="retry-nonce-000000001",
        )
        invalid_headers = dict(valid_headers)
        invalid_headers["X-Lofiever-Signature"] = "0" * 64

        rejected_status, _ = self.request(
            "GET",
            "/v1/capabilities",
            headers=invalid_headers,
        )
        accepted_status, _ = self.request(
            "GET",
            "/v1/capabilities",
            headers=valid_headers,
        )

        self.assertEqual(401, rejected_status)
        self.assertEqual(200, accepted_status)

    def test_drain_schema_rejects_sensitive_unknown_fields_without_echoing_them(self) -> None:
        sensitive_values = [
            "secret-value-0001",
            "listener@example.com",
            str(Path.home() / "private-audio.wav"),
            "clear prompt should never be logged",
        ]
        body = json.dumps(
            {
                "reason": "operator_request",
                "secret": sensitive_values[0],
                "email": sensitive_values[1],
                "path": sensitive_values[2],
                "prompt": sensitive_values[3],
            }
        ).encode("utf-8")
        headers = signed_headers(
            "POST",
            "/v1/admin/drain",
            body,
            nonce="schema-reject-0000001",
        )
        headers["Content-Type"] = "application/json"

        status, payload = self.request(
            "POST",
            "/v1/admin/drain",
            body=body,
            headers=headers,
        )

        self.assertEqual(400, status)
        self.assertEqual(
            {"error": {"code": "invalid_payload"}, "status": "error"},
            payload,
        )
        rendered_response = json.dumps(payload)
        rendered_logs = self.logs.getvalue()
        for sensitive_value in sensitive_values:
            self.assertNotIn(sensitive_value, rendered_response)
            self.assertNotIn(sensitive_value, rendered_logs)

    def test_drain_requires_json_content_type_after_authentication(self) -> None:
        body = b'{"reason":"maintenance"}'
        headers = signed_headers(
            "POST",
            "/v1/admin/drain",
            body,
            nonce="content-type-00000001",
        )
        headers["Content-Type"] = "text/plain"

        status, payload = self.request(
            "POST",
            "/v1/admin/drain",
            body=body,
            headers=headers,
        )

        self.assertEqual(415, status)
        self.assertEqual(
            {"error": {"code": "json_required"}, "status": "error"},
            payload,
        )


if __name__ == "__main__":
    unittest.main()
