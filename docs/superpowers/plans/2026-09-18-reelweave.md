# ReelWeave Trim Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved version-1 frame-accurate trim editor, per-clip speed, and background-audio mix to the existing local ReelWeave MVP.

**Architecture:** Keep the existing React/Vite frontend and FastAPI backend. The frontend owns interactive edit state and sends an ordered multipart request with videos, optional background audio, and a JSON manifest; the backend validates the manifest against probed media metadata, stores generated local paths, and runs one FFmpeg pipeline that trims first, applies speed second, concatenates, and optionally mixes background music.

**Tech Stack:** React, TypeScript, Vite, CSS, lucide-react, Vitest, Playwright, Python, FastAPI, FFmpeg, FFprobe, Pytest, Ruff.

**Spec:** `docs/superpowers/specs/2026-09-18-reelweave-design.md`

## Global Constraints

- Preserve the existing backend and frontend structure.
- Do not recreate the project or overwrite working code.
- Do not commit, push to GitHub, deploy, install global dependencies, or modify system settings.
- No login, database, saved projects, cloud services, AI features, or transition effects in version 1.
- Video inputs: MP4, MOV, WebM, MKV; 2-10 clips; 200 MiB per clip by default.
- Background audio input: one MP3, WAV, AAC, or M4A file; 100 MiB by default.
- Output: 1280x720, 30 fps, square pixels, H.264/yuv420p, AAC stereo 48 kHz.
- Trim is inclusive by frame index: `start_frame` and `end_frame` are both included.
- Processing order is trim first, speed second, merge third, background-audio mix last.
- API errors keep the existing `{ "error": { "code": "...", "message": "..." } }` shape.

## Review Focus

- Off-by-one trim boundaries: selecting one frame and selecting the final frame must render exactly the requested frames.
- Variable or missing metadata: backend probing must reject unsafe ranges instead of trusting browser-only frame counts.
- Audio duration drift: slowed original audio and looped music must not extend the final MP4 beyond the merged video timeline.
- Multipart contract mismatch: manifest clip count and file order must stay locked to uploaded file order.
- UI state cleanup: object URLs for clip previews, thumbnails, and music previews must be revoked on removal, reset, and unmount.

---

## File Structure

- Modify `frontend/src/lib/clips.ts` to define clip edit types, frame/time helpers, validation, and duration derivation.
- Modify `frontend/src/lib/api.ts` to submit `files`, optional `background_audio`, and `manifest`.
- Modify `frontend/src/App.tsx` to own trim, speed, background-audio, and merge-manifest state.
- Modify `frontend/src/components/ClipList.tsx` to show Trim buttons and speed selectors per clip.
- Create `frontend/src/components/TrimEditor.tsx` for preview, timeline, handles, playhead, frame stepping, and save/cancel.
- Create `frontend/src/components/BackgroundAudioTrack.tsx` for audio upload, duration display, placeholder waveform, volume controls, and mute toggles.
- Modify `frontend/src/components/MergeSummary.tsx` to show speed-adjusted clip durations, final duration, and audio-track status.
- Modify `frontend/src/styles.css` for the editor, trim timeline, handles, playhead, audio track, and responsive states.
- Modify frontend tests: `frontend/src/App.test.tsx`, `frontend/src/lib/clips.test.ts`, and `frontend/e2e/reelweave.spec.ts`.
- Modify `backend/app/main.py` to parse and validate multipart `manifest` and optional `background_audio`.
- Modify `backend/app/jobs.py` to store clip edit specs and background-audio settings on `Job`.
- Modify `backend/app/storage.py` to create generated storage paths for background audio.
- Modify `backend/app/config.py` and `backend/.env.example` to add `max_audio_file_size_mb`.
- Modify `backend/app/media.py` to probe frame metadata, apply trim/speed filters, and mix background audio.
- Modify backend tests: `tests/backend/test_api.py`, `tests/backend/test_media.py`, `tests/backend/test_config_storage.py`, and `tests/integration/test_real_merge.py`.
- Modify `README.md` and `docs/verification.md` after implementation.

## Task 1: Shared Frontend Edit Model

**Files:** `frontend/src/lib/clips.ts`, `frontend/src/lib/clips.test.ts`

**Interfaces:** Produce `ClipSpeed`, `ClipMetadata`, `ClipTrim`, `ClipEdit`, `formatTimestamp`, `frameToSeconds`, `selectedFrameCount`, `selectedSourceDuration`, `outputDuration`, `validateTrim`, and `buildMergeManifest`.

- [ ] Add failing Vitest cases for one-frame ranges, final-frame ranges, invalid reversed ranges, speed-adjusted duration, timestamp formatting, and manifest clip order.

Run: `cd frontend; npm.cmd test -- --run src/lib/clips.test.ts`

- [ ] Implement the helper types and pure functions in `frontend/src/lib/clips.ts` using inclusive frame math:

