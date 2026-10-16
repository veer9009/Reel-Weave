import subprocess

import pytest

from backend.app.errors import ApiError


def test_capabilities_require_installed_encoder_and_muxer(settings, monkeypatch):
    from backend.app.capabilities import probe_export_capabilities

    calls = []

    def listing(args, **kwargs):
        calls.append((args, kwargs))
        data = (
            " V..... libx264 H264\n A..... aac AAC\n A..... pcm_s16le PCM\n"
            if "-encoders" in args
            else " E mp4 MP4\n E mov MOV\n E wav WAV\n E mp3 MP3\n"
        )
        return subprocess.CompletedProcess(args, 0, data, "")

    monkeypatch.setattr(subprocess, "run", listing)
    assert probe_export_capabilities(settings) == {
        "mp4": True,
        "mov": True,
        "wav": True,
        "mp3": False,
    }
    assert len(calls) == 2
    assert all(call[1]["timeout"] <= settings.subprocess_timeout_seconds for call in calls)
    assert all(call[1]["stdin"] == subprocess.DEVNULL for call in calls)


@pytest.mark.parametrize("failure", ["timeout", "failed", "missing"])
def test_listing_failure_is_truthful(settings, monkeypatch, failure):
    from backend.app.capabilities import probe_export_capabilities

    def fail(args, **kwargs):
        if failure == "missing":
            raise FileNotFoundError
        if failure == "timeout":
            raise subprocess.TimeoutExpired(args, 1)
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(subprocess, "run", fail)
    if failure == "missing":
        with pytest.raises(ApiError) as exc:
            probe_export_capabilities(settings)
        assert exc.value.status_code == 503
    else:
        assert not any(probe_export_capabilities(settings).values())


def test_missing_primary_disables_mov_and_rejects_requested_format(settings, monkeypatch):
    from backend.app.capabilities import probe_export_capabilities, require_export_capabilities

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda args, **kw: subprocess.CompletedProcess(
            args, 0, " A..... pcm_s16le PCM\n E wav WAV\n E mov MOV\n", ""
        ),
    )
    capabilities = probe_export_capabilities(settings)
    assert capabilities == {"mp4": False, "mov": False, "wav": True, "mp3": False}
    with pytest.raises(ApiError) as exc:
        require_export_capabilities(("mp4", "mp3"), capabilities)
    assert exc.value.status_code == 422
    assert exc.value.code == "unsupported_format"
    assert "MP4" in exc.value.message


def test_supported_formats_pass_and_unknown_formats_fail():
    from backend.app.capabilities import require_export_capabilities

    require_export_capabilities(("mp4", "wav"), {"mp4": True, "wav": True})
    with pytest.raises(ApiError):
        require_export_capabilities(("other",), {})
