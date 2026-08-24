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

from .auth import SignatureVerifier
from .config import ServerConfig
from .runtime import DrainController
from .safe_logging import SafeJsonLogger


ACE_STEP_REPO_COMMIT = "14c0211d5a0653b0f63e27686f4c3f151b4d8629"


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
        self.signature_verifier = SignatureVerifier(
            config.hmac_key,
            window_seconds=config.hmac_window_seconds,
            clock=clock,
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
        free_bytes = shutil.disk_usage(self.server.config.staging_dir).free
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
        self._write_json(
            HTTPStatus.NOT_FOUND,
            {"error": {"code": "not_found"}, "status": "error"},
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
