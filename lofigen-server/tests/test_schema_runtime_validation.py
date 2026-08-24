from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
from http.client import HTTPConnection
from importlib import resources
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
from typing import Iterator
import unittest

from jsonschema import Draft202012Validator

from lofigen_server.config import ServerConfig, load_config
from lofigen_server.server import LofigenHttpServer, create_server


FIXED_KEY = b"0123456789abcdef0123456789abcdef"
FIXED_NOW = 1_700_000_000
WORKER_ID = "m5-local"
SCHEMA_NAMES = (
    "health.response.schema.json",
    "capabilities.response.schema.json",
    "drain.request.schema.json",
    "drain.response.schema.json",
)


def unused_loopback_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])
    finally:
        probe.close()


def signature_headers(method: str, path: str, nonce: str, body: bytes) -> dict[str, str]:
    message = "\n".join(
        [
            "LOFIEVER-HMAC-SHA256-V1",
            WORKER_ID,
            method,
            path,
            str(FIXED_NOW),
            nonce,
            hashlib.sha256(body).hexdigest(),
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


def request_json(
    server: LofigenHttpServer,
    method: str,
    path: str,
    *,
    body: bytes = b"",
    nonce: str | None = None,
) -> tuple[int, dict[str, object]]:
    headers: dict[str, str] = {}
    if nonce is not None:
        headers.update(signature_headers(method, path, nonce, body))
    if method == "POST":
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(body))
    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


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


class RuntimeSchemaValidationTests(unittest.TestCase):
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
        self.config = load_config(
            {
                "bind": "127.0.0.1",
                "port": unused_loopback_port(),
                "worker_id": WORKER_ID,
                "staging_dir": str(staging_dir),
                "run_dir": str(run_dir),
                "hmac_key_file": str(key_file),
                "model_id": "ACE-Step-v1.5",
                "model_revision": "14c0211d",
            }
        )

    def load_schemas(self) -> dict[str, dict[str, object]]:
        contracts = resources.files("lofigen_server").joinpath("contracts")
        return {
            name: json.loads(contracts.joinpath(name).read_text(encoding="utf-8"))
            for name in SCHEMA_NAMES
        }

    def test_all_schemas_are_draft_2020_12_valid_and_match_real_traffic(self) -> None:
        schemas = self.load_schemas()
        for name, schema in schemas.items():
            with self.subTest(schema=name):
                Draft202012Validator.check_schema(schema)

        drain_body = b'{"reason":"maintenance"}'
        with running_server(self.config) as server:
            health_status, health = request_json(server, "GET", "/v1/health")
            capabilities_status, capabilities = request_json(
                server,
                "GET",
                "/v1/capabilities",
                nonce="schema-capability-00001",
            )
            drain_status, drain = request_json(
                server,
                "POST",
                "/v1/admin/drain",
                body=drain_body,
                nonce="schema-drain-000000001",
            )

        self.assertEqual((200, 200, 202), (health_status, capabilities_status, drain_status))
        Draft202012Validator(schemas["health.response.schema.json"]).validate(health)
        Draft202012Validator(schemas["capabilities.response.schema.json"]).validate(
            capabilities
        )
        Draft202012Validator(schemas["drain.request.schema.json"]).validate(
            json.loads(drain_body)
        )
        Draft202012Validator(schemas["drain.response.schema.json"]).validate(drain)

    def test_capabilities_schema_rejects_values_the_runtime_rejects(self) -> None:
        schema = self.load_schemas()["capabilities.response.schema.json"]
        validator = Draft202012Validator(schema)
        valid = {
            "batchCeiling": 1,
            "device": "mps",
            "durationSeconds": {"maximum": 184, "minimum": 150},
            "engine": {
                "name": "ace-step-1.5",
                "repoCommit": "14c0211d5a0653b0f63e27686f4c3f151b4d8629",
                "upstreamApiVersion": "1",
            },
            "generationAvailable": False,
            "lmBackend": "mlx",
            "modelId": "ACE-Step-v1.5",
            "modelLoaded": False,
            "modelRevision": "14c0211d",
            "protocolVersion": "1",
            "referenceAudio": False,
            "vaeChunk": None,
            "workerId": WORKER_ID,
        }
        validator.validate(valid)
        invalid_overrides = {
            "workerId": "bad worker",
            "device": "bad device",
            "lmBackend": "/absolute",
            "modelId": "/absolute",
            "modelRevision": "bad revision",
        }
        for field, invalid_value in invalid_overrides.items():
            with self.subTest(field=field):
                candidate = {**valid, field: invalid_value}
                self.assertFalse(validator.is_valid(candidate))


if __name__ == "__main__":
    unittest.main()
