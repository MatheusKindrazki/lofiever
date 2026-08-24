from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import os
from pathlib import Path
import re
import sqlite3
import stat
from threading import Lock
from typing import Callable, Mapping

from .staging import DirectoryIdentity


TIMESTAMP_HEADER = "X-Lofiever-Timestamp"
NONCE_HEADER = "X-Lofiever-Nonce"
SIGNATURE_HEADER = "X-Lofiever-Signature"
SIGNATURE_VERSION_HEADER = "X-Lofiever-Signature-Version"
WORKER_ID_HEADER = "X-Lofiever-Worker-Id"
SIGNATURE_VERSION = "1"
CANONICAL_LABEL = "LOFIEVER-HMAC-SHA256-V1"
AUTHENTICATION_HEADERS = (
    SIGNATURE_VERSION_HEADER,
    WORKER_ID_HEADER,
    TIMESTAMP_HEADER,
    NONCE_HEADER,
    SIGNATURE_HEADER,
)
TIMESTAMP_PATTERN = re.compile(r"^(?:0|[1-9][0-9]{0,11})$")
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
SIGNATURE_PATTERN = re.compile(r"^[0-9a-f]{64}$")
WORKER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def canonical_message(
    worker_id: str,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> bytes:
    """Build the RFC canonical HMAC message with unambiguous newlines."""

    body_digest = hashlib.sha256(body).hexdigest()
    return "\n".join(
        [
            CANONICAL_LABEL,
            worker_id,
            method.upper(),
            path,
            timestamp,
            nonce,
            body_digest,
        ]
    ).encode("utf-8")


class SqliteNonceStore:
    """Atomic replay protection shared by every server using one private run dir."""

    def __init__(
        self,
        run_dir: Path,
        *,
        expected_run_identity: DirectoryIdentity | None = None,
        maximum_entries: int = 10_000,
        cleanup_batch: int = 256,
    ) -> None:
        self._run_dir = run_dir.absolute()
        self._database_name = "hmac-nonces.sqlite3"
        self._path = self._run_dir / self._database_name
        self._maximum_entries = maximum_entries
        self._cleanup_batch = cleanup_batch
        self._lock = Lock()
        self._run_fd = -1
        self._database_fd = -1
        self._connection: sqlite3.Connection | None = None
        nofollow = getattr(os, "O_NOFOLLOW", 0)
        directory = getattr(os, "O_DIRECTORY", 0)
        if nofollow == 0 or directory == 0:
            raise OSError("secure nonce store descriptors are unavailable")
        close_on_exec = getattr(os, "O_CLOEXEC", 0)
        try:
            self._run_fd = os.open(
                self._run_dir,
                os.O_RDONLY | directory | nofollow | close_on_exec,
            )
            run_metadata = os.fstat(self._run_fd)
            if (
                not stat.S_ISDIR(run_metadata.st_mode)
                or run_metadata.st_uid != os.geteuid()
                or stat.S_IMODE(run_metadata.st_mode) != 0o700
            ):
                raise OSError("unsafe nonce store directory")
            self._run_identity = DirectoryIdentity.from_stat(run_metadata)
            if (
                expected_run_identity is not None
                and expected_run_identity != self._run_identity
            ):
                raise OSError("nonce store directory identity changed")

            self._database_fd = os.open(
                self._database_name,
                os.O_RDWR | os.O_CREAT | nofollow | close_on_exec,
                0o600,
                dir_fd=self._run_fd,
            )
            database_metadata = os.fstat(self._database_fd)
            if (
                not stat.S_ISREG(database_metadata.st_mode)
                or database_metadata.st_uid != os.geteuid()
                or stat.S_IMODE(database_metadata.st_mode) & 0o077
            ):
                raise OSError("unsafe nonce store file")
            self._database_identity = self._file_identity(database_metadata)

            self._connection = sqlite3.connect(
                self._path,
                timeout=2.0,
                check_same_thread=False,
            )
            self._connection.execute("PRAGMA busy_timeout = 2000")
            self._connection.execute("PRAGMA journal_mode = DELETE")
            self._connection.execute("PRAGMA synchronous = FULL")
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS used_nonces (
                    nonce TEXT PRIMARY KEY,
                    expires_at REAL NOT NULL
                ) WITHOUT ROWID
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS used_nonces_expiry ON used_nonces(expires_at)"
            )
            self._connection.commit()
            if not self._identities_intact():
                raise OSError("nonce store identity changed during setup")
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _file_identity(metadata: os.stat_result) -> tuple[int, int, int, int]:
        return (
            metadata.st_dev,
            metadata.st_ino,
            metadata.st_uid,
            stat.S_IMODE(metadata.st_mode),
        )

    def _identities_intact(self) -> bool:
        if self._run_fd < 0 or self._database_fd < 0:
            return False
        try:
            held_run = os.fstat(self._run_fd)
            current_run = self._run_dir.lstat()
            held_database = os.fstat(self._database_fd)
            current_database = os.stat(
                self._database_name,
                dir_fd=self._run_fd,
                follow_symlinks=False,
            )
        except OSError:
            return False
        return (
            stat.S_ISDIR(held_run.st_mode)
            and stat.S_ISDIR(current_run.st_mode)
            and self._run_identity.matches(held_run)
            and self._run_identity.matches(current_run)
            and stat.S_ISREG(held_database.st_mode)
            and stat.S_ISREG(current_database.st_mode)
            and self._file_identity(held_database) == self._database_identity
            and self._file_identity(current_database) == self._database_identity
        )

    def close(self) -> None:
        with self._lock:
            connection = self._connection
            self._connection = None
            try:
                if connection is not None:
                    connection.close()
            finally:
                try:
                    if self._database_fd >= 0:
                        os.close(self._database_fd)
                        self._database_fd = -1
                finally:
                    if self._run_fd >= 0:
                        os.close(self._run_fd)
                        self._run_fd = -1

    def accept(
        self,
        nonce: str,
        *,
        now: float,
        signed_timestamp: int,
        window_seconds: int,
    ) -> bool:
        expires_at = float(signed_timestamp + window_seconds)
        with self._lock:
            connection = self._connection
            if connection is None or not self._identities_intact():
                return False
            try:
                connection.execute("BEGIN IMMEDIATE")
                expired = connection.execute(
                    """
                    SELECT nonce
                    FROM used_nonces
                    WHERE expires_at < ?
                    ORDER BY expires_at
                    LIMIT ?
                    """,
                    (now, self._cleanup_batch),
                ).fetchall()
                if expired:
                    connection.executemany(
                        "DELETE FROM used_nonces WHERE nonce = ?",
                        expired,
                    )
                count = connection.execute(
                    "SELECT COUNT(*) FROM used_nonces"
                ).fetchone()[0]
                if count >= self._maximum_entries:
                    connection.rollback()
                    return False
                try:
                    connection.execute(
                        "INSERT INTO used_nonces(nonce, expires_at) VALUES (?, ?)",
                        (nonce, expires_at),
                    )
                except sqlite3.IntegrityError:
                    connection.rollback()
                    return False
                connection.commit()
                return True
            except sqlite3.Error:
                try:
                    connection.rollback()
                except sqlite3.Error:
                    pass
                return False


