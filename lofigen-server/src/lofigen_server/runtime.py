from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Iterator


class DrainingError(RuntimeError):
    pass


@dataclass(frozen=True)
class RuntimeSnapshot:
    draining: bool
    jobs_in_flight: int


class DrainController:
    def __init__(self) -> None:
        self._draining = False
        self._jobs_in_flight: set[str] = set()
        self._lock = Lock()

    def snapshot(self) -> RuntimeSnapshot:
        with self._lock:
            return RuntimeSnapshot(
                draining=self._draining,
                jobs_in_flight=len(self._jobs_in_flight),
            )

    @contextmanager
    def begin_job(self, job_id: str) -> Iterator[None]:
        """Admit one job atomically unless a drain already started."""

        with self._lock:
            if self._draining:
                raise DrainingError("worker is draining")
            if job_id in self._jobs_in_flight:
                raise RuntimeError("job is already in flight")
            self._jobs_in_flight.add(job_id)
        try:
            yield
        finally:
            with self._lock:
                self._jobs_in_flight.discard(job_id)

    def request_drain(self) -> RuntimeSnapshot:
        """Stop new admissions without interrupting already admitted jobs."""

        with self._lock:
            self._draining = True
            return RuntimeSnapshot(
                draining=True,
                jobs_in_flight=len(self._jobs_in_flight),
            )
