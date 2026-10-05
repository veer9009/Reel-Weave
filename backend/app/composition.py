from __future__ import annotations

from dataclasses import dataclass

from .jobs import OverlaySettings

_BOXES = {"small": (256, 144), "medium": (384, 216), "large": (512, 288)}
_POSITIONS = {
    "top-left": ("24", "24"),
    "top-right": ("W-w-24", "24"),
    "bottom-left": ("24", "H-h-24"),
    "bottom-right": ("W-w-24", "H-h-24"),
    "centre": ("(W-w)/2", "(H-h)/2"),
}


@dataclass(frozen=True, slots=True)
class OverlayGraph:
    filter_complex: str
    output_label: str


def _prepared_filter(
    input_index: int,
    settings: OverlaySettings,
    output_fps: int,
    label: str,
    *,
    alpha: bool,
) -> str:
    width, height = _BOXES[settings.size]
    duration = (settings.end_frame - settings.start_frame + 1) / output_fps
    prefix = f"[{input_index}:v]fps={output_fps},"
    if alpha:
        prefix += "format=rgba,"
    return (
        f"{prefix}scale={width}:{height}:force_original_aspect_ratio=decrease:"
        f"force_divisible_by=2,trim=duration={duration:.6f},"
        f"setpts=PTS-STARTPTS+{settings.start_frame}/({output_fps}*TB)[{label}]"
    )


def _overlay_filter(
    base_label: str,
    overlay_label: str,
    output_label: str,
    settings: OverlaySettings,
) -> str:
    x, y = _POSITIONS[settings.position]
    return (
        f"[{base_label}][{overlay_label}]overlay=x={x}:y={y}:"
        f"enable='between(n\\,{settings.start_frame}\\,{settings.end_frame})':"
        f"eof_action=pass:repeatlast=0:shortest=0[{output_label}]"
    )


def build_overlay_graph(
    output_fps: int,
    total_project_frames: int,
    video: tuple[int, OverlaySettings] | None,
    image: tuple[int, OverlaySettings] | None,
) -> OverlayGraph:
    if total_project_frames <= 0:
        raise ValueError("total_project_frames must be positive")
    filters = ["[0:v]setpts=PTS-STARTPTS[base0]"]
    base_label = "base0"
    layer = 0
    if video is not None:
        index, settings = video
        filters.append(_prepared_filter(index, settings, output_fps, "pip", alpha=False))
        layer += 1
        filters.append(_overlay_filter(base_label, "pip", f"layer{layer}", settings))
        base_label = f"layer{layer}"
    if image is not None:
        index, settings = image
        filters.append(_prepared_filter(index, settings, output_fps, "image", alpha=True))
        layer += 1
        filters.append(_overlay_filter(base_label, "image", f"layer{layer}", settings))
        base_label = f"layer{layer}"
    filters.append(f"[{base_label}]fps={output_fps},format=yuv420p,setsar=1[outv]")
    return OverlayGraph(";".join(filters), "[outv]")
