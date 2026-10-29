import json
import pytest
from fastapi.testclient import TestClient
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.media import MediaPipeline, ProcessingError
from tests.backend.advanced_fixtures import v3_manifest

def request_manifest():
    m = v3_manifest()
    m.update(video_sources=[{'source_id': 'base'}], video2=[], exports=['mp4', 'wav'])
    m['clips'][0].update(end_frame=29, speed=0.5, duration_frames=60, output_out_frame=60)
    return m

@pytest.fixture
def preview(tmp_path, monkeypatch):
    settings = Settings(working_root=tmp_path/'work')
    monkeypatch.setattr('backend.app.main._tool_available', lambda _: True)
    monkeypatch.setattr('backend.app.capabilities.probe_export_capabilities', lambda _: dict.fromkeys(['mp4','mov','wav','mp3'], True))
    seen=[]
    def validate(self, job):
        job.resolved_plan = object()
    def audio(pipeline, job, plan):
        seen.append(job.v3_plan.clips[0].edit.speed)
        path=job.output_dir/'preview.wav'
        path.write_bytes(b'RIFF-precise-audio')
        return path
    monkeypatch.setattr(MediaPipeline, 'validate_job', validate)
    monkeypatch.setattr('backend.app.advanced_media.render_audio_master', audio)
    app=create_app(settings)
    return app,settings,seen

def test_preview_uses_audio_master_without_video_export_and_cleans_files(preview, monkeypatch):
    app,settings,seen=preview
    def forbidden(*args): raise AssertionError('Video export must not run for preview audio')
    monkeypatch.setattr(MediaPipeline, 'merge', forbidden)
    with TestClient(app) as client:
        r=client.post('/api/preview-audio', data={'manifest':json.dumps(request_manifest())}, files={'files':('clip.mp4',b'video','video/mp4')})
        assert r.status_code==200, r.text
        assert r.headers['content-type']=='audio/wav'
        assert r.content==b'RIFF-precise-audio'
    assert seen==[0.5]
    assert all(not list(p.iterdir()) for p in app.state.storage.roots)

def test_preview_failure_cleans_temporary_files(preview, monkeypatch):
    app,settings,_=preview
    def broken(*args): raise ProcessingError('could not decode sound')
    monkeypatch.setattr('backend.app.advanced_media.render_audio_master', broken)
    with TestClient(app) as client:
        r=client.post('/api/preview-audio', data={'manifest':json.dumps(request_manifest())}, files={'files':('clip.mp4',b'video','video/mp4')})
        assert r.status_code==422, r.text
    assert all(not list(p.iterdir()) for p in app.state.storage.roots)

def test_preview_rejects_invalid_manifest_without_leaving_files(preview):
    app,settings,_=preview
    with TestClient(app) as client:
        r=client.post('/api/preview-audio', data={'manifest':'{}'}, files={'files':('clip.mp4',b'video','video/mp4')})
        assert r.status_code==422, r.text
    assert all(not list(p.iterdir()) for p in app.state.storage.roots)