```ts
export function selectedFrameCount(trim: ClipTrim) {
  return trim.endFrame - trim.startFrame + 1;
}

export function outputDuration(trim: ClipTrim, fps: number, speed: ClipSpeed) {
  return selectedSourceDuration(trim, fps) / speed;
}
```

- [ ] Run the focused tests until they pass.

## Task 2: Trim Editor UI

**Files:** `frontend/src/components/TrimEditor.tsx`, `frontend/src/components/ClipList.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/App.test.tsx`

**Interfaces:** Consume Task 1 helpers. Produce `TrimEditor` with `clip`, `disabled`, `onSave(clipId, trim)`, and `onCancel` props.

- [ ] Add failing tests that render a clip with a Trim button, open the editor, show playhead/start/end timestamps and frame numbers, move Previous Frame and Next Frame by one, reject a reversed range, save a valid range, and cancel without changing state.

Run: `cd frontend; npm.cmd test -- --run src/App.test.tsx`

- [ ] Implement metadata loading for each selected clip and initialize trim to the full known frame range.

- [ ] Implement `TrimEditor.tsx` with video preview, fallback thumbnail rail, draggable start/end handles, draggable playhead, Previous Frame and Next Frame buttons, and accessible labels for frame and timestamp readouts.

- [ ] Wire `ClipList.tsx` to open the editor for a chosen clip and show the current selected frame range.

- [ ] Add CSS for stable responsive timeline dimensions, handles, playhead, focus states, and mobile layout.

- [ ] Run the focused frontend tests until passing.

## Task 3: Per-Clip Speed UI

**Files:** `frontend/src/components/ClipList.tsx`, `frontend/src/components/MergeSummary.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/clips.test.ts`, `frontend/src/App.test.tsx`

**Interfaces:** Consume `ClipSpeed` and `outputDuration`. Produce `onSpeedChange(clipId, speed)`.

- [ ] Add failing tests for selecting 1x, 0.75x, and 0.5x speeds, preserving trim frame indices across speed changes, and showing speed-adjusted durations in the clip list and merge summary.

Run: `cd frontend; npm.cmd test -- --run src/lib/clips.test.ts src/App.test.tsx`

- [ ] Implement the Speed selector with exact labels `1x Normal`, `0.75x Slow`, and `0.5x Slow motion`.

- [ ] Update preview and summary duration calculations to use trim range first and speed second.

- [ ] Run focused tests until passing.

## Task 4: Background Audio UI

**Files:** `frontend/src/components/BackgroundAudioTrack.tsx`, `frontend/src/App.tsx`, `frontend/src/components/MergeSummary.tsx`, `frontend/src/styles.css`, `frontend/src/App.test.tsx`

**Interfaces:** Produce `AudioSettings` with `originalVolume`, `originalMuted`, `musicVolume`, and `musicMuted`; produce a `BackgroundAudioTrack` component with file selection, removal, duration, final duration, settings, and disabled props.

- [ ] Add failing tests for uploading one supported music file, rejecting unsupported music files, showing a track from `00:00`, showing duration, defaulting original volume to 100% and music volume to 30%, muting either track, removing music, and revoking object URLs.

Run: `cd frontend; npm.cmd test -- --run src/App.test.tsx`

- [ ] Implement the background-audio track below the video clip track with upload, remove, duration, placeholder waveform, volume sliders, and mute checkboxes.

- [ ] Keep the Merge button disabled while selected audio is invalid or metadata is still loading.

- [ ] Run focused tests until passing.

## Task 5: Multipart API Contract

**Files:** `frontend/src/lib/api.ts`, `frontend/src/App.tsx`, `backend/app/main.py`, `backend/app/config.py`, `backend/.env.example`, `tests/backend/test_api.py`, `frontend/src/App.test.tsx`

**Interfaces:** Change frontend `submitMerge` to accept edited clips, a `MergeManifest`, optional `backgroundAudio`, and an optional `AbortSignal`. Backend accepts multipart fields `files`, `manifest`, and optional `background_audio`.

- [ ] Add failing backend tests for missing manifest, malformed JSON, clip-count mismatch, invalid trim range, invalid speed, invalid volume, unsupported background audio extension, oversized audio, and a valid request storing generated video and audio paths.

Run: `.venv\Scripts\python.exe -m pytest tests/backend/test_api.py -q`

- [ ] Add failing frontend tests that assert the multipart request includes ordered `files`, `manifest`, and optional `background_audio`.

- [ ] Add `max_audio_file_size_mb` to `Settings`, health limits, and `.env.example`.

- [ ] Parse the JSON manifest in `create_merge`, validate field types before storing files, store background audio under a generated name, and keep cleanup behavior for partially created jobs.

- [ ] Update `frontend/src/lib/api.ts` and `App.tsx` to submit the manifest and background audio.

- [ ] Run focused backend and frontend tests until passing.

## Task 6: Backend Job Model and Storage

