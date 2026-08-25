from __future__ import annotations

from dataclasses import dataclass, field
import errno
import hmac
import ipaddress
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
from typing import Mapping
from urllib.parse import urlsplit

from .staging import DirectoryIdentity


PROTOCOL_VERSION_PATTERN = re.compile(r"^[1-9][0-9]*(?:\.[0-9]+){0,2}$")
WORKER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
CAPABILITY_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
MINIMUM_HMAC_KEY_BYTES = 32
MAXIMUM_HMAC_KEY_BYTES = 1024
TAILSCALE_IPV4_NETWORK = ipaddress.ip_network("100.64.0.0/10")
TAILSCALE_IPV6_NETWORK = ipaddress.ip_network("fd7a:115c:a1e0::/48")


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
    run_dir: Path = field(repr=False)
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
    _staging_identity: DirectoryIdentity | None = field(
        default=None,
        repr=False,
        compare=False,
    )
    _run_identity: DirectoryIdentity | None = field(
        default=None,
        repr=False,
        compare=False,
    )


def _parse_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigError("invalid_boolean")


def _parse_integer(value: object, *, code: str) -> int:
    if type(value) is int:
        return value
    if not isinstance(value, str):
        raise ConfigError(code)
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
    if not address.is_loopback:
        if not allow_non_loopback:
            raise ConfigError("non_loopback_requires_opt_in")
        expected_network = (
            TAILSCALE_IPV4_NETWORK
            if address.version == 4
            else TAILSCALE_IPV6_NETWORK
        )
        if address not in expected_network:
            raise ConfigError("tailscale_bind_required")
        if address not in _local_tailscale_addresses():
            raise ConfigError("tailscale_address_not_local")
    return address.compressed


