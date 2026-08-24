from __future__ import annotations

from contextlib import contextmanager, redirect_stderr
import hashlib
import hmac
from http.client import HTTPConnection
import io
import json
from pathlib import Path
import select
import socket
import tempfile
import threading
import time
from typing import Iterator
import unittest

from lofigen_server import ServerConfig
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_NOW = 1_700_000_000
FIXED_KEY = b"0123456789abcdef0123456789abcdef"
WORKER_ID = "m5-local"


def signed_headers(method: str, path: str, body: bytes, nonce: str) -> dict[str, str]:
    body_digest = hashlib.sha256(body).hexdigest()
    canonical = "\n".join(
        [
            "LOFIEVER-HMAC-SHA256-V1",
            WORKER_ID,
            method,
            path,
            str(FIXED_NOW),
            nonce,
            body_digest,
        ]
    ).encode("utf-8")
    return {
        "X-Lofiever-Signature-Version": "1",
        "X-Lofiever-Worker-Id": WORKER_ID,
        "X-Lofiever-Timestamp": str(FIXED_NOW),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": hmac.new(
            FIXED_KEY,
            canonical,
            hashlib.sha256,
        ).hexdigest(),
    }


def raw_post_headers(
    server: LofigenHttpServer,
    body: bytes,
    *,
    nonce: str,
    duplicate_header: str | None = None,
) -> bytes:
    headers = {
        "Host": f"127.0.0.1:{server.server_port}",
        "Content-Length": str(len(body)),
        "Content-Type": "application/json",
        **signed_headers("POST", "/v1/admin/drain", body, nonce),
        "Connection": "close",
    }
    lines = ["POST /v1/admin/drain HTTP/1.1"]
    for name, value in headers.items():
        lines.append(f"{name}: {value}")
        if name == duplicate_header:
            lines.append(f"{name}: {value}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")


def receive_json(sock: socket.socket) -> tuple[int, dict[str, object]]:
    chunks: list[bytes] = []
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
    response = b"".join(chunks)
    head, body = response.split(b"\r\n\r\n", maxsplit=1)
    status = int(head.splitlines()[0].split()[1])
    return status, json.loads(body)


