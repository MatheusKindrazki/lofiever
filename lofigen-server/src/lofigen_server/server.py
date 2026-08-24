from __future__ import annotations

from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import shutil
import sys
import time
from typing import TextIO
from urllib.parse import urlsplit

from .auth import SignatureVerifier, SqliteNonceStore
from .config import ServerConfig
from .runtime import DrainController
from .safe_logging import SafeJsonLogger
from .schemas import PayloadError, validate_drain_request
from .staging import StagingRoot


ACE_STEP_REPO_COMMIT = "14c0211d5a0653b0f63e27686f4c3f151b4d8629"
MAXIMUM_REQUEST_BODY_BYTES = 1024


class LofigenHttpServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(
        self,
        config: ServerConfig,
        *,
        clock: Callable[[], float],
        logger: SafeJsonLogger,
        drain_controller: DrainController,
    ) -> None:
        self.config = config
        self.clock = clock
        self.started_at = clock()
        self.logger = logger
        self.drain_controller = drain_controller
        self.staging = StagingRoot(config.staging_dir)
        self.signature_verifier = SignatureVerifier(
            config.hmac_key,
            window_seconds=config.hmac_window_seconds,
            clock=clock,
            nonce_store=SqliteNonceStore(config.run_dir),
        )
        super().__init__((config.bind, config.port), LofigenRequestHandler)


class LofigenRequestHandler(BaseHTTPRequestHandler):
    server: LofigenHttpServer
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_arguments: object) -> None:
        return

    def _route(self) -> str | None:
        parsed = urlsplit(self.path)
        if parsed.query or parsed.fragment:
            return None
        return parsed.path

    def _write_json(
        self,
        status: HTTPStatus,
        payload: dict[str, object],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)
        self.close_connection = True

    def _request_headers(self) -> dict[str, str]:
        return {key: value for key, value in self.headers.items()}

    def _authenticate(self, method: str, route: str, body: bytes = b"") -> bool:
        decision = self.server.signature_verifier.verify(
            method,
            route,
            body,
            self._request_headers(),
        )
        if decision.accepted:
            return True
        self._write_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": {"code": "authentication_failed"}, "status": "error"},
            extra_headers={"WWW-Authenticate": "HMAC-SHA256"},
        )
        return False

    def _health_payload(self) -> dict[str, object]:
        runtime = self.server.drain_controller.snapshot()
        free_bytes = shutil.disk_usage(self.server.staging.root).free
        uptime = max(0, int(self.server.clock() - self.server.started_at))
        return {
            "batchCeiling": self.server.config.batch_ceiling,
            "device": self.server.config.device,
            "draining": runtime.draining,
            "freeDisk": free_bytes,
            "freeStagingBytes": free_bytes,
            "jobsInFlight": runtime.jobs_in_flight,
            "lmBackend": self.server.config.lm_backend,
            "modelId": self.server.config.model_id,
            "modelRevision": self.server.config.model_revision,
            "protocolVersion": self.server.config.protocol_version,
            "status": "draining" if runtime.draining else "ok",
            "uptimeSeconds": uptime,
            "vaeChunk": self.server.config.vae_chunk,
        }

    def _capabilities_payload(self) -> dict[str, object]:
        return {
            "batchCeiling": self.server.config.batch_ceiling,
            "device": self.server.config.device,
            "durationSeconds": {"maximum": 184, "minimum": 150},
            "engine": {
                "name": "ace-step-1.5",
                "repoCommit": ACE_STEP_REPO_COMMIT,
                "upstreamApiVersion": "1",
            },
            "generationAvailable": False,
            "lmBackend": self.server.config.lm_backend,
            "modelId": self.server.config.model_id,
            "modelLoaded": False,
            "modelRevision": self.server.config.model_revision,
            "protocolVersion": self.server.config.protocol_version,
            "referenceAudio": False,
            "vaeChunk": self.server.config.vae_chunk,
            "workerId": self.server.config.worker_id,
        }

    def do_GET(self) -> None:
        started_at = time.monotonic()
        route = self._route()
        status = HTTPStatus.NOT_FOUND
        if route == "/v1/health":
            status = HTTPStatus.OK
            self._write_json(status, self._health_payload())
        elif route == "/v1/capabilities":
            if not self._authenticate("GET", route):
                status = HTTPStatus.UNAUTHORIZED
            else:
                status = HTTPStatus.OK
                self._write_json(status, self._capabilities_payload())
        else:
            self._write_json(
                status,
                {"error": {"code": "not_found"}, "status": "error"},
            )

        self.server.logger.emit(
            "request_completed",
            requestId=secrets.token_hex(8),
            method="GET",
            route=route if route in {"/v1/health", "/v1/capabilities"} else "unknown",
            status=status.value,
            elapsedMs=round((time.monotonic() - started_at) * 1000, 3),
        )

    def do_POST(self) -> None:
        started_at = time.monotonic()
        route = self._route()
        status = HTTPStatus.NOT_FOUND
        if route != "/v1/admin/drain":
            self._write_json(
                status,
                {"error": {"code": "not_found"}, "status": "error"},
            )
        else:
            length_text = self.headers.get("Content-Length")
            try:
                content_length = int(length_text or "")
            except ValueError:
                content_length = -1

            if content_length < 0:
                status = HTTPStatus.LENGTH_REQUIRED
                self._write_json(
                    status,
                    {"error": {"code": "content_length_required"}, "status": "error"},
                )
            elif content_length > MAXIMUM_REQUEST_BODY_BYTES:
                status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                self._write_json(
                    status,
                    {"error": {"code": "payload_too_large"}, "status": "error"},
                )
            else:
                body = self.rfile.read(content_length)
                if not self._authenticate("POST", route, body):
                    status = HTTPStatus.UNAUTHORIZED
                elif self.headers.get_content_type().lower() != "application/json":
                    status = HTTPStatus.UNSUPPORTED_MEDIA_TYPE
                    self._write_json(
                        status,
                        {"error": {"code": "json_required"}, "status": "error"},
                    )
                else:
                    try:
                        validate_drain_request(body)
                    except PayloadError:
                        status = HTTPStatus.BAD_REQUEST
                        self._write_json(
                            status,
                            {"error": {"code": "invalid_payload"}, "status": "error"},
                        )
                    else:
                        snapshot = self.server.drain_controller.request_drain()
                        status = HTTPStatus.ACCEPTED
                        self._write_json(
                            status,
                            {
                                "acceptingJobs": False,
                                "draining": snapshot.draining,
                                "jobsInFlight": snapshot.jobs_in_flight,
                                "protocolVersion": self.server.config.protocol_version,
                                "status": "draining",
                            },
                        )

        self.server.logger.emit(
            "request_completed",
            requestId=secrets.token_hex(8),
            method="POST",
            route=route if route == "/v1/admin/drain" else "unknown",
            status=status.value,
            elapsedMs=round((time.monotonic() - started_at) * 1000, 3),
        )


def create_server(
    config: ServerConfig,
    *,
    clock: Callable[[], float] = time.time,
    log_stream: TextIO | None = None,
    drain_controller: DrainController | None = None,
) -> LofigenHttpServer:
    return LofigenHttpServer(
        config,
        clock=clock,
        logger=SafeJsonLogger(log_stream or sys.stdout),
        drain_controller=drain_controller or DrainController(),
    )
