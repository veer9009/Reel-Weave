from __future__ import annotations

import os
import shutil
import stat
import time
import uuid
from collections.abc import Iterable
from pathlib import Path

from .config import Settings


class UnsafePathError(ValueError):
    pass


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        for root in self.roots:
            root.mkdir(parents=True, exist_ok=True)

    @property
    def roots(self) -> tuple[Path, Path, Path]:
        return (
            self.settings.upload_root,
            self.settings.intermediate_root,
            self.settings.output_root,
        )

    def job_paths(self, job_id: str) -> tuple[Path, Path, Path]:
        return tuple(root / job_id for root in self.roots)  # type: ignore[return-value]

    def prepare_job(self, job_id: str) -> tuple[Path, Path, Path]:
        paths = self.job_paths(job_id)
        for path in paths:
            path.mkdir(parents=True, exist_ok=False)
        return paths

    def save_uploads(self, job_id: str, uploads: Iterable[tuple[str, bytes]]) -> list[Path]:
        upload_dir, _, _ = self.job_paths(job_id)
        if not upload_dir.exists():
            self.prepare_job(job_id)
        result = []
        for index, (original_name, content) in enumerate(uploads):
            extension = Path(original_name).suffix.lower()
            destination = upload_dir / f"{index:03d}{extension}"
            destination.write_bytes(content)
            result.append(destination)
        return result

    def remove_job(self, job_id: str) -> None:
        for path in self.job_paths(job_id):
            if path.exists() or path.is_symlink():
                self.remove_path(path)

    def remove_path(self, path: Path) -> None:
        absolute = path.absolute()
        lexical_root = next((root for root in self.roots if absolute.parent == root), None)
        if lexical_root is None:
            raise UnsafePathError("cleanup target is outside a storage root")
        if path.is_symlink():
            try:
                path.resolve(strict=True).relative_to(self.settings.working_root)
            except (OSError, ValueError) as exc:
                raise UnsafePathError("cleanup target is a symlink escape") from exc
            raise UnsafePathError("cleanup refuses symbolic links")
        try:
            path.resolve(strict=False).relative_to(lexical_root)
        except ValueError as exc:
            raise UnsafePathError("cleanup target escapes its storage root") from exc
        if self._contains_reparse_point(path):
            raise UnsafePathError("cleanup refuses paths containing links or junctions")
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

    def cleanup_orphans(self, active_job_ids: set[str], now: float | None = None) -> None:
        cutoff = (time.time() if now is None else now) - self.settings.retention_seconds
        for root in self.roots:
            for candidate in root.iterdir():
                if candidate.name in active_job_ids:
                    continue
                try:
                    parsed = uuid.UUID(candidate.name)
                except ValueError:
                    continue
                if parsed.version != 4 or str(parsed) != candidate.name.lower():
                    continue
                try:
                    modified = candidate.lstat().st_mtime
                except OSError:
                    continue
                if modified < cutoff:
                    try:
                        self.remove_path(candidate)
                    except (OSError, UnsafePathError):
                        continue

    @staticmethod
    def _contains_reparse_point(path: Path) -> bool:
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)

        def is_reparse(candidate: Path) -> bool:
            try:
                attributes = getattr(candidate.lstat(), "st_file_attributes", 0)
            except OSError:
                return True
            return candidate.is_symlink() or bool(attributes & reparse_flag)

        if is_reparse(path):
            return True
        if not path.is_dir():
            return False
        for directory, directories, files in os.walk(path, followlinks=False):
            base = Path(directory)
            if any(is_reparse(base / name) for name in [*directories, *files]):
                return True
        return False
