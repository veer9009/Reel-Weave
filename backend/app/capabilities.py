"""Startup-only discovery of the installed delivery profiles."""

from __future__ import annotations

import subprocess
from typing import TYPE_CHECKING

from .config import Settings
from .errors import ApiError

if TYPE_CHECKING:
    from .jobs import ExportFormat


def _names(listing: str) -> set[str]:
    return {
        name
        for line in listing.splitlines()
        if len(parts := line.split()) >= 2 and not parts[0].startswith("-")
        for name in parts[1].split(",")
    }


def probe_export_capabilities(settings: Settings) -> dict[ExportFormat, bool]:
    """Inspect local FFmpeg; a failed query never advertises a profile."""
    listings = []
    for option in ("-encoders", "-muxers"):
        try:
            result = subprocess.run(
                [settings.ffmpeg_path, "-nostdin", "-hide_banner", option],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=True,
                timeout=min(settings.subprocess_timeout_seconds, 30),
            )
        except OSError as exc:
            raise ApiError(503, "media_tools_unavailable", "Media tools are unavailable.") from exc
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            listings.append(set())
        else:
            listings.append(_names(result.stdout))
    encoders, muxers = listings
    primary = {"libx264", "aac"} <= encoders and "mp4" in muxers
    return {
        "mp4": primary,
        "mov": primary and "mov" in muxers,
        "wav": "pcm_s16le" in encoders and "wav" in muxers,
        "mp3": "libmp3lame" in encoders and "mp3" in muxers,
    }


def require_export_capabilities(
    formats: tuple[ExportFormat, ...], capabilities: dict[ExportFormat, bool]
) -> None:
    for format_ in formats:
        if not capabilities.get(format_, False):
            raise ApiError(
                422,
                "unsupported_format",
                f"{format_.upper()} export is unavailable on this server.",
            )
