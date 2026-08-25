from __future__ import annotations

import json
from typing import Final


DRAIN_REASON_CODES: Final[frozenset[str]] = frozenset(
    {
        "interactive_use",
        "low_disk",
        "maintenance",
        "operator_request",
        "power_state",
        "thermal_pressure",
    }
)


class PayloadError(ValueError):
    pass


def validate_drain_request(body: bytes) -> str:
    """Validate the strict v1 drain payload and return its reason code."""

    try:
        decoded = body.decode("utf-8")
        payload = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PayloadError("invalid_json") from error
    if not isinstance(payload, dict):
        raise PayloadError("invalid_shape")
    if set(payload) - {"reason"}:
        raise PayloadError("unknown_field")
    reason = payload.get("reason", "operator_request")
    if not isinstance(reason, str) or reason not in DRAIN_REASON_CODES:
        raise PayloadError("invalid_reason")
    return reason
