"""Strict version-2 contract. Legacy parsing remains in main."""

from __future__ import annotations

import json

from .errors import ApiError
from .jobs import (
    AdvancedMergePlan,
    ClipEdit,
    MusicPlan,
    MusicSegment,
    ReplacementOccurrence,
    VideoOccurrence,
    VideoSourceDescriptor,
)


def _invalid(message: str):
    raise ApiError(422, "invalid_manifest", message)


def _object(value: object, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        _invalid(f"{label} fields are invalid.")
    return value


def _id(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        _invalid("Each source and occurrence needs a nonempty ID.")
    return value


def _int(value: object, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        _invalid("Timeline, source and sample ranges require nonnegative whole numbers.")
    return value


def parse_advanced_manifest(value: dict, file_count: int, max_clips: int) -> AdvancedMergePlan:
    from .main import _parse_manifest

    _object(
        value,
        {
            "schema_version",
            "output_fps",
            "video_sources",
            "order",
            "clips",
            "video2",
            "music",
            "overlays",
            "audio",
        },
        "Manifest",
    )
    for key in ("video_sources", "order", "clips", "video2"):
        if not isinstance(value[key], list):
            _invalid(f"{key} must be an array.")
    if not value["clips"] or len(value["clips"]) + len(value["video2"]) > max_clips:
        _invalid("Video 1 is required and total video occurrences must fit the clip limit.")
    if len(value["video_sources"]) != file_count or not 1 <= file_count <= max_clips:
        _invalid("Source catalog must match uploads and clip limits.")
    sources = tuple(
        VideoSourceDescriptor(_id(_object(v, {"source_id"}, "Video source")["source_id"]))
        for v in value["video_sources"]
    )
    catalog = {v.source_id for v in sources}
    if len(catalog) != len(sources):
        _invalid("Video source IDs must be unique.")
    ids: set[str] = set()
    references: set[str] = set()
    common = {"client_id", "source_id", "start_frame", "end_frame", "speed", "trim_saved"}

    def occurrence(v: object, replacement: bool):
        extra = (
            {"timeline_start_frame", "content_in_frame", "content_out_frame", "content_full_source"}
            if replacement
            else set()
        )
        v = _object(v, common | extra, "Video occurrence")
        client_id, source_id = _id(v["client_id"]), _id(v["source_id"])
        if client_id in ids:
            _invalid("Occurrence IDs must be unique.")
        ids.add(client_id)
        references.add(source_id)
        if source_id not in catalog:
            _invalid("Missing or incompatible video source.")
        start, end = _int(v["start_frame"]), _int(v["end_frame"])
        speed = v["speed"]
        if (
            end < start
            or type(speed) not in (int, float)
            or speed not in (1, 0.75, 0.5)
            or type(v["trim_saved"]) is not bool
        ):
            _invalid("Invalid video source trim or speed.")
        edit = ClipEdit(start, end, float(speed), v["trim_saved"])
        if not replacement:
            return VideoOccurrence(client_id, source_id, edit)
        a, b = _int(v["content_in_frame"]), _int(v["content_out_frame"])
        if b <= a or type(v["content_full_source"]) is not bool:
            _invalid("Invalid normalized replacement window.")
        return ReplacementOccurrence(
            client_id,
            source_id,
            edit,
            _int(v["timeline_start_frame"]),
            a,
            b,
            v["content_full_source"],
        )

    clips = tuple(occurrence(v, False) for v in value["clips"])
    replacements = tuple(
        sorted(
            (occurrence(v, True) for v in value["video2"]),
            key=lambda v: (v.timeline_start_frame, v.client_id),
        )
    )
    if references != catalog:
        _invalid("Catalog contains unreferenced video sources.")
    order = value["order"]
    if (
        any(not isinstance(v, str) for v in order)
        or len(order) != len(clips)
        or set(order) != {v.client_id for v in clips}
    ):
        _invalid("Order must contain every Video 1 occurrence exactly once.")
    _object(
        value["audio"],
        {"original_volume", "original_muted", "music_volume", "music_muted"},
        "Audio",
    )
    _object(value["overlays"], {"image", "video"}, "Overlays")
    legacy = {
        "clips": [
            {
                "client_id": v.client_id,
                "start_frame": v.edit.start_frame,
                "end_frame": v.edit.end_frame,
                "speed": v.edit.speed,
                "trim_saved": v.edit.trim_saved,
            }
            for v in clips
        ],
        "order": order,
        "output_fps": value["output_fps"],
        "audio": value["audio"],
        "overlays": value["overlays"],
    }
    settings = _parse_manifest(json.dumps(legacy), len(clips), max_clips)
    music = None
    if value["music"] is not None:
        m = _object(value["music"], {"source_id", "segments"}, "Music")
        source_id = _id(m["source_id"])
        if (
            source_id in catalog
            or not isinstance(m["segments"], list)
            or not 1 <= len(m["segments"]) <= 10 * max_clips
        ):
            _invalid("Music source or segment count is invalid.")
        segments = []
        for v in m["segments"]:
            v = _object(
                v,
                {
                    "client_id",
                    "source_id",
                    "timeline_start_frame",
                    "source_start_sample",
                    "duration_frames",
                },
                "Music segment",
            )
            client_id = _id(v["client_id"])
            if client_id in ids or _id(v["source_id"]) != source_id:
                _invalid("Music occurrence identity or source is invalid.")
            ids.add(client_id)
            segments.append(
                MusicSegment(
                    client_id,
                    source_id,
                    _int(v["timeline_start_frame"]),
                    _int(v["source_start_sample"]),
                    _int(v["duration_frames"], 1),
                )
            )
        music = MusicPlan(
            source_id, tuple(sorted(segments, key=lambda v: (v.timeline_start_frame, v.client_id)))
        )
    return AdvancedMergePlan(
        sources,
        clips,
        tuple(order),
        replacements,
        settings.output_fps,
        settings.audio_mix,
        music,
        settings.image_overlay,
        settings.video_overlay,
    )


def parse_v3_manifest(value: dict, video_file_count: int, max_clips: int):
    """Parse the explicit V3 contract without legacy correction or defaults."""
    from .jobs import (
        AudioFileRecipe,
        AudioSourceDescriptor,
        DetachedProvenance,
        IndependentAudioSegment,
        V3MergePlan,
        V3ReplacementOccurrence,
        VideoEditRecipe,
        WindowedVideoOccurrence,
    )
    from .main import _parse_manifest

    keys = {
        "schema_version",
        "output_fps",
        "video_sources",
        "audio_sources",
        "order",
        "clips",
        "video2",
        "music",
        "overlays",
        "audio",
        "independent_audio",
    }
    _object(value, keys | ({"exports"} if "exports" in value else set()), "Manifest")

    def ident(v):
        result = _id(v)
        try:
            valid = len(result.encode("utf-8")) <= 128
        except UnicodeEncodeError:
            valid = False
        if not valid:
            _invalid("Identifiers must fit 128 UTF-8 bytes.")
        return result

    def integer(v, minimum=0):
        n = _int(v, minimum)
        if n > 9007199254740991:
            _invalid("Timeline and sample values exceed the supported integer range.")
        return n

    def fps(v):
        if type(v) is not int or v not in (24, 25, 30, 50, 60):
            _invalid("FPS must be 24, 25, 30, 50, or 60.")
        return v

    def speed(v):
        if type(v) not in (int, float) or v not in (1, 0.75, 0.5):
            _invalid("Speed must be 1, 0.75, or 0.5.")
        return float(v)

    for key in ("video_sources", "audio_sources", "order", "clips", "video2", "independent_audio"):
        if not isinstance(value[key], list):
            _invalid(f"{key} must be an array.")
    if (
        not value["clips"]
        or len(value["clips"]) + len(value["video2"]) > max_clips
        or len(value["video_sources"]) != video_file_count
        or not 1 <= video_file_count <= max_clips
        or len(value["audio_sources"]) > max_clips
    ):
        _invalid(
            "Source catalogs and video occurrences must fit the clip limit; Video 1 is required."
        )
    videos = tuple(
        VideoSourceDescriptor(ident(_object(v, {"source_id"}, "Video source")["source_id"]))
        for v in value["video_sources"]
    )
    audios = tuple(
        AudioSourceDescriptor(ident(_object(v, {"source_id"}, "Audio source")["source_id"]))
        for v in value["audio_sources"]
    )
    vc, ac = {v.source_id for v in videos}, {v.source_id for v in audios}
    if len(vc) != len(videos) or len(ac) != len(audios) or vc & ac:
        _invalid("Source IDs must be unique and video/audio catalogs disjoint.")
    ids, vrefs, arefs = set(), set(), set()

    def identity(v):
        i = ident(v)
        if i in ids:
            _invalid("Occurrence and segment IDs must be unique.")
        ids.add(i)
        return i

    def reference(v, catalog, refs):
        i = ident(v)
        if i not in catalog:
            raise ApiError(422, "missing_source", "Missing or incompatible source.", source_id=i)
        refs.add(i)
        return i

    common = {
        "client_id",
        "source_id",
        "start_frame",
        "end_frame",
        "speed",
        "trim_saved",
        "original_audio",
    }

    def video(v, replacement):
        extra = (
            {"timeline_start_frame", "content_in_frame", "content_out_frame", "content_full_source"}
            if replacement
            else {"timeline_start_frame", "duration_frames", "output_in_frame", "output_out_frame"}
        )
        v = _object(v, common | extra, "Video occurrence")
        i = identity(v["client_id"])
        s = reference(v["source_id"], vc, vrefs)
        a, b = integer(v["start_frame"]), integer(v["end_frame"])
        if a > b or type(v["trim_saved"]) is not bool:
            _invalid("Invalid source trim.")
        edit = ClipEdit(a, b, speed(v["speed"]), v["trim_saved"])
        mode = v["original_audio"]
        if not isinstance(mode, str) or mode not in ("linked", "detached"):
            _invalid("Original audio mode must be linked or detached.")
        start = integer(v["timeline_start_frame"])
        a = integer(v["content_in_frame"] if replacement else v["output_in_frame"])
        b = integer(v["content_out_frame"] if replacement else v["output_out_frame"])
        if b <= a:
            _invalid("Output windows must contain at least one frame.")
        if replacement:
            if type(v["content_full_source"]) is not bool:
                _invalid("Full source flags must be boolean.")
            return V3ReplacementOccurrence(i, s, edit, start, a, b, v["content_full_source"], mode)
        duration = integer(v["duration_frames"], 1)
        if duration != b - a:
            _invalid("Declared duration must match the output window.")
        return WindowedVideoOccurrence(i, s, edit, start, duration, a, b, mode)

    clips = tuple(video(v, False) for v in value["clips"])
    replacements = tuple(video(v, True) for v in value["video2"])
    order = tuple(ident(v) for v in value["order"])
    if (
        len(order) != len(clips)
        or len(set(order)) != len(order)
        or set(order) != {v.client_id for v in clips}
    ):
        _invalid("Order must contain each Video 1 occurrence exactly once.")
    by_id = {v.client_id: v for v in clips}
    position = 0
    for i in order:
        if by_id[i].timeline_start_frame != position:
            _invalid("Video 1 positions must be contiguous from zero.")
        position = integer(position + by_id[i].duration_frames)
    output_fps = fps(value["output_fps"])
    _object(
        value["audio"],
        {"original_volume", "original_muted", "music_volume", "music_muted"},
        "Audio",
    )
    _object(value["overlays"], {"image", "video"}, "Overlays")
    for kind, overlay in value["overlays"].items():
        if isinstance(overlay, dict) and any(
            not isinstance(overlay.get(field), str) for field in ("position", "size")
        ):
            _invalid(f"The {kind} overlay position and size must be strings.")
    legacy = {
        "clips": [
            {
                "client_id": v.client_id,
                "start_frame": v.edit.start_frame,
                "end_frame": v.edit.end_frame,
                "speed": v.edit.speed,
                "trim_saved": v.edit.trim_saved,
            }
            for v in clips
        ],
        "order": list(order),
        "output_fps": output_fps,
        "audio": value["audio"],
        "overlays": value["overlays"],
    }
    settings = _parse_manifest(json.dumps(legacy), len(clips), max_clips)
    segments = []
    for raw in value["independent_audio"]:
        required = {
            "id",
            "timeline_start_frame",
            "duration_frames",
            "source_start_sample",
            "source",
        }
        if not isinstance(raw, dict):
            _invalid("Independent audio segment fields are invalid.")
        v = _object(
            raw,
            required | ({"detached_from"} if "detached_from" in raw else set()),
            "Independent audio",
        )
        r = v["source"]
        if not isinstance(r, dict):
            _invalid("Audio recipe must be an object.")
        kind = r.get("kind")
        if kind == "audio-file":
            _object(r, {"kind", "source_id"}, "Audio recipe")
            recipe = AudioFileRecipe(reference(r["source_id"], ac, arefs))
        elif kind == "video-edit":
            _object(
                r,
                {
                    "kind",
                    "source_id",
                    "source_start_frame",
                    "source_end_frame",
                    "speed",
                    "normalization_fps",
                },
                "Video recipe",
            )
            a, b = integer(r["source_start_frame"]), integer(r["source_end_frame"])
            if a > b:
                _invalid("Invalid frozen audio trim.")
            recipe = VideoEditRecipe(
                reference(r["source_id"], vc, vrefs),
                a,
                b,
                speed(r["speed"]),
                fps(r["normalization_fps"]),
            )
        else:
            _invalid("Unknown audio recipe kind.")
        provenance = None
        if "detached_from" in v:
            p = _object(v["detached_from"], {"track", "clip_id"}, "Detached provenance")
            if p["track"] not in ("video1", "video2"):
                _invalid("Detached provenance track is invalid.")
            provenance = DetachedProvenance(p["track"], ident(p["clip_id"]))
        segments.append(
            IndependentAudioSegment(
                identity(v["id"]),
                integer(v["timeline_start_frame"]),
                integer(v["duration_frames"], 1),
                integer(v["source_start_sample"]),
                recipe,
                provenance,
            )
        )
    music = None
    if value["music"] is not None:
        m = _object(value["music"], {"source_id", "segments"}, "Music")
        sid = reference(m["source_id"], ac, arefs)
        if not isinstance(m["segments"], list) or not m["segments"]:
            _invalid("Music requires segments.")
        music_segments = []
        for raw in m["segments"]:
            v = _object(
                raw,
                {
                    "client_id",
                    "source_id",
                    "timeline_start_frame",
                    "source_start_sample",
                    "duration_frames",
                },
                "Music segment",
            )
            if ident(v["source_id"]) != sid:
                _invalid("Music segment source must match music catalog reference.")
            music_segments.append(
                MusicSegment(
                    identity(v["client_id"]),
                    sid,
                    integer(v["timeline_start_frame"]),
                    integer(v["source_start_sample"]),
                    integer(v["duration_frames"], 1),
                )
            )
        music = MusicPlan(sid, tuple(music_segments))
    if len(segments) + (len(music.segments) if music else 0) > 10 * max_clips:
        _invalid("Combined audio segment count exceeds the render limit.")
    if vrefs != vc or arefs != ac:
        _invalid("Catalogs must contain exactly the referenced sources.")
    exports = value.get("exports", ["mp4"])
    if (
        not isinstance(exports, list)
        or any(not isinstance(v, str) or v not in ("mp4", "mov", "wav", "mp3") for v in exports)
        or len(set(exports)) != len(exports)
        or "mp4" not in exports
    ):
        _invalid("Exports must be unique supported formats including mp4.")
    return V3MergePlan(
        videos,
        clips,
        order,
        replacements,
        output_fps,
        settings.audio_mix,
        music,
        settings.image_overlay,
        settings.video_overlay,
        audios,
        tuple(segments),
        tuple(exports),
    )
