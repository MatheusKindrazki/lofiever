from __future__ import annotations

from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import secrets
import socket
import sys
from threading import BoundedSemaphore, Event, Timer
import time
from typing import TextIO
from urllib.parse import urlsplit

from .auth import (
    AUTHENTICATION_HEADERS,
    SignatureEnvelope,
    SignatureVerifier,
    SqliteNonceStore,
)
from .config import ServerConfig
from .runtime import DrainController
from .safe_logging import SafeJsonLogger
from .schemas import PayloadError, validate_drain_request
from .staging import StagingRoot


ACE_STEP_REPO_COMMIT = "14c0211d5a0653b0f63e27686f4c3f151b4d8629"
MAXIMUM_REQUEST_BODY_BYTES = 1024
CONTENT_LENGTH_PATTERN = re.compile(r"^(?:0|[1-9][0-9]{0,9})$")
DEFAULT_REQUEST_TIMEOUT_SECONDS = 5.0
DEFAULT_MAXIMUM_HANDLERS = 16


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
        request_timeout_seconds: float,
        maximum_handlers: int,
    ) -> None:
        if request_timeout_seconds <= 0 or maximum_handlers < 1:
            raise ValueError("invalid HTTP safety limits")
        self.config = config
        self.clock = clock
        self.started_at = clock()
        self.logger = logger
        self.drain_controller = drain_controller
        self.request_timeout_seconds = request_timeout_seconds
        self._handler_slots = BoundedSemaphore(maximum_handlers)
        self.staging = StagingRoot(config.staging_dir)
        try:
            self.signature_verifier = SignatureVerifier(
                config.hmac_key,
                worker_id=config.worker_id,
                window_seconds=config.hmac_window_seconds,
                clock=clock,
                nonce_store=SqliteNonceStore(config.run_dir),
            )
            if ":" in config.bind:
                self.address_family = socket.AF_INET6
            super().__init__((config.bind, config.port), LofigenRequestHandler)
        except BaseException:
            self.staging.close()
            raise

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self.staging.close()

    def get_request(self) -> tuple[socket.socket, object]:
        request, client_address = super().get_request()
        request.settimeout(self.request_timeout_seconds)
        return request, client_address

    def process_request(self, request: socket.socket, client_address: object) -> None:
        if not self._handler_slots.acquire(blocking=False):
            self._reject_overloaded_connection(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._handler_slots.release()
            raise

    def process_request_thread(
        self,
        request: socket.socket,
        client_address: object,
    ) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._handler_slots.release()

    def _reject_overloaded_connection(self, request: socket.socket) -> None:
        body = b'{"error":{"code":"server_busy"},"status":"error"}'
        response = (
            b"HTTP/1.1 503 Service Unavailable\r\n"
            b"Content-Type: application/json; charset=utf-8\r\n"
            + f"Content-Length: {len(body)}\r\n".encode("ascii")
            + b"Cache-Control: no-store\r\n"
            + b"X-Content-Type-Options: nosniff\r\n"
            + b"Connection: close\r\n\r\n"
            + body
        )
        try:
            request.sendall(response)
        except OSError:
            pass
        finally:
            self.shutdown_request(request)
        self.logger.emit("request_rejected", status=HTTPStatus.SERVICE_UNAVAILABLE.value)

    def handle_error(self, _request: object, _client_address: object) -> None:
        """Suppress socketserver tracebacks and emit only allowlisted metadata."""

        self.logger.emit("handler_failed", status=HTTPStatus.INTERNAL_SERVER_ERROR.value)


class LofigenRequestHandler(BaseHTTPRequestHandler):
    server: LofigenHttpServer
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_arguments: object) -> None:
        return

    def handle(self) -> None:
        self._deadline_expired = Event()
        deadline_timer = Timer(
            self.server.request_timeout_seconds,
            self._expire_request_deadline,
        )
        deadline_timer.daemon = True
        deadline_timer.start()
        try:
            super().handle()
        finally:
            deadline_timer.cancel()

    def _expire_request_deadline(self) -> None:
        self._deadline_expired.set()
        try:
            self.connection.shutdown(socket.SHUT_RD)
        except OSError:
            pass

    def handle_expect_100(self) -> bool:
        self._write_json(
            HTTPStatus.EXPECTATION_FAILED,
            {"error": {"code": "expectation_not_supported"}, "status": "error"},
        )
        return False

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

    def _authentication_headers(self) -> dict[str, str] | None:
        selected: dict[str, str] = {}
        for name in AUTHENTICATION_HEADERS:
            values = self.headers.get_all(name, failobj=[])
            if len(values) != 1:
                return None
            selected[name] = values[0]
        return selected

    def _prevalidate_authentication(self) -> SignatureEnvelope | None:
        headers = self._authentication_headers()
        if headers is None:
            self._write_authentication_failure()
            return None
        envelope = self.server.signature_verifier.prevalidate(headers)
        if envelope is None:
            self._write_authentication_failure()
            return None
        return envelope

    def _authenticate(self, method: str, route: str, body: bytes = b"") -> bool:
        envelope = self._prevalidate_authentication()
        if envelope is None:
            return False
        return self._authenticate_prevalidated(method, route, body, envelope)

    def _authenticate_prevalidated(
        self,
        method: str,
        route: str,
        body: bytes,
        envelope: SignatureEnvelope,
    ) -> bool:
        decision = self.server.signature_verifier.verify_prevalidated(
            method,
            route,
            body,
            envelope,
        )
        if decision.accepted:
            return True
        self._write_authentication_failure()
        return False

    def _write_authentication_failure(self) -> None:
        self._write_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": {"code": "authentication_failed"}, "status": "error"},
            extra_headers={"WWW-Authenticate": "HMAC-SHA256"},
        )

    def _read_exact_body(self, content_length: int) -> tuple[bytes | None, HTTPStatus | None]:
        try:
            body = self.rfile.read(content_length)
        except TimeoutError:
            return None, HTTPStatus.REQUEST_TIMEOUT
        except OSError:
            if self._deadline_expired.is_set():
                return None, HTTPStatus.REQUEST_TIMEOUT
            return None, HTTPStatus.BAD_REQUEST
        if self._deadline_expired.is_set():
            return None, HTTPStatus.REQUEST_TIMEOUT
        if len(body) != content_length:
            return None, HTTPStatus.BAD_REQUEST
        return body, None

    def _write_error(self, status: HTTPStatus, code: str) -> None:
        self._write_json(
            status,
            {"error": {"code": code}, "status": "error"},
        )

    def _health_payload(self) -> dict[str, object]:
        runtime = self.server.drain_controller.snapshot()
        free_bytes = self.server.staging.free_bytes()
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
            "workerId": self.server.config.worker_id,
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
        try:
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
                self._write_error(status, "not_found")
        except Exception:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
            self.server.logger.emit(
                "request_failed",
                method="GET",
                route=route if route in {"/v1/health", "/v1/capabilities"} else "unknown",
                status=status.value,
            )
            self._write_error(status, "internal_error")

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
        try:
            if route != "/v1/admin/drain":
                self._write_error(status, "not_found")
            else:
                envelope = self._prevalidate_authentication()
                if envelope is None:
                    status = HTTPStatus.UNAUTHORIZED
                else:
                    content_length_values = self.headers.get_all(
                        "Content-Length",
                        failobj=[],
                    )
                    content_type_values = self.headers.get_all(
                        "Content-Type",
                        failobj=[],
                    )
                    transfer_encoding_values = self.headers.get_all(
                        "Transfer-Encoding",
                        failobj=[],
                    )
                    if not content_length_values:
                        status = HTTPStatus.LENGTH_REQUIRED
                        self._write_error(status, "content_length_required")
                    elif (
                        len(content_length_values) != 1
                        or len(content_type_values) != 1
                        or transfer_encoding_values
                    ):
                        status = HTTPStatus.BAD_REQUEST
                        self._write_error(status, "invalid_request_headers")
                    else:
                        length_text = content_length_values[0].strip()
                        content_type = (
                            content_type_values[0]
                            .split(";", maxsplit=1)[0]
                            .strip()
                            .lower()
                        )
                        if not CONTENT_LENGTH_PATTERN.fullmatch(length_text):
                            status = HTTPStatus.BAD_REQUEST
                            self._write_error(status, "invalid_request_headers")
                        elif int(length_text) > MAXIMUM_REQUEST_BODY_BYTES:
                            status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                            self._write_error(status, "payload_too_large")
                        elif content_type != "application/json":
                            status = HTTPStatus.UNSUPPORTED_MEDIA_TYPE
                            self._write_error(status, "json_required")
                        else:
                            body, read_error = self._read_exact_body(int(length_text))
                            if read_error == HTTPStatus.REQUEST_TIMEOUT:
                                status = read_error
                                self._write_error(status, "request_timeout")
                            elif read_error is not None or body is None:
                                status = HTTPStatus.BAD_REQUEST
                                self._write_error(status, "incomplete_body")
                            elif not self._authenticate_prevalidated(
                                "POST",
                                route,
                                body,
                                envelope,
                            ):
                                status = HTTPStatus.UNAUTHORIZED
                            else:
                                try:
                                    validate_drain_request(body)
                                except PayloadError:
                                    status = HTTPStatus.BAD_REQUEST
                                    self._write_error(status, "invalid_payload")
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
        except Exception:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
            self.server.logger.emit(
                "request_failed",
                method="POST",
                route=route if route == "/v1/admin/drain" else "unknown",
                status=status.value,
            )
            self._write_error(status, "internal_error")

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
    request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    maximum_handlers: int = DEFAULT_MAXIMUM_HANDLERS,
) -> LofigenHttpServer:
    return LofigenHttpServer(
        config,
        clock=clock,
        logger=SafeJsonLogger(log_stream or sys.stdout),
        drain_controller=drain_controller or DrainController(),
        request_timeout_seconds=request_timeout_seconds,
        maximum_handlers=maximum_handlers,
    )