**Files:** `backend/app/jobs.py`, `backend/app/storage.py`, `backend/app/main.py`, `tests/backend/test_config_storage.py`, `tests/backend/test_api.py`

**Interfaces:** Add backend dataclasses `ClipEdit(start_frame, end_frame, speed, trim_saved)` and `AudioMixSettings(original_volume, original_muted, music_volume, music_muted)`. `Job` gains `clip_edits`, `background_audio_path`, and `audio_mix`.

- [ ] Add failing tests that job cleanup removes uploaded background audio, active job cleanup skips audio, generated audio paths stay inside the working root, and unsafe audio paths are refused.

Run: `.venv\Scripts\python.exe -m pytest tests/backend/test_config_storage.py tests/backend/test_api.py -q`

- [ ] Extend storage directory creation and removal to include generated background-audio paths.

- [ ] Extend job creation so every queued job carries validated clip edits and audio mix settings.

- [ ] Run focused backend tests until passing.

## Task 7: FFmpeg Trim, Speed, and Music Mix

**Files:** `backend/app/media.py`, `tests/backend/test_media.py`, `tests/integration/test_real_merge.py`

**Interfaces:** Consume `Job.clip_edits`, `Job.background_audio_path`, and `Job.audio_mix`. Produce final MP4 where only selected frames are included, speed is applied after trimming, and optional background audio is looped or trimmed to final timeline length.

- [ ] Add failing media unit tests that inspect command arguments for `trim=start_frame=...:end_frame=...`, speed `setpts`, audio `atrim`, `atempo`, volume filters, looping behavior, `amix`, and no user filename leakage.

Run: `.venv\Scripts\python.exe -m pytest tests/backend/test_media.py -q`

- [ ] Add real FFmpeg integration tests that generate source clips with known colored frame blocks and tones, request one-frame and multi-frame trims, apply 0.75x and 0.5x speeds, add short and long music tracks, and verify output duration, order, frame colors, audio presence, and music trim/loop behavior.

Run: `$env:RUN_FFMPEG_TESTS='1'; .\.venv\Scripts\python.exe -m pytest tests/integration/test_real_merge.py -q`

- [ ] Update probing to return frame rate, total frame count, duration, and audio presence per source.

- [ ] Normalize unsaved trims to the decoded full range, clamp stale end frames,
  and reject a saved range only when it contains no decoded frames after clamping.

- [ ] Replace per-clip normalization with a trim-first, speed-second video filter:

```text
[0:v:0]trim=start_frame=START:end_frame=END_EXCLUSIVE,setpts=PTS-STARTPTS,setpts=(PTS-STARTPTS)/SPEED,scale=...,fps=30,format=yuv420p,setsar=1[v]
```

- [ ] Apply original audio processing after the same trim range:

```text
atrim=start=START_SECONDS:end=END_SECONDS,asetpts=PTS-STARTPTS,atempo=SPEED,aresample=48000,aformat=channel_layouts=stereo
```

- [ ] Generate silence for clips without audio for the exact processed clip duration.

- [ ] Concatenate intermediate clips, then mix optional background audio with final original audio. Loop short music, trim long music, apply mute/volume controls, and force final duration to the processed video timeline.

- [ ] Run media and integration tests until passing.

## Task 8: End-to-End UI Verification

**Files:** `frontend/e2e/reelweave.spec.ts`, `frontend/playwright.config.ts` only if needed for test assets or timeouts.

**Interfaces:** Consume the completed frontend and backend API.

- [ ] Add Playwright coverage for uploading clips, opening Trim, stepping frames, dragging handles, saving trim, changing speed, uploading background audio, adjusting volume and mute, merging, playing the result, downloading, resetting, and deleting.

Run: `cd frontend; npm.cmd run test:e2e`

- [ ] Verify desktop and mobile viewport screenshots still show non-overlapping controls and readable text.

## Task 9: README and Verification Notes

**Files:** `README.md`, `docs/verification.md`

**Interfaces:** Consume final implemented behavior and actual command outputs.

- [ ] Update README with trim editor behavior, per-clip speed, background-audio upload, volume and mute controls, manifest API, backend validation, limits, and local run commands.

- [ ] Update `docs/verification.md` with exact commands run, pass/fail results, browser checks, FFmpeg integration notes, and remaining limitations.

- [ ] Run the full verification set:

```powershell
.\.venv\Scripts\python.exe -m ruff check backend tests
.\.venv\Scripts\python.exe -m ruff format --check backend tests
.\.venv\Scripts\python.exe -m pytest tests -q
cd frontend
npm.cmd run lint
npm.cmd run format:check
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

- [ ] Fix only failures caused by the version-1 trim-editor changes, then rerun the affected checks.

## Implementation Stop Point

After this plan is approved, implementation should proceed task by task. Do not
commit, push, deploy, install global dependencies, or change system settings.
If a new dependency appears necessary, stop and explain the package, scope, and
reason before installing it locally.
