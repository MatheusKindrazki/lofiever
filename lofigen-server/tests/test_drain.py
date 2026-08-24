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
from lofigen_server.runtime import DrainController, DrainingError
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_NOW = 1_700_000_000
FIXED_KEY = b"0123456789abcdef0123456789abcdef"


def signed_headers(method: str, path: str, body: bytes, nonce: str) -> dict[str, str]:
    body_digest = hashlib.sha256(body).hexdigest()
    message = "\n".join(
        [method.upper(), path, str(FIXED_NOW), nonce, body_digest]
    ).encode("utf-8")
    signature = hmac.new(FIXED_KEY, message, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-Lofiever-Timestamp": str(FIXED_NOW),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": signature,
    }


@contextmanager
def running_server(
    config: ServerConfig,
    controller: DrainController,
) -> Iterator[LofigenHttpServer]:
    server = create_server(
        config,
        clock=lambda: FIXED_NOW,
        log_stream=io.StringIO(),
        drain_controller=controller,
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
    method: str,
    path: str,
    *,
    body: bytes = b"",
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, object]]:
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


class LofigenDrainContractTests(unittest.TestCase):
    def test_drain_preserves_in_flight_work_and_refuses_new_work(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
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
            controller = DrainController()
            drain_body = b'{"reason":"operator_request"}'

            with controller.begin_job("job-in-flight"):
                with running_server(config, controller) as server:
                    status, payload = request_json(
                        server,
                        "POST",
                        "/v1/admin/drain",
                        body=drain_body,
                        headers=signed_headers(
                            "POST",
                            "/v1/admin/drain",
                            drain_body,
                            "drain-nonce-00000001",
                        ),
                    )

                    self.assertEqual(202, status)
                    self.assertEqual(
                        {
                            "acceptingJobs": False,
                            "draining": True,
                            "jobsInFlight": 1,
                            "protocolVersion": "1",
                            "status": "draining",
                        },
                        payload,
                    )
                    with self.assertRaises(DrainingError):
                        with controller.begin_job("job-after-drain"):
                            self.fail("draining worker accepted new work")

                    health_status, health = request_json(server, "GET", "/v1/health")
                    self.assertEqual(200, health_status)
                    self.assertEqual(1, health["jobsInFlight"])
                    self.assertTrue(health["draining"])

            snapshot = controller.snapshot()
            self.assertTrue(snapshot.draining)
            self.assertEqual(0, snapshot.jobs_in_flight)


if __name__ == "__main__":
    unittest.main()
