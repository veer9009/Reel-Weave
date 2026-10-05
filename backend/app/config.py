from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return child != parent


@dataclass(frozen=True, slots=True)
class Settings:
    working_root: Path = Path("var/reelweave")
    upload_root: Path | None = None
    output_root: Path | None = None
    max_file_size_bytes: int = 200 * 1024 * 1024
    max_audio_file_size_bytes: int = 100 * 1024 * 1024
    max_overlay_image_file_size_bytes: int = 20 * 1024 * 1024
    max_overlay_video_file_size_bytes: int = 200 * 1024 * 1024
    max_clips: int = 20
    min_clips: int = 2
    queue_size: int = 4
    retention_seconds: int = 60 * 60
    cleanup_interval_seconds: int = 5 * 60
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    subprocess_timeout_seconds: int = 30 * 60

    def __post_init__(self) -> None:
        working = Path(self.working_root).expanduser().resolve()
        upload = Path(self.upload_root or working / "uploads").expanduser().resolve()
        output = Path(self.output_root or working / "outputs").expanduser().resolve()
        intermediate = working / "intermediate"
        for candidate in (upload, output):
            if not _inside(candidate, working):
                raise ValueError("storage roots must be descendants of the working root")
        roots = (upload, intermediate, output)
        for index, left in enumerate(roots):
            for right in roots[index + 1 :]:
                if left == right or _inside(left, right) or _inside(right, left):
                    raise ValueError("storage roots must not overlap")
        for name in (
            "max_file_size_bytes",
            "max_audio_file_size_bytes",
            "max_overlay_image_file_size_bytes",
            "max_overlay_video_file_size_bytes",
            "max_clips",
            "min_clips",
            "queue_size",
            "retention_seconds",
            "cleanup_interval_seconds",
            "subprocess_timeout_seconds",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.min_clips > self.max_clips:
            raise ValueError("min_clips cannot exceed max_clips")
        object.__setattr__(self, "working_root", working)
        object.__setattr__(self, "upload_root", upload)
        object.__setattr__(self, "output_root", output)

    @property
    def intermediate_root(self) -> Path:
        return self.working_root / "intermediate"

    @property
    def max_file_size_mb(self) -> float:
        return self.max_file_size_bytes / (1024 * 1024)

    @property
    def max_audio_file_size_mb(self) -> float:
        return self.max_audio_file_size_bytes / (1024 * 1024)

    @property
    def max_overlay_image_file_size_mb(self) -> float:
        return self.max_overlay_image_file_size_bytes / (1024 * 1024)

    @property
    def max_overlay_video_file_size_mb(self) -> float:
        return self.max_overlay_video_file_size_bytes / (1024 * 1024)

    @property
    def max_request_size_bytes(self) -> int:
        multipart_overhead = 1024 * 1024 + (self.max_clips + 3) * 64 * 1024
        return (
            self.max_file_size_bytes * self.max_clips
            + self.max_audio_file_size_bytes
            + self.max_overlay_image_file_size_bytes
            + self.max_overlay_video_file_size_bytes
            + multipart_overhead
        )

    @classmethod
    def from_env(cls, env_file: Path | str | None = Path("backend/.env")) -> Settings:
        if env_file is not None:
            load_dotenv(dotenv_path=env_file, override=False)
        working = Path(os.getenv("REELWEAVE_WORKING_ROOT", "var/reelweave"))
        upload_value = os.getenv("REELWEAVE_UPLOAD_ROOT")
        output_value = os.getenv("REELWEAVE_OUTPUT_ROOT")
        origins = tuple(
            value.strip()
            for value in os.getenv("REELWEAVE_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
            if value.strip()
        )
        return cls(
            working_root=working,
            upload_root=Path(upload_value) if upload_value else None,
            output_root=Path(output_value) if output_value else None,
            max_file_size_bytes=_env_int("REELWEAVE_MAX_FILE_SIZE_MB", 200) * 1024 * 1024,
            max_audio_file_size_bytes=_env_int("REELWEAVE_MAX_AUDIO_FILE_SIZE_MB", 100)
            * 1024
            * 1024,
            max_overlay_image_file_size_bytes=_env_int(
                "REELWEAVE_MAX_OVERLAY_IMAGE_FILE_SIZE_MB", 20
            )
            * 1024
            * 1024,
            max_overlay_video_file_size_bytes=_env_int(
                "REELWEAVE_MAX_OVERLAY_VIDEO_FILE_SIZE_MB", 200
            )
            * 1024
            * 1024,
            max_clips=_env_int("REELWEAVE_MAX_CLIPS", 20),
            queue_size=_env_int("REELWEAVE_QUEUE_SIZE", 4),
            retention_seconds=_env_int("REELWEAVE_RETENTION_SECONDS", 3600),
            cleanup_interval_seconds=_env_int("REELWEAVE_CLEANUP_INTERVAL_SECONDS", 300),
            allowed_origins=origins,
            ffmpeg_path=os.getenv("REELWEAVE_FFMPEG_PATH", "ffmpeg"),
            ffprobe_path=os.getenv("REELWEAVE_FFPROBE_PATH", "ffprobe"),
            subprocess_timeout_seconds=_env_int("REELWEAVE_SUBPROCESS_TIMEOUT_SECONDS", 1800),
        )
