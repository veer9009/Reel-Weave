from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.media import MediaPipeline, ProcessingError


def test_metadata_uses_video_frame_count_and_cleans_upload(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.app.main._tool_available', lambda _: True)
    monkeypatch.setattr('backend.app.capabilities.probe_export_capabilities',
                        lambda _: dict.fromkeys(['mp4', 'mov', 'wav', 'mp3'], True))
    metadata = {'format': {'duration': '5.8'}, 'streams': [
        {'codec_type': 'video', 'codec_name': 'h264', 'avg_frame_rate': '30/1',
         'nb_read_frames': '169', 'duration': str(169 / 30), 'width': 478, 'height': 850},
        {'codec_type': 'audio', 'duration': '5.8'},
    ]}
    monkeypatch.setattr(MediaPipeline, '_probe', lambda self, path: metadata)
    app = create_app(Settings(working_root=tmp_path / 'work'))
    with TestClient(app) as client:
        response = client.post('/api/video-metadata', files={'files': ('portrait.mp4', b'video', 'video/mp4')})
    assert response.status_code == 200, response.text
    assert response.json() == {'duration': 169 / 30, 'fps': 30, 'totalFrames': 169,
                               'width': 478, 'height': 850, 'source': 'backend'}
    assert all(not list(root.iterdir()) for root in app.state.storage.roots)


def test_metadata_decode_failure_cleans_upload(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.app.main._tool_available', lambda _: True)
    monkeypatch.setattr('backend.app.capabilities.probe_export_capabilities', lambda _: {})
    def broken(self, path):
        raise ProcessingError('unreadable')
    monkeypatch.setattr(MediaPipeline, '_probe', broken)
    app = create_app(Settings(working_root=tmp_path / 'work'))
    with TestClient(app) as client:
        response = client.post('/api/video-metadata', files={'files': ('portrait.mp4', b'video', 'video/mp4')})
    assert response.status_code == 422, response.text
    assert all(not list(root.iterdir()) for root in app.state.storage.roots)
