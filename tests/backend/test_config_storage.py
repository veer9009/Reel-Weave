from __future__ import annotations

import os
import time
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest


def test_settings_reject_storage_outside_working_root(tmp_path: Path):
    from backend.app.config import Settings

    with pytest.raises(ValueError, match="descendant"):
        Settings(working_root=tmp_path / "work", upload_root=tmp_path / "outside")


def test_settings_reject_overlapping_storage_roots(tmp_path: Path):
    from backend.app.config import Settings

    with pytest.raises(ValueError, match="overlap"):
        Settings(
            working_root=tmp_path / "work",
            upload_root=tmp_path / "work" / "data",
            output_root=tmp_path / "work" / "data" / "outputs",
        )


def test_settings_load_project_env_file_without_overriding_process_env(tmp_path: Path, monkeypatch):
    from backend.app.config import Settings

    env_file = tmp_path / ".env"
    env_file.write_text("REELWEAVE_MAX_CLIPS=7\nREELWEAVE_MAX_FILE_SIZE_MB=12\n", encoding="utf-8")
    monkeypatch.setenv("REELWEAVE_MAX_CLIPS", "8")

    loaded = Settings.from_env(env_file)

    assert loaded.max_clips == 8
    assert loaded.max_file_size_bytes == 12 * 1024 * 1024


def test_settings_default_to_twenty_clip_ad_assemblies(monkeypatch):
    from backend.app.config import Settings

    monkeypatch.delenv("REELWEAVE_MAX_CLIPS", raising=False)

    assert Settings.from_env(None).max_clips == 20


def test_settings_expose_overlay_limits_and_include_them_in_request_budget(
    tmp_path: Path, monkeypatch
):
    from backend.app.config import Settings

    monkeypatch.setenv("REELWEAVE_MAX_OVERLAY_IMAGE_FILE_SIZE_MB", "7")
    monkeypatch.setenv("REELWEAVE_MAX_OVERLAY_VIDEO_FILE_SIZE_MB", "11")
    loaded = Settings.from_env(None)

    assert loaded.max_overlay_image_file_size_bytes == 7 * 1024 * 1024
    assert loaded.max_overlay_video_file_size_bytes == 11 * 1024 * 1024
    assert loaded.max_overlay_image_file_size_mb == 7
    assert loaded.max_overlay_video_file_size_mb == 11

    settings = Settings(
        working_root=tmp_path / "request-budget",
        max_file_size_bytes=10,
        max_audio_file_size_bytes=20,
        max_overlay_image_file_size_bytes=30,
        max_overlay_video_file_size_bytes=40,
        max_clips=2,
    )
    expected_overhead = 1024 * 1024 + (2 + 3) * 64 * 1024
    assert settings.max_request_size_bytes == 10 * 2 + 20 + 30 + 40 + expected_overhead


def test_overlay_settings_are_immutable_and_jobs_have_empty_overlay_state(settings):
    from backend.app.jobs import Job, OverlaySettings
    from backend.app.storage import Storage

    overlay = OverlaySettings(0, 10, "top-right", "small")
    with pytest.raises(FrozenInstanceError):
        overlay.end_frame = 20

    job = Job.create(Storage(settings), "abababab-abab-4bab-8bab-abababababab")
    assert job.image_overlay_settings is None
    assert job.image_overlay_path is None
    assert job.video_overlay_settings is None
    assert job.video_overlay_path is None
    assert job.total_project_frames == 0


def test_storage_uses_generated_names_and_preserves_order(settings):
    from backend.app.storage import Storage

    storage = Storage(settings)
    paths = storage.save_uploads(
        "11111111-1111-4111-8111-111111111111",
        [("../../secret.mov", b"one"), ("CON.mp4", b"two")],
    )

    assert [path.name for path in paths] == ["000.mov", "001.mp4"]
    assert all("secret" not in str(path) and "CON" not in str(path) for path in paths)
    assert [path.read_bytes() for path in paths] == [b"one", b"two"]


def test_cleanup_removes_old_orphans_but_retains_active_job(settings):
    from backend.app.storage import Storage

    storage = Storage(settings)
    old = time.time() - settings.retention_seconds - 5
    orphan = settings.upload_root / "22222222-2222-4222-8222-222222222222"
    active = settings.upload_root / "33333333-3333-4333-8333-333333333333"
    orphan.mkdir(parents=True)
    active.mkdir(parents=True)
    os.utime(orphan, (old, old))
    os.utime(active, (old, old))

    storage.cleanup_orphans(active_job_ids={active.name}, now=time.time())

    assert not orphan.exists()
    assert active.exists()


def test_cleanup_only_treats_generated_uuid_directories_as_orphans(settings):
    from backend.app.storage import Storage

    storage = Storage(settings)
    old = time.time() - settings.retention_seconds - 5
    unrelated = settings.upload_root / "operator-notes"
    unrelated.mkdir()
    os.utime(unrelated, (old, old))

    storage.cleanup_orphans(active_job_ids=set(), now=time.time())

    assert unrelated.exists()


def test_safe_cleanup_refuses_symlink_escape(settings, tmp_path: Path):
    from backend.app.storage import Storage, UnsafePathError

    storage = Storage(settings)
    outside = tmp_path / "outside"
    outside.mkdir()
    marker = outside / "keep.txt"
    marker.write_text("keep", encoding="utf-8")
    link = settings.upload_root / "44444444-4444-4444-8444-444444444444"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    with pytest.raises(UnsafePathError):
        storage.remove_path(link)

    assert marker.read_text(encoding="utf-8") == "keep"


def test_cleanup_terminal_jobs_only_after_retention(settings):
    from backend.app.jobs import Job, JobRegistry
    from backend.app.storage import Storage

    storage = Storage(settings)
    registry = JobRegistry()
    old = Job.create(storage, "55555555-5555-4555-8555-555555555555")
    active = Job.create(storage, "66666666-6666-4666-8666-666666666666")
    old.status = "completed"
    old.updated_at = 10
    active.status = "processing"
    active.updated_at = 10
    registry.add(old)
    registry.add(active)

    registry.cleanup_expired(storage, retention_seconds=20, now=31)

    assert registry.get(old.id) is None
    assert registry.get(active.id) is active


def test_cleanup_keeps_registry_entry_when_windows_has_file_open(settings, monkeypatch):
    from backend.app.jobs import Job, JobRegistry
    from backend.app.storage import Storage

    storage = Storage(settings)
    registry = JobRegistry()
    job = Job.create(storage, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    job.status = "completed"
    job.updated_at = 10
    registry.add(job)

    def deny_removal(_job_id):
        raise PermissionError

    monkeypatch.setattr(storage, "remove_job", deny_removal)

    registry.cleanup_expired(storage, retention_seconds=20, now=31)

    assert registry.get(job.id) is job


def test_registry_known_ids_include_terminal_jobs(settings):
    from backend.app.jobs import Job, JobRegistry
    from backend.app.storage import Storage

    storage = Storage(settings)
    registry = JobRegistry()
    job = Job.create(storage, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    job.status = "completed"
    registry.add(job)

    assert registry.known_ids() == {job.id}
