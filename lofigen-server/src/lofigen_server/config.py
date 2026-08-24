from __future__ import annotations

from dataclasses import dataclass, field
import ipaddress
import os
from pathlib import Path
import re
import stat
from typing import Mapping
from urllib.parse import urlsplit


PROTOCOL_VERSION_PATTERN = re.compile(r"^[1-9][0-9]*(?:\.[0-9]+){0,2}$")
WORKER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
CAPABILITY_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
MINIMUM_HMAC_KEY_BYTES = 32
MAXIMUM_HMAC_KEY_BYTES = 1024


class ConfigError(ValueError):
    """A configuration rejection safe to expose by stable error code only."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ServerConfig:
    bind: str
    port: int
    protocol_version: str
    worker_id: str
    staging_dir: Path = field(repr=False)
    hmac_key_file: Path = field(repr=False)
    hmac_key: bytes = field(repr=False)
    hmac_window_seconds: int = 300
    allow_non_loopback: bool = False
    device: str = "mps"
    lm_backend: str = "mlx"
    model_id: str | None = None
    model_revision: str | None = None
    vae_chunk: int | None = None
    batch_ceiling: int = 1
    acestep_url: str = "http://127.0.0.1:8001"


def _parse_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigError("invalid_boolean")


def _parse_integer(value: str, *, code: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ConfigError(code) from error


def _validate_bind(bind: str, *, allow_non_loopback: bool) -> str:
    try:
        address = ipaddress.ip_address(bind)
    except ValueError as error:
        raise ConfigError("invalid_bind") from error

    if address.is_unspecified or address.is_multicast:
        raise ConfigError("unsafe_bind")
    if not address.is_loopback and not allow_non_loopback:
        raise ConfigError("non_loopback_requires_opt_in")
    return address.compressed


def _validate_staging_dir(raw_path: str | None) -> Path:
    if not raw_path:
        raise ConfigError("staging_dir_required")

    candidate = Path(raw_path).expanduser()
    if candidate.is_symlink():
        raise ConfigError("unsafe_staging_dir")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise ConfigError("staging_dir_unavailable") from error
    if not resolved.is_dir() or not os.access(resolved, os.R_OK | os.W_OK | os.X_OK):
        raise ConfigError("staging_dir_unavailable")
    return resolved


def _load_hmac_key(raw_path: str | None) -> tuple[Path, bytes]:
    if not raw_path:
        raise ConfigError("hmac_key_required")

    candidate = Path(raw_path).expanduser()
    if candidate.is_symlink():
        raise ConfigError("unsafe_hmac_key_file")
    try:
        metadata = candidate.stat()
    except OSError as error:
        raise ConfigError("hmac_key_unavailable") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise ConfigError("hmac_key_unavailable")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ConfigError("hmac_key_permissions")

    try:
        key = candidate.read_bytes().rstrip(b"\r\n")
    except OSError as error:
        raise ConfigError("hmac_key_unavailable") from error
    if not MINIMUM_HMAC_KEY_BYTES <= len(key) <= MAXIMUM_HMAC_KEY_BYTES:
        raise ConfigError("hmac_key_length")
    return candidate.resolve(strict=True), key


def _optional_capability_value(value: object, *, code: str) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    normalized = str(value).strip()
    if not CAPABILITY_VALUE_PATTERN.fullmatch(normalized) or normalized.startswith("/"):
        raise ConfigError(code)
    return normalized


def _validate_acestep_url(raw_url: object) -> str:
    try:
        parsed = urlsplit(str(raw_url))
        port = parsed.port
        address = ipaddress.ip_address(parsed.hostname or "")
    except (ValueError, TypeError) as error:
        raise ConfigError("unsafe_acestep_url") from error
    if (
        parsed.scheme != "http"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or address.version != 4
        or not address.is_loopback
        or port is None
    ):
        raise ConfigError("unsafe_acestep_url")
    return f"http://{address.compressed}:{port}"


def load_config(
    values: Mapping[str, str | bool | int | None],
) -> ServerConfig:
    """Validate CLI/environment values without writing to the filesystem."""

    allow_non_loopback_value = values.get("allow_non_loopback", False)
    if isinstance(allow_non_loopback_value, bool):
        allow_non_loopback = allow_non_loopback_value
    else:
        allow_non_loopback = _parse_bool(str(allow_non_loopback_value))

    bind = _validate_bind(
        str(values.get("bind") or "127.0.0.1"),
        allow_non_loopback=allow_non_loopback,
    )
    port_value = values.get("port", 8787)
    port = port_value if isinstance(port_value, int) else _parse_integer(str(port_value), code="invalid_port")
    if not 1 <= port <= 65535:
        raise ConfigError("invalid_port")

    protocol_version = str(values.get("protocol_version") or "1")
    if (
        not PROTOCOL_VERSION_PATTERN.fullmatch(protocol_version)
        or protocol_version.split(".", maxsplit=1)[0] != "1"
    ):
        raise ConfigError("invalid_protocol_version")

    worker_id = str(values.get("worker_id") or "local-worker")
    if not WORKER_ID_PATTERN.fullmatch(worker_id):
        raise ConfigError("invalid_worker_id")

    window_value = values.get("hmac_window_seconds", 300)
    hmac_window_seconds = (
        window_value
        if isinstance(window_value, int)
        else _parse_integer(str(window_value), code="invalid_hmac_window")
    )
    if not 1 <= hmac_window_seconds <= 300:
        raise ConfigError("invalid_hmac_window")

    staging_dir = _validate_staging_dir(
        str(values["staging_dir"]) if values.get("staging_dir") else None
    )
    hmac_key_file, hmac_key = _load_hmac_key(
        str(values["hmac_key_file"]) if values.get("hmac_key_file") else None
    )

    device = _optional_capability_value(values.get("device", "mps"), code="invalid_device")
    lm_backend = _optional_capability_value(
        values.get("lm_backend", "mlx"),
        code="invalid_lm_backend",
    )
    if device is None or lm_backend is None:
        raise ConfigError("invalid_capabilities")
    model_id = _optional_capability_value(values.get("model_id"), code="invalid_model_id")
    model_revision = _optional_capability_value(
        values.get("model_revision"),
        code="invalid_model_revision",
    )

    vae_chunk_value = values.get("vae_chunk")
    vae_chunk = None
    if vae_chunk_value not in {None, ""}:
        vae_chunk = (
            vae_chunk_value
            if isinstance(vae_chunk_value, int)
            else _parse_integer(str(vae_chunk_value), code="invalid_vae_chunk")
        )
        if vae_chunk <= 0:
            raise ConfigError("invalid_vae_chunk")

    batch_value = values.get("batch_ceiling", 1)
    batch_ceiling = (
        batch_value
        if isinstance(batch_value, int)
        else _parse_integer(str(batch_value), code="invalid_batch_ceiling")
    )
    if not 1 <= batch_ceiling <= 8:
        raise ConfigError("invalid_batch_ceiling")
    acestep_url = _validate_acestep_url(
        values.get("acestep_url", "http://127.0.0.1:8001")
    )

    return ServerConfig(
        bind=bind,
        port=port,
        protocol_version=protocol_version,
        worker_id=worker_id,
        staging_dir=staging_dir,
        hmac_key_file=hmac_key_file,
        hmac_key=hmac_key,
        hmac_window_seconds=hmac_window_seconds,
        allow_non_loopback=allow_non_loopback,
        device=device,
        lm_backend=lm_backend,
        model_id=model_id,
        model_revision=model_revision,
        vae_chunk=vae_chunk,
        batch_ceiling=batch_ceiling,
        acestep_url=acestep_url,
    )
