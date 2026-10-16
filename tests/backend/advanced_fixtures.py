def advanced_manifest():
    return {
        "schema_version": 2,
        "output_fps": 25,
        "video_sources": [{"source_id": "base"}, {"source_id": "take"}],
        "order": ["main"],
        "clips": [
            {
                "client_id": "main",
                "source_id": "base",
                "start_frame": 0,
                "end_frame": 149,
                "speed": 1,
                "trim_saved": True,
            }
        ],
        "video2": [
            {
                "client_id": "replacement",
                "source_id": "take",
                "start_frame": 0,
                "end_frame": 59,
                "speed": 1,
                "trim_saved": True,
                "timeline_start_frame": 40,
                "content_in_frame": 0,
                "content_out_frame": 60,
                "content_full_source": False,
            }
        ],
        "music": None,
        "overlays": {"image": None, "video": None},
        "audio": {
            "original_volume": 1,
            "original_muted": False,
            "music_volume": 0.3,
            "music_muted": False,
        },
    }


def v3_manifest():
    m = advanced_manifest()
    m["schema_version"] = 3
    m["audio_sources"] = []
    m["independent_audio"] = []
    m["clips"][0].update(
        timeline_start_frame=0,
        duration_frames=150,
        output_in_frame=0,
        output_out_frame=150,
        original_audio="linked",
    )
    m["video2"][0]["original_audio"] = "linked"
    return m
