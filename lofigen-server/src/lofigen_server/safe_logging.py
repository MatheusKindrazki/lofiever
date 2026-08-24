from __future__ import annotations

import json
from pathlib import Path
import sys
from threading import Lock
from typing import TextIO


ALLOWED_FIELDS = {
    "elapsedMs",
    "event",
    "method",
    "requestId",
    "route",
    "status",
}


class SafeJsonLogger:
    """Structured logger that accepts only a fixed, non-sensitive field set."""

    def __init__(self, stream: TextIO | None = None) -> None:
        self._stream = stream or sys.stdout
        self._home = str(Path.home())
        self._lock = Lock()

    def emit(self, event: str, **fields: object) -> None:
        payload: dict[str, object] = {"event": event}
        for key, value in fields.items():
            if key not in ALLOWED_FIELDS:
                continue
            if isinstance(value, str):
                value = value.replace(self._home, "<home>")
            payload[key] = value
        serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        with self._lock:
            self._stream.write(serialized + "\n")
            self._stream.flush()
