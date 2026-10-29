"""Real audio-only preview matches the frozen export recipe without video encoding."""
import json
import os
import subprocess
import pytest
from fastapi.testclient import TestClient
from backend.app.main import create_app
from tests.integration.test_timeline_audio_exports import project as project
from tests.integration.test_v3_audio_invariants import pcm_values

pytestmark = pytest.mark.skipif(os.getenv('RUN_FFMPEG_TESTS') != '1', reason='Real FFmpeg opt-in required')

@pytest.mark.parametrize('speed,frames', [(0.75,40),(0.5,60)])
def test_preview_recipe_matches_independent_canonical_pcm(project, tmp_path, speed, frames):
    ffmpeg,_,settings,_,job,m=project
    m.update(video_sources=[{'source_id':'base'}], video2=[], exports=['mp4','wav'])
    m['clips'][0].update(speed=speed, duration_frames=frames, output_out_frame=frames)
    m['audio'].update(original_volume=1, original_muted=False, music_volume=0, music_muted=True)
    before={p.name for p in settings.upload_root.iterdir()}
    with TestClient(create_app(settings)) as client:
        with job.video_source_paths['base'].open('rb') as upload:
            response=client.post('/api/preview-audio', data={'manifest':json.dumps(m)}, files={'files':('base.mp4',upload,'video/mp4')})
        assert response.status_code==200, response.text
        assert response.headers['content-type']=='audio/wav'
        actual=tmp_path/'actual.wav'
        actual.write_bytes(response.content)
        assert {p.name for p in settings.upload_root.iterdir()}==before
    expected=tmp_path/'expected.wav'
    samples=frames*1920
    filters=(f'atrim=start=0:end=1.2,asetpts=PTS-STARTPTS,atempo={speed:g},'
        'aresample=48000,aformat=channel_layouts=stereo,'
        f'apad=whole_len={samples},atrim=end_sample={samples},asetpts=PTS-STARTPTS')
    subprocess.run([ffmpeg,'-v','error','-y','-i',str(job.video_source_paths['base']),'-map','0:a:0','-af',filters,'-ar','48000','-ac','2','-c:a','pcm_s16le',str(expected)],check=True,capture_output=True)
    got,want=pcm_values(actual),pcm_values(expected)
    assert len(got)==len(want)==samples*2
    assert max(abs(a-b) for a,b in zip(got,want,strict=True))<=1
