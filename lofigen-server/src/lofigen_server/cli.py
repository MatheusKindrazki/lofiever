from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Mapping, Sequence

from .config import ConfigError, ServerConfig, load_config


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise ConfigError("invalid_arguments")


def _environment_default(
    environment: Mapping[str, str],
    name: str,
    fallback: str | None = None,
) -> str | None:
    value = environment.get(name)
    return fallback if value is None else value


def build_parser(environment: Mapping[str, str]) -> argparse.ArgumentParser:
    parser = SafeArgumentParser(description="Lofiever local music worker")
    parser.add_argument("--bind", default=_environment_default(environment, "LOFIGEN_BIND", "127.0.0.1"))
    parser.add_argument("--port", default=_environment_default(environment, "LOFIGEN_PORT", "8787"))
    parser.add_argument(
        "--protocol-version",
        default=_environment_default(environment, "LOFIGEN_PROTOCOL_VERSION", "1"),
    )
    parser.add_argument(
        "--worker-id",
        default=_environment_default(environment, "LOFIGEN_WORKER_ID", "local-worker"),
    )
    parser.add_argument(
        "--staging-dir",
        default=_environment_default(environment, "LOFIGEN_STAGING_DIR"),
    )
    parser.add_argument(
        "--run-dir",
        default=_environment_default(environment, "LOFIGEN_RUN_DIR"),
    )
    parser.add_argument(
        "--hmac-key-file",
        default=_environment_default(environment, "LOFIGEN_HMAC_KEY_FILE"),
    )
    parser.add_argument(
        "--hmac-window-seconds",
        default=_environment_default(environment, "LOFIGEN_HMAC_WINDOW_SECONDS", "300"),
    )
    parser.add_argument(
        "--allow-non-loopback",
        action="store_true",
        default=_environment_default(
            environment,
            "LOFIGEN_ALLOW_NON_LOOPBACK",
            "false",
        ),
    )
    parser.add_argument(
        "--device",
        default=_environment_default(environment, "LOFIGEN_DEVICE", "mps"),
    )
    parser.add_argument(
        "--lm-backend",
        default=_environment_default(environment, "LOFIGEN_LM_BACKEND", "mlx"),
    )
    parser.add_argument(
        "--model-id",
        default=_environment_default(environment, "LOFIGEN_MODEL_ID"),
    )
    parser.add_argument(
        "--model-revision",
        default=_environment_default(environment, "LOFIGEN_MODEL_REVISION"),
    )
    parser.add_argument(
        "--vae-chunk",
        default=_environment_default(
            environment,
            "LOFIGEN_VAE_CHUNK",
            _environment_default(environment, "ACESTEP_MLX_VAE_CHUNK"),
        ),
    )
    parser.add_argument(
        "--batch-ceiling",
        default=_environment_default(environment, "LOFIGEN_MAX_BATCH", "1"),
    )
    parser.add_argument(
        "--acestep-url",
        default=_environment_default(
            environment,
            "LOFIGEN_ACESTEP_URL",
            "http://127.0.0.1:8001",
        ),
    )
    parser.add_argument("--check-config", action="store_true")
    return parser


def parse_config(
    arguments: Sequence[str] | None = None,
    *,
    environment: Mapping[str, str] | None = None,
) -> tuple[ServerConfig, bool]:
    effective_environment = os.environ if environment is None else environment
    parser = build_parser(effective_environment)
    parsed = parser.parse_args(arguments)
    return load_config(vars(parsed)), bool(parsed.check_config)


def _write_json(stream: object, payload: dict[str, object]) -> None:
    serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    stream.write(serialized + "\n")  # type: ignore[attr-defined]


def main(arguments: Sequence[str] | None = None) -> int:
    try:
        config, check_only = parse_config(arguments)
    except ConfigError as error:
        _write_json(
            sys.stderr,
            {"error": {"code": error.code}, "status": "error"},
        )
        return 2

    if check_only:
        _write_json(
            sys.stdout,
            {
                "bind": config.bind,
                "port": config.port,
                "protocolVersion": config.protocol_version,
                "status": "ok",
                "workerId": config.worker_id,
            },
        )
        return 0

    from .server import create_server

    try:
        server = create_server(config)
    except Exception:
        _write_json(
            sys.stderr,
            {"error": {"code": "runtime_start_failed"}, "status": "error"},
        )
        return 1

    exit_code = 0
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        _write_json(
            sys.stderr,
            {"error": {"code": "runtime_failed"}, "status": "error"},
        )
        exit_code = 1

    try:
        server.server_close()
    except Exception:
        if exit_code == 0:
            _write_json(
                sys.stderr,
                {
                    "error": {"code": "runtime_shutdown_failed"},
                    "status": "error",
                },
            )
            exit_code = 1
    return exit_code
