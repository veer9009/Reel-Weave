from __future__ import annotations

import math


def round_half_up(value: float) -> int:
    if not math.isfinite(value) or value < 0:
        raise ValueError("value must be a finite non-negative number")
    return math.floor(value + 0.5)


def project_frame_count(
    selected_source_frames: int,
    source_fps: float,
    speed: float,
    output_fps: int,
) -> int:
    if selected_source_frames <= 0:
        raise ValueError("selected_source_frames must be positive")
    if not math.isfinite(source_fps) or source_fps <= 0:
        raise ValueError("source_fps must be positive")
    if not math.isfinite(speed) or speed <= 0:
        raise ValueError("speed must be positive")
    if output_fps <= 0:
        raise ValueError("output_fps must be positive")
    duration = selected_source_frames / source_fps / speed
    return max(1, round_half_up(duration * output_fps))
