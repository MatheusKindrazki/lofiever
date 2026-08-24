from __future__ import annotations

from pathlib import Path
import re


SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class StagingPathError(ValueError):
    pass


class StagingRoot:
    """Resolve worker-owned relative paths without allowing staging escape."""

    def __init__(self, root: Path) -> None:
        if root.is_symlink():
            raise StagingPathError("staging root must not be a symlink")
        try:
            resolved_root = root.resolve(strict=True)
        except OSError as error:
            raise StagingPathError("staging root is unavailable") from error
        if not resolved_root.is_dir():
            raise StagingPathError("staging root is not a directory")
        self._root = resolved_root

    @property
    def root(self) -> Path:
        return self._root

    def resolve(self, relative_path: str) -> Path:
        if not relative_path or "\x00" in relative_path or "\\" in relative_path:
            raise StagingPathError("unsafe staging path")

        path = Path(relative_path)
        if path.is_absolute() or not path.parts:
            raise StagingPathError("unsafe staging path")
        if any(
            segment in {".", ".."} or not SAFE_SEGMENT.fullmatch(segment)
            for segment in path.parts
        ):
            raise StagingPathError("unsafe staging path")

        candidate = (self._root / path).resolve(strict=False)
        try:
            candidate.relative_to(self._root)
        except ValueError as error:
            raise StagingPathError("staging path escaped root") from error
        return candidate