@contextmanager
def running_server(
    config: ServerConfig,
    *,
    logs: io.StringIO,
    request_timeout_seconds: float = 0.2,
    maximum_handlers: int = 4,
) -> Iterator[LofigenHttpServer]:
    server = create_server(
        config,
        clock=lambda: FIXED_NOW,
        log_stream=logs,
        request_timeout_seconds=request_timeout_seconds,
        maximum_handlers=maximum_handlers,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=False)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class HttpResourceSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.staging_dir = self.root / "staging"
        self.staging_dir.mkdir(mode=0o700)
        run_dir = self.root / "run"
        run_dir.mkdir(mode=0o700)
        key_file = self.root / "hmac.key"
        key_file.write_bytes(FIXED_KEY)
        key_file.chmod(0o600)
        self.config = ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=self.staging_dir,
            run_dir=run_dir,
            hmac_key_file=key_file,
            hmac_key=FIXED_KEY,
        )
        self.logs = io.StringIO()

    def test_partial_body_times_out_fail_closed_and_server_remains_healthy(self) -> None:
        body = b'{"reason":"maintenance"}'
        with running_server(self.config, logs=self.logs) as server:
            sock = socket.create_connection(("127.0.0.1", server.server_port), timeout=1)
            sock.settimeout(1)
            sock.sendall(
                raw_post_headers(
                    server,
                    body,
                    nonce="partial-timeout-000001",
                )
                + body[:4]
            )

            status, payload = receive_json(sock)
            sock.close()
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=1)
            connection.request("GET", "/v1/health")
            health = connection.getresponse()
            health.read()
            connection.close()

        self.assertEqual(408, status)
        self.assertEqual(
            {"error": {"code": "request_timeout"}, "status": "error"},
            payload,
        )
        self.assertEqual(200, health.status)

    def test_body_deadline_is_absolute_even_when_the_client_drips_bytes(self) -> None:
        body = b'{"reason":"maintenance"}'
        with running_server(
            self.config,
            logs=self.logs,
            request_timeout_seconds=0.2,
        ) as server:
            sock = socket.create_connection(("127.0.0.1", server.server_port), timeout=1)
            sock.settimeout(2)
            sock.sendall(
                raw_post_headers(
                    server,
                    body,
                    nonce="drip-deadline-0000001",
                )
            )
            started_at = time.monotonic()
            for byte in body:
                try:
                    sock.sendall(bytes([byte]))
                except OSError:
                    break
                time.sleep(0.05)
                readable, _, _ = select.select([sock], [], [], 0)
                if readable:
                    break

            status, payload = receive_json(sock)
            elapsed = time.monotonic() - started_at
            sock.close()

        self.assertEqual(408, status)
        self.assertEqual("request_timeout", payload["error"]["code"])
        self.assertLess(elapsed, 1)

    def test_incomplete_body_at_eof_is_rejected(self) -> None:
        body = b'{"reason":"maintenance"}'
        with running_server(self.config, logs=self.logs) as server:
            sock = socket.create_connection(("127.0.0.1", server.server_port), timeout=1)
            sock.settimeout(1)
            sock.sendall(
                raw_post_headers(
                    server,
                    body,
                    nonce="partial-eof-000000001",
                )
                + body[:4]
            )
            sock.shutdown(socket.SHUT_WR)
            status, payload = receive_json(sock)
            sock.close()

        self.assertEqual(400, status)
        self.assertEqual(
            {"error": {"code": "incomplete_body"}, "status": "error"},
            payload,
        )

    def test_critical_post_headers_are_unique_before_body_read(self) -> None:
        body = b'{"reason":"maintenance"}'
        expected = {
            "Content-Length": (400, "invalid_request_headers"),
            "Content-Type": (400, "invalid_request_headers"),
            "X-Lofiever-Signature": (401, "authentication_failed"),
        }

        with running_server(self.config, logs=self.logs) as server:
            for index, (duplicate_name, (expected_status, error_code)) in enumerate(
                expected.items()
            ):
                with self.subTest(duplicate_name=duplicate_name):
                    sock = socket.create_connection(
                        ("127.0.0.1", server.server_port),
                        timeout=1,
                    )
                    sock.settimeout(1)
                    sock.sendall(
                        raw_post_headers(
                            server,
                            body,
                            nonce=f"duplicate-post-{index:08d}",
                            duplicate_header=duplicate_name,
                        )
                    )
                    status, payload = receive_json(sock)
                    sock.close()

                    self.assertEqual(expected_status, status)
                    self.assertEqual(error_code, payload["error"]["code"])

    def test_handler_limit_rejects_excess_connections_without_starving_shutdown(self) -> None:
        body = b'{"reason":"maintenance"}'
        started_at = time.monotonic()
        with running_server(
            self.config,
            logs=self.logs,
            request_timeout_seconds=0.3,
            maximum_handlers=1,
        ) as server:
            blocker = socket.create_connection(
                ("127.0.0.1", server.server_port),
                timeout=1,
            )
            blocker.settimeout(1)
            blocker.sendall(
                raw_post_headers(
                    server,
                    body,
                    nonce="handler-blocker-000001",
                )
                + body[:1]
            )

            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=1)
            connection.request("GET", "/v1/health")
            overloaded = connection.getresponse()
            overloaded_payload = json.loads(overloaded.read())
            connection.close()
            blocker.close()

        self.assertEqual(503, overloaded.status)
        self.assertEqual("server_busy", overloaded_payload["error"]["code"])
        self.assertLess(time.monotonic() - started_at, 2)

    def test_health_failure_returns_generic_error_without_traceback_or_path(self) -> None:
        captured_stderr = io.StringIO()
        with running_server(self.config, logs=self.logs) as server:
            self.staging_dir.rmdir()
            with redirect_stderr(captured_stderr):
                connection = HTTPConnection(
                    "127.0.0.1",
                    server.server_port,
                    timeout=1,
                )
                connection.request("GET", "/v1/health")
                response = connection.getresponse()
                payload = json.loads(response.read())
                connection.close()

        rendered = self.logs.getvalue() + captured_stderr.getvalue() + json.dumps(payload)
        self.assertEqual(500, response.status)
        self.assertEqual("internal_error", payload["error"]["code"])
        self.assertNotIn("Traceback", rendered)
        self.assertNotIn(str(self.root), rendered)
        self.assertNotIn(str(Path.home()), rendered)


if __name__ == "__main__":
    unittest.main()