@dataclass(frozen=True)
class AuthDecision:
    accepted: bool


@dataclass(frozen=True)
class SignatureEnvelope:
    signature_version: str
    worker_id: str
    timestamp_text: str
    timestamp: int
    nonce: str
    signature: str


class SignatureVerifier:
    def __init__(
        self,
        key: bytes,
        *,
        worker_id: str,
        window_seconds: int,
        clock: Callable[[], float],
        nonce_store: SqliteNonceStore,
    ) -> None:
        self._key = key
        self._worker_id = worker_id
        self._window_seconds = window_seconds
        self._clock = clock
        self._nonce_store = nonce_store

    def verify(
        self,
        method: str,
        path: str,
        body: bytes,
        headers: Mapping[str, str],
    ) -> AuthDecision:
        envelope = self.prevalidate(headers)
        if envelope is None:
            return AuthDecision(False)
        return self.verify_prevalidated(method, path, body, envelope)

    def prevalidate(
        self,
        headers: Mapping[str, str],
    ) -> SignatureEnvelope | None:
        """Reject malformed or stale authentication metadata before reading a body."""

        normalized_headers = {name.lower(): value for name, value in headers.items()}
        signature_version = (
            normalized_headers.get(SIGNATURE_VERSION_HEADER.lower()) or ""
        ).strip()
        worker_id = (normalized_headers.get(WORKER_ID_HEADER.lower()) or "").strip()
        timestamp_text = (normalized_headers.get(TIMESTAMP_HEADER.lower()) or "").strip()
        nonce = (normalized_headers.get(NONCE_HEADER.lower()) or "").strip()
        signature = (normalized_headers.get(SIGNATURE_HEADER.lower()) or "").strip()
        if signature_version != SIGNATURE_VERSION:
            return None
        if not WORKER_ID_PATTERN.fullmatch(worker_id):
            return None
        if not hmac.compare_digest(worker_id, self._worker_id):
            return None
        if not TIMESTAMP_PATTERN.fullmatch(timestamp_text):
            return None
        if not NONCE_PATTERN.fullmatch(nonce):
            return None
        if not SIGNATURE_PATTERN.fullmatch(signature):
            return None

        timestamp = int(timestamp_text)
        now = self._clock()
        if abs(now - timestamp) > self._window_seconds:
            return None
        return SignatureEnvelope(
            signature_version=signature_version,
            worker_id=worker_id,
            timestamp_text=timestamp_text,
            timestamp=timestamp,
            nonce=nonce,
            signature=signature,
        )

    def verify_prevalidated(
        self,
        method: str,
        path: str,
        body: bytes,
        envelope: SignatureEnvelope,
    ) -> AuthDecision:
        now = self._clock()
        if abs(now - envelope.timestamp) > self._window_seconds:
            return AuthDecision(False)

        expected = hmac.new(
            self._key,
            canonical_message(
                envelope.worker_id,
                method,
                path,
                envelope.timestamp_text,
                envelope.nonce,
                body,
            ),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, envelope.signature):
            return AuthDecision(False)
        if not self._nonce_store.accept(
            envelope.nonce,
            now=now,
            signed_timestamp=envelope.timestamp,
            window_seconds=self._window_seconds,
        ):
            return AuthDecision(False)
        return AuthDecision(True)
