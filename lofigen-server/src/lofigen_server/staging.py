from __future__ import annotations

import os
from pathlib import Path
import re
import stat
from typing import BinaryIO


SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class StagingPathError(ValueError):
    pass


class StagingRoot:
    """Hold a staging dirfd and perform symlink-safe artifact I/O beneath it."""

    def __init__(self, root: Path) -> None:
        candidate = root.absolute()
        try:
            path_metadata = candidate.lstat()
        except OSError as error:
            raise StagingPathError("staging root is unavailable") from error
        if stat.S_ISLNK(path_metadata.st_mode):
            raise StagingPathError("staging root must not be a symlink")

        nofollow = getattr(os, "O_NOFOLLOW", 0)
        directory = getattr(os, "O_DIRECTORY", 0)
        if nofollow == 0 or directory == 0:
            raise StagingPathError("secure staging I/O is unavailable")
        self._directory_flags = (
            os.O_RDONLY
            | nofollow
            | directory
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            root_fd = os.open(candidate, self._directory_flags)
        except OSError as error:
            raise StagingPathError("staging root is unavailable") from error
        try:
            metadata = os.fstat(root_fd)
            if not stat.S_ISDIR(metadata.st_mode):
                raise StagingPathError("staging root is not a directory")
            resolved_root = candidate.resolve(strict=True)
        except BaseException:
            os.close(root_fd)
            raise

        self._root = resolved_root
        self._root_fd = root_fd

    @property
    def root(self) -> Path:
        """Return the configured path for metrics only, never for artifact I/O."""

        return self._root

    def close(self) -> None:
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def free_bytes(self) -> int:
        """Measure available bytes on the volume backing the held root directory fd."""

        if self._root_fd < 0:
            raise StagingPathError("staging root is closed")
        try:
            volume = os.fstatvfs(self._root_fd)
        except OSError as error:
            raise StagingPathError("staging volume is unavailable") from error
        return volume.f_bavail * volume.f_frsize

    def _parts(self, relative_path: str) -> tuple[str, ...]:
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
        return tuple(path.parts)

    def resolve(self, relative_path: str) -> Path:
        """Return a preview path; callers must use open_for_read/open_for_write for I/O."""

        parts = self._parts(relative_path)
        candidate = (self._root / Path(*parts)).resolve(strict=False)
        try:
            candidate.relative_to(self._root)
        except ValueError as error:
            raise StagingPathError("staging path escaped root") from error
        return candidate

    def _walk_directories(
        self,
        parts: tuple[str, ...],
        *,
        create: bool,
    ) -> int:
        if self._root_fd < 0:
            raise StagingPathError("staging root is closed")
        try:
            current_fd = os.dup(self._root_fd)
        except OSError as error:
            raise StagingPathError("staging root is unavailable") from error

        try:
            for segment in parts:
                if create:
                    try:
                        os.mkdir(segment, mode=0o700, dir_fd=current_fd)
                    except FileExistsError:
                        pass
                next_fd = os.open(
                    segment,
                    self._directory_flags,
                    dir_fd=current_fd,
                )
                try:
                    metadata = os.fstat(next_fd)
                except BaseException:
                    os.close(next_fd)
                    raise
                if not stat.S_ISDIR(metadata.st_mode):
                    os.close(next_fd)
                    raise StagingPathError("unsafe staging directory")
                os.close(current_fd)
                current_fd = next_fd
            return current_fd
        except StagingPathError:
            os.close(current_fd)
            raise
        except OSError as error:
            os.close(current_fd)
            raise StagingPathError("secure staging path is unavailable") from error
        except BaseException:
            os.close(current_fd)
            raise

    def open_for_write(
        self,
        relative_path: str,
        *,
        create_parents: bool = False,
    ) -> BinaryIO:
        """Exclusively create one regular file without following any path symlink."""

        parts = self._parts(relative_path)
        parent_fd = self._walk_directories(parts[:-1], create=create_parents)
        flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | os.O_NOFOLLOW
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            descriptor = os.open(parts[-1], flags, 0o600, dir_fd=parent_fd)
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                os.close(descriptor)
                raise StagingPathError("unsafe staging artifact")
        except StagingPathError:
            raise
        except OSError as error:
            raise StagingPathError("secure staging artifact is unavailable") from error
        finally:
            os.close(parent_fd)
        return os.fdopen(descriptor, "wb")

    def open_for_read(self, relative_path: str) -> BinaryIO:
        """Open one existing regular file without following any path symlink."""

        parts = self._parts(relative_path)
        parent_fd = self._walk_directories(parts[:-1], create=False)
        flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(parts[-1], flags, dir_fd=parent_fd)
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                os.close(descriptor)
                raise StagingPathError("unsafe staging artifact")
        except StagingPathError:
            raise
        except OSError as error:
            raise StagingPathError("secure staging artifact is unavailable") from error
        finally:
            os.close(parent_fd)
        return os.fdopen(descriptor, "rb")
