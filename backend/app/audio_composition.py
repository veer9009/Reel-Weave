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
    return build_segmented_music_graph(
        segments, output_fps, total_frames, {s.source_id: input_index for s in segments}
    )


def build_segmented_music_graph(
    segments: tuple[MusicSegment, ...],
    output_fps: int,
    total_frames: int,
    input_indexes: dict[str, int],
) -> AudioGraph:
    k = 48000 // output_fps
    total = total_frames * k
    active = [v for v in segments if v.timeline_start_frame < total_frames]
    filters = [
        f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample={total},asetpts=PTS-STARTPTS[bed]"
    ]
    groups: dict[str, list[int]] = {}
    for i, segment in enumerate(active):
        groups.setdefault(segment.source_id, []).append(i)
    for source_id, indexes in groups.items():
        filters.append(
            f"[{input_indexes[source_id]}:a:0]asplit={len(indexes)}"
            + "".join(f"[source{i}]" for i in indexes)
        )
    labels = ["[bed]"]
    for i, v in enumerate(active):
        length = min(v.duration_frames, total_frames - v.timeline_start_frame) * k
        filters.append(
            f"[source{i}]atrim=start_sample={v.source_start_sample}:"
            f"end_sample={v.source_start_sample + length},asetpts=PTS-STARTPTS,"
            f"apad=whole_len={length},atrim=end_sample={length},"
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


def build_original_graph(
    audio_slices, input_indexes, output_fps: int, total_frames: int
) -> AudioGraph:
    """Place the selected original bus once; silent intervals never reveal a lower owner."""
    k = 48000 // output_fps
    total = total_frames * k
    filters = [
        f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample={total},asetpts=PTS-STARTPTS[originalbed]"
    ]
    active = [v for v in audio_slices if v.source is not None]
    grouped = {}
    for i, v in enumerate(active):
        grouped.setdefault(v.source, []).append(i)
    for recipe, indexes in grouped.items():
        filters.append(
            f"[{input_indexes[recipe]}:a:0]asplit={len(indexes)}"
            + "".join(f"[origsource{i}]" for i in indexes)
        )
    labels = ["[originalbed]"]
    for i, v in enumerate(active):
        length = (v.end_frame_exclusive - v.start_frame) * k
        filters.append(
            f"[origsource{i}]atrim=start_sample={v.source_start_sample}:"
            f"end_sample={v.source_start_sample + length},"
            f"asetpts=PTS-STARTPTS,apad=whole_len={length},atrim=end_sample={length},"
            f"adelay=delays={v.start_frame * k}S:all=1[originalslice{i}]"
        )
        labels.append(f"[originalslice{i}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=first:dropout_transition=0:normalize=0,"
        f"atrim=end_sample={total},asetpts=PTS-STARTPTS[outoriginal]"
    )
    return AudioGraph(";".join(filters), "[outoriginal]")
