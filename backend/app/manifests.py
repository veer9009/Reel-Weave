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
