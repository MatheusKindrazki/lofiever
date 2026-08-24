from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import re
from threading import Lock
from typing import Callable, Mapping


TIMESTAMP_HEADER = "X-Lofiever-Timestamp"
NONCE_HEADER = "X-Lofiever-Nonce"
SIGNATURE_HEADER = "X-Lofiever-Signature"
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
SIGNATURE_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def canonical_message(
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> bytes:
    """Build the RFC canonical HMAC message with unambiguous newlines."""

    body_digest = hashlib.sha256(body).hexdigest()
    return "\n".join(
        [method.upper(), path, timestamp, nonce, body_digest]
    ).encode("utf-8")


class NonceCache:
    """Bounded, process-local replay protection for the single worker process."""

    def __init__(self, *, maximum_entries: int = 10_000) -> None:
        self._entries: dict[str, float] = {}
        self._maximum_entries = maximum_entries
        self._lock = Lock()

    def accept(self, nonce: str, *, now: float, ttl_seconds: int) -> bool:
        with self._lock:
            expired = [key for key, expires_at in self._entries.items() if expires_at <= now]
            for key in expired:
                del self._entries[key]

            if nonce in self._entries or len(self._entries) >= self._maximum_entries:
                return False
            self._entries[nonce] = now + ttl_seconds
            return True


@dataclass(frozen=True)
class AuthDecision:
    accepted: bool


class SignatureVerifier:
    def __init__(
        self,
        key: bytes,
        *,
        window_seconds: int,
        clock: Callable[[], float],
        nonce_cache: NonceCache | None = None,
    ) -> None:
        self._key = key
        self._window_seconds = window_seconds
        self._clock = clock
        self._nonce_cache = nonce_cache or NonceCache()

    def verify(
        self,
        method: str,
        path: str,
        body: bytes,
        headers: Mapping[str, str],
    ) -> AuthDecision:
        normalized_headers = {name.lower(): value for name, value in headers.items()}
        timestamp_text = (normalized_headers.get(TIMESTAMP_HEADER.lower()) or "").strip()
        nonce = (normalized_headers.get(NONCE_HEADER.lower()) or "").strip()
        signature = (normalized_headers.get(SIGNATURE_HEADER.lower()) or "").strip()
        if not timestamp_text.isascii() or not timestamp_text.isdecimal():
            return AuthDecision(False)
        if not NONCE_PATTERN.fullmatch(nonce):
            return AuthDecision(False)
        if not SIGNATURE_PATTERN.fullmatch(signature):
            return AuthDecision(False)

        timestamp = int(timestamp_text)
        now = self._clock()
        if abs(now - timestamp) > self._window_seconds:
            return AuthDecision(False)

        expected = hmac.new(
            self._key,
            canonical_message(method, path, timestamp_text, nonce, body),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature.lower()):
            return AuthDecision(False)
        if not self._nonce_cache.accept(
            nonce,
            now=now,
            ttl_seconds=self._window_seconds,
        ):
            return AuthDecision(False)
        return AuthDecision(True)
