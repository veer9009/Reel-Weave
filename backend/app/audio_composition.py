"""Sample-exact placement and additive mix of explicit audio segments."""

from __future__ import annotations

from dataclasses import dataclass

from .jobs import AudioMixSettings, MusicSegment


@dataclass(frozen=True, slots=True)
class AudioGraph:
    filter_complex: str
    output_label: str


def build_music_graph(
    segments: tuple[MusicSegment, ...], output_fps: int, total_frames: int, input_index: int
) -> AudioGraph:
    k = 48000 // output_fps
    total = total_frames * k
    active = [v for v in segments if v.timeline_start_frame < total_frames]
    filters = [
        f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample={total},asetpts=PTS-STARTPTS[bed]"
    ]
    if active:
        filters.append(
            f"[{input_index}:a:0]asplit={len(active)}"
            + "".join(f"[source{i}]" for i in range(len(active)))
        )
    labels = ["[bed]"]
    for i, v in enumerate(active):
        length = min(v.duration_frames, total_frames - v.timeline_start_frame) * k
        filters.append(
            f"[source{i}]atrim=start_sample={v.source_start_sample}:"
            f"end_sample={v.source_start_sample + length},asetpts=PTS-STARTPTS,"
            f"apad,atrim=end_sample={length},"
            f"adelay=delays={v.timeline_start_frame * k}S:all=1[music{i}]"
        )
        labels.append(f"[music{i}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        f"atrim=end_sample={total},asetpts=PTS-STARTPTS[outmusic]"
    )
    return AudioGraph(";".join(filters), "[outmusic]")


def build_final_mix_graph(
    original_index: int, music_index: int | None, mix: AudioMixSettings, total_samples: int
) -> AudioGraph:
    original = 0 if mix.original_muted else mix.original_volume
    music = 0 if mix.music_muted else mix.music_volume
    filters = [f"[{original_index}:a:0]volume={original:g}[original]"]
    if music_index is not None:
        filters.append(f"[{music_index}:a:0]volume={music:g}[music]")
        filters.append(
            "[original][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0"
            + f",atrim=end_sample={total_samples},asetpts=PTS-STARTPTS[mixed]"
        )
    else:
        filters.append(f"[original]atrim=end_sample={total_samples},asetpts=PTS-STARTPTS[mixed]")
    return AudioGraph(";".join(filters), "[mixed]")
