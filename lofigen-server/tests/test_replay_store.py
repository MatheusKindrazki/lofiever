from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
from http.client import HTTPConnection
import io
from pathlib import Path
import tempfile
import threading
from typing import Iterator
import unittest

from lofigen_server import ServerConfig
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_KEY = b"0123456789abcdef0123456789abcdef"


def signed_headers(*, timestamp: int, nonce: str) -> dict[str, str]:
    body_digest = hashlib.sha256(b"").hexdigest()
    message = "\n".join(
        ["GET", "/v1/capabilities", str(timestamp), nonce, body_digest]
    ).encode("utf-8")
    return {
        "X-Lofiever-Timestamp": str(timestamp),
        "X-Lofiever-Nonce": nonce,
        "X-Lofiever-Signature": hmac.new(
            FIXED_KEY,
            message,
            hashlib.sha256,
        ).hexdigest(),
    }


@contextmanager
def running_server(
    config: ServerConfig,
    *,
    clock: object,
) -> Iterator[LofigenHttpServer]:
    server = create_server(
        config,
        clock=clock,  # type: ignore[arg-type]
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


def request_capabilities(
    server: LofigenHttpServer,
    headers: dict[str, str],
) -> int:
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request("GET", "/v1/capabilities", headers=headers)
    response = connection.getresponse()
    response.read()
    connection.close()
    return response.status


class MutableClock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class DurableReplayProtectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        staging_dir = root / "staging"
        staging_dir.mkdir(mode=0o700)
        run_dir = root / "run"
        run_dir.mkdir(mode=0o700)
        key_file = root / "hmac.key"
        key_file.write_bytes(FIXED_KEY)
        key_file.chmod(0o600)
        self.config = ServerConfig(
            bind="127.0.0.1",
            port=0,
            protocol_version="1",
            worker_id="m5-local",
            staging_dir=staging_dir,
            run_dir=run_dir,
            hmac_key_file=key_file,
            hmac_key=FIXED_KEY,
            hmac_window_seconds=300,
        )

    def test_replay_remains_rejected_after_server_restart(self) -> None:
        clock = MutableClock(1_700_000_000)
        headers = signed_headers(
            timestamp=1_700_000_000,
            nonce="restart-replay-000001",
        )

        with running_server(self.config, clock=clock) as first_server:
            first_status = request_capabilities(first_server, headers)
        with running_server(self.config, clock=clock) as restarted_server:
            replay_status = request_capabilities(restarted_server, headers)

        self.assertEqual(200, first_status)
        self.assertEqual(401, replay_status)

    def test_future_signed_nonce_is_retained_through_its_valid_boundary(self) -> None:
        clock = MutableClock(1_700_000_000)
        signed_timestamp = 1_700_000_300
        headers = signed_headers(
            timestamp=signed_timestamp,
            nonce="future-boundary-000001",
        )

        with running_server(self.config, clock=clock) as server:
            first_status = request_capabilities(server, headers)
            clock.now = signed_timestamp + 300
            boundary_replay_status = request_capabilities(server, headers)

        self.assertEqual(200, first_status)
        self.assertEqual(401, boundary_replay_status)

    def test_two_servers_atomically_reject_the_same_nonce(self) -> None:
        clock = MutableClock(1_700_000_000)
        headers = signed_headers(
            timestamp=1_700_000_000,
            nonce="shared-concurrent-00001",
        )

        with running_server(self.config, clock=clock) as first_server:
            with running_server(self.config, clock=clock) as second_server:
                barrier = threading.Barrier(3)
                statuses: list[int] = []

                def make_request(server: LofigenHttpServer) -> None:
                    barrier.wait()
                    statuses.append(request_capabilities(server, headers))

                threads = [
                    threading.Thread(target=make_request, args=(first_server,)),
                    threading.Thread(target=make_request, args=(second_server,)),
                ]
                for thread in threads:
                    thread.start()
                barrier.wait()
                for thread in threads:
                    thread.join(timeout=2)

        self.assertEqual([200, 401], sorted(statuses))


if __name__ == "__main__":
    unittest.main()
