from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True)
class RuntimeSnapshot:
    draining: bool
    jobs_in_flight: int


class DrainController:
    def __init__(self) -> None:
        self._draining = False
        self._jobs_in_flight = 0
        self._lock = Lock()

    def snapshot(self) -> RuntimeSnapshot:
        with self._lock:
            return RuntimeSnapshot(
                draining=self._draining,
                jobs_in_flight=self._jobs_in_flight,
            )