def _local_tailscale_addresses() -> frozenset[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    executable = shutil.which("tailscale")
    if executable is None:
        raise ConfigError("tailscale_unavailable")
    try:
        result = subprocess.run(
            [executable, "ip"],
            capture_output=True,
            check=False,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ConfigError("tailscale_unavailable") from error
    if result.returncode != 0:
        raise ConfigError("tailscale_unavailable")

    addresses: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    lines = result.stdout.splitlines()
    if not lines or len(lines) > 16:
        raise ConfigError("tailscale_unavailable")
    for line in lines:
        candidate = line.strip()
        if not candidate or len(candidate) > 64:
            raise ConfigError("tailscale_unavailable")
        try:
            address = ipaddress.ip_address(candidate)
        except ValueError as error:
            raise ConfigError("tailscale_unavailable") from error
        network = (
            TAILSCALE_IPV4_NETWORK
            if address.version == 4
            else TAILSCALE_IPV6_NETWORK
        )
        if address not in network:
            raise ConfigError("tailscale_unavailable")
        addresses.add(address)
    return frozenset(addresses)


def _validate_staging_dir(raw_path: str | None) -> tuple[Path, DirectoryIdentity]:
    if not raw_path:
        raise ConfigError("staging_dir_required")

    candidate = Path(raw_path).expanduser()
    if candidate.is_symlink():
        raise ConfigError("unsafe_staging_dir")
    try:
        resolved = candidate.resolve(strict=True)
        metadata = resolved.stat()
    except OSError as error:
        raise ConfigError("staging_dir_unavailable") from error
    if not stat.S_ISDIR(metadata.st_mode):
        raise ConfigError("staging_dir_unavailable")
    if (
        metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
        or not os.access(resolved, os.R_OK | os.W_OK | os.X_OK)
    ):
        raise ConfigError("unsafe_staging_dir")
    return resolved, DirectoryIdentity.from_stat(metadata)


def _validate_run_dir(raw_path: str | None) -> tuple[Path, DirectoryIdentity]:
    if not raw_path:
        raise ConfigError("run_dir_required")

    candidate = Path(raw_path).expanduser()
    if candidate.is_symlink():
        raise ConfigError("unsafe_run_dir")
    try:
        resolved = candidate.resolve(strict=True)
        metadata = resolved.stat()
    except OSError as error:
        raise ConfigError("run_dir_unavailable") from error
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
        or not os.access(resolved, os.R_OK | os.W_OK | os.X_OK)
    ):
        raise ConfigError("unsafe_run_dir")
    return resolved, DirectoryIdentity.from_stat(metadata)


def _validate_hmac_key_parent_descriptor(
    descriptor: int,
    *,
    is_direct_parent: bool,
) -> None:
    metadata = os.fstat(descriptor)
    if not stat.S_ISDIR(metadata.st_mode):
        raise ConfigError("unsafe_hmac_key_parent")
    if metadata.st_uid not in {0, os.geteuid()}:
        raise ConfigError("hmac_key_parent_owner")
    mode = stat.S_IMODE(metadata.st_mode)
    trusted_sticky_system_parent = (
        not is_direct_parent
        and metadata.st_uid == 0
        and bool(mode & stat.S_ISVTX)
    )
    if mode & 0o022 and not trusted_sticky_system_parent:
        raise ConfigError("hmac_key_parent_permissions")


def _load_hmac_key(raw_path: str | None) -> tuple[Path, bytes]:
    if not raw_path:
        raise ConfigError("hmac_key_required")

    candidate = _normalize_trusted_system_prefix(
        Path(raw_path).expanduser().absolute()
    )
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory = getattr(os, "O_DIRECTORY", 0)
    if nofollow == 0 or directory == 0:
        raise ConfigError("unsafe_hmac_key_file")
    close_on_exec = getattr(os, "O_CLOEXEC", 0)
    directory_flags = os.O_RDONLY | directory | nofollow | close_on_exec
    file_flags = os.O_RDONLY | nofollow | close_on_exec

    try:
        parent_descriptor = os.open(candidate.anchor, directory_flags)
    except OSError:
        raise ConfigError("hmac_key_unavailable")

    try:
        parent_segments = candidate.parts[1:-1]
        _validate_hmac_key_parent_descriptor(
            parent_descriptor,
            is_direct_parent=not parent_segments,
        )
        for index, segment in enumerate(parent_segments):
            try:
                next_descriptor = os.open(
                    segment,
                    directory_flags,
                    dir_fd=parent_descriptor,
                )
            except OSError as error:
                if error.errno in {errno.ELOOP, errno.ENOTDIR}:
                    raise ConfigError("unsafe_hmac_key_parent") from error
                raise ConfigError("hmac_key_unavailable") from error
            try:
                is_direct_parent = index == len(parent_segments) - 1
                _validate_hmac_key_parent_descriptor(
                    next_descriptor,
                    is_direct_parent=is_direct_parent,
                )
            except BaseException:
                os.close(next_descriptor)
                raise
            os.close(parent_descriptor)
            parent_descriptor = next_descriptor

        try:
            descriptor = os.open(
                candidate.name,
                file_flags,
                dir_fd=parent_descriptor,
            )
        except OSError as error:
            if error.errno == errno.ELOOP:
                raise ConfigError("unsafe_hmac_key_file") from error
            raise ConfigError("hmac_key_unavailable") from error
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise ConfigError("hmac_key_unavailable")
            if metadata.st_uid != os.geteuid():
                raise ConfigError("hmac_key_owner")
            if stat.S_IMODE(metadata.st_mode) & 0o077:
                raise ConfigError("hmac_key_permissions")
            try:
                raw_key = os.read(descriptor, MAXIMUM_HMAC_KEY_BYTES + 2)
            except OSError as error:
                raise ConfigError("hmac_key_unavailable") from error
        finally:
            os.close(descriptor)
    finally:
        os.close(parent_descriptor)

    if len(raw_key) > MAXIMUM_HMAC_KEY_BYTES + 1:
        raise ConfigError("hmac_key_length")
    key = raw_key
    if key.endswith(b"\n"):
        key = key[:-1]
        if key.endswith((b"\r", b"\n")):
            raise ConfigError("hmac_key_length")
    elif key.endswith(b"\r"):
        raise ConfigError("hmac_key_length")
    if not MINIMUM_HMAC_KEY_BYTES <= len(key) <= MAXIMUM_HMAC_KEY_BYTES:
        raise ConfigError("hmac_key_length")
    return candidate, key


def _normalize_trusted_system_prefix(candidate: Path) -> Path:
    """Canonicalize only immutable macOS root-owned compatibility symlinks."""

    if len(candidate.parts) < 2:
        return candidate
    prefix = Path(candidate.anchor) / candidate.parts[1]
    expected_targets = {
        Path("/tmp"): Path("/private/tmp"),
        Path("/var"): Path("/private/var"),
    }
    expected_target = expected_targets.get(prefix)
    if expected_target is None:
        return candidate
    try:
        metadata = prefix.lstat()
        if (
            not stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != 0
            or prefix.resolve(strict=True) != expected_target
        ):
            return candidate
    except OSError:
        return candidate
    return expected_target.joinpath(*candidate.parts[2:])


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
    port = _parse_integer(port_value, code="invalid_port")
    if not 1 <= port <= 65535:
        raise ConfigError("invalid_port")

    protocol_version = str(values.get("protocol_version") or "1")
    if (
        not PROTOCOL_VERSION_PATTERN.fullmatch(protocol_version)
        or protocol_version.split(".", maxsplit=1)[0] != "1"
    ):
        raise ConfigError("invalid_protocol_version")

    worker_id_value = values.get("worker_id")
    if worker_id_value is None or str(worker_id_value) == "":
        raise ConfigError("worker_id_required")
    worker_id = str(worker_id_value)
    if not WORKER_ID_PATTERN.fullmatch(worker_id):
        raise ConfigError("invalid_worker_id")

    window_value = values.get("hmac_window_seconds", 300)
    hmac_window_seconds = _parse_integer(
        window_value,
        code="invalid_hmac_window",
    )
    if not 1 <= hmac_window_seconds <= 300:
        raise ConfigError("invalid_hmac_window")

    staging_dir, staging_identity = _validate_staging_dir(
        str(values["staging_dir"]) if values.get("staging_dir") else None
    )
    run_dir, run_identity = _validate_run_dir(
        str(values["run_dir"]) if values.get("run_dir") else None
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
        vae_chunk = _parse_integer(
            vae_chunk_value,
            code="invalid_vae_chunk",
        )
        if vae_chunk <= 0:
            raise ConfigError("invalid_vae_chunk")

    batch_value = values.get("batch_ceiling", 1)
    batch_ceiling = _parse_integer(
        batch_value,
        code="invalid_batch_ceiling",
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
        run_dir=run_dir,
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
        _staging_identity=staging_identity,
        _run_identity=run_identity,
    )


def revalidate_server_config(config: ServerConfig) -> ServerConfig:
    """Rebuild a runtime config through the public validation boundary.

    `ServerConfig` remains a useful immutable value object, but constructing it directly is not a
    validation capability. The server factory calls this function and uses only the freshly
    validated result and directory identities.
    """

    if not isinstance(config, ServerConfig):
        raise ConfigError("invalid_server_config")
    normalized = load_config(
        {
            "bind": config.bind,
            "port": config.port,
            "protocol_version": config.protocol_version,
            "worker_id": config.worker_id,
            "staging_dir": str(config.staging_dir),
            "run_dir": str(config.run_dir),
            "hmac_key_file": str(config.hmac_key_file),
            "hmac_window_seconds": config.hmac_window_seconds,
            "allow_non_loopback": config.allow_non_loopback,
            "device": config.device,
            "lm_backend": config.lm_backend,
            "model_id": config.model_id,
            "model_revision": config.model_revision,
            "vae_chunk": config.vae_chunk,
            "batch_ceiling": config.batch_ceiling,
            "acestep_url": config.acestep_url,
        }
    )
    if not isinstance(config.hmac_key, bytes) or not hmac.compare_digest(
        normalized.hmac_key,
        config.hmac_key,
    ):
        raise ConfigError("invalid_hmac_key")
    if normalized != config:
        raise ConfigError("invalid_server_config")
    if (
        config._staging_identity is not None
        and normalized._staging_identity != config._staging_identity
    ):
        raise ConfigError("staging_identity_changed")
    if (
        config._run_identity is not None
        and normalized._run_identity != config._run_identity
    ):
        raise ConfigError("run_identity_changed")
    return normalized
