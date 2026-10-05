# ReelWeave Milestone 3 Multi-Track Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render one image/logo overlay and one video/PIP overlay on the real Video 1 sequence while preserving the existing clip, audio, job, MP4 preview/download, safety, and cleanup behavior.

**Architecture:** Extend the existing `/api/merge` manifest and multipart request with two optional, independently scheduled overlays. Keep the current Video 1 normalize/concat pipeline, add one frame-exact FFmpeg composition pass before the existing Audio 2 mix, and make React own the matching overlay editor and preview state.

**Tech Stack:** Python 3.11+, FastAPI/Starlette, FFprobe/FFmpeg, pytest, React 19, TypeScript, Vite, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-reelweave-milestone-3-multitrack-composition-design.md`

## Global Constraints

- **Execution authority:** Do not commit, push, deploy, install packages, or change system settings unless Veeresh explicitly approves.
- Do not add a second render endpoint or job flow.
- Preserve inclusive Video 1 source-frame trims, speeds `1`, `0.75`, and `0.5`, project FPS values `24`, `25`, `30`, `50`, and `60`, original audio, background music controls, queue/status behavior, preview/download, deletion, and retention cleanup.
- Video 2 supports at most one PNG/JPG/JPEG image and at most one MP4/MOV/WebM/MKV PIP; the two may coexist, with PIP below the image.
- Overlay schedules use zero-based inclusive project frames and explicit half-up rounding: `floor(x + 0.5)`.
- A PIP begins at its scheduled start frame. If the PIP source reaches EOF before its scheduled end frame, it becomes transparent/absent for the rest of that scheduled range. It never freezes its final frame.
- Output remains 1280×720 SDR H.264/AAC MP4; MOV remains Milestone 4.
- Keep generated storage names, argument-list subprocess execution, bounded streaming, restricted protocols/demuxers, sanitized errors, and subprocess timeouts.
- Remove the five prohibited marketing/tagline blocks from all normal views and replace them only with the compact professional workspace header specified in the design.
- Do not introduce arbitrary layers, free positioning, keyframes, effects, overlay audio, persistence, authentication, or other out-of-scope editor behavior.

## File structure

- Create `backend/app/timeline.py` for the backend’s deterministic project-frame math.
- Create `backend/app/composition.py` for pure overlay size/position/filter-graph construction.
- Create `frontend/src/lib/overlays.ts` and `frontend/src/lib/overlays.test.ts` for frontend overlay types, defaults, validation, and matching frame math.
- Create `frontend/src/components/OverlayTrack.tsx` for the two Video 2 editor slots.
- Modify `backend/app/jobs.py`, `config.py`, `main.py`, and `media.py` only for the new plan/job data, safe upload contract, preflight, and staged render.
- Modify `frontend/src/lib/clips.ts`, `lib/api.ts`, `App.tsx`, `TimelineDemo.tsx`, and the existing styles/tests to connect the editor, manifest, submission, and preview.
- Extend the existing backend, real-media, component, app, and Playwright tests instead of creating a parallel test harness.

## Review Focus

- An allowed filename containing the wrong decoded media type must fail preflight with a sanitized 422 and leave no job directory; Task 3 adds this test.
- Backend trim clamping can shorten a project after the browser accepted an overlay range; the backend must reject the now-out-of-bounds range rather than clip it; Task 3 adds this test.
- Replacing or removing overlays repeatedly must revoke exactly the superseded object URLs while preserving the current URL and schedule; Task 6 adds this test.
- A short PIP must disappear at source EOF while its longer schedule remains active, and simultaneous transparent PNG boundaries must stay frame-exact with image-over-PIP z-order; Task 8 adds extracted-frame assertions.
- The combined request limit must include Video 1, music, image, video, and multipart overhead without weakening existing limits; Tasks 1 and 2 add calculation and request-rejection tests.

---

### Task 1: Backend frame clock, overlay domain types, and limits

**Files:**
- Create: `backend/app/timeline.py`
- Modify: `backend/app/jobs.py`
- Modify: `backend/app/config.py`
- Test: `tests/backend/test_media.py`
- Test: `tests/backend/test_config_storage.py`
- Test: `tests/backend/test_api.py`

**Interfaces:**
- Produces: `round_half_up(value: float) -> int` and `project_frame_count(selected_source_frames: int, source_fps: float, speed: float, output_fps: int) -> int`.
- Produces: `OverlayPosition`, `OverlaySize`, and frozen `OverlaySettings(start_frame, end_frame, position, size)` in `backend.app.jobs`.
- Produces: optional `image_overlay` and `video_overlay` on `MergePlan`; `image_overlay_settings`, `image_overlay_path`, `video_overlay_settings`, `video_overlay_path`, and `total_project_frames` on `Job`.
- Produces: `max_overlay_image_file_size_bytes` (20 MiB default), `max_overlay_video_file_size_bytes` (200 MiB default), MiB properties, request-size accounting, and matching health limits.

- [ ] **Step 1: Write failing backend contract tests**

Add focused assertions for half-up ties, speed/FPS conversion, immutable overlay settings, default limit values, environment overrides, total request-size arithmetic, and health JSON keys:

```python
assert round_half_up(2.5) == 3
assert project_frame_count(5, source_fps=2, speed=1, output_fps=1) == 3
assert project_frame_count(1, source_fps=60, speed=1, output_fps=24) == 1
assert settings.max_overlay_image_file_size_mb == 20
assert settings.max_overlay_video_file_size_mb == 200
```

- [ ] **Step 2: Run the focused tests and confirm the new imports/keys fail**

Run: `python -m pytest tests/backend/test_config_storage.py tests/backend/test_api.py::test_health_exposes_tool_availability_and_client_limits tests/backend/test_media.py -q`

Expected: FAIL because `timeline.py`, overlay job fields, and overlay limit keys do not exist.

- [ ] **Step 3: Implement the frame helpers, job types, configuration, and health fields**

Implement the exact interfaces above. Validate both new byte limits as positive in `Settings.__post_init__`, load `REELWEAVE_MAX_OVERLAY_IMAGE_FILE_SIZE_MB` and `REELWEAVE_MAX_OVERLAY_VIDEO_FILE_SIZE_MB`, and add both maximums to `max_request_size_bytes` plus per-part overhead. Do not change existing defaults or response fields.

- [ ] **Step 4: Run the focused tests**

Run: `python -m pytest tests/backend/test_config_storage.py tests/backend/test_api.py::test_health_exposes_tool_availability_and_client_limits tests/backend/test_media.py -q`

Expected: PASS.

- [ ] **Step 5: Inspect the backend-contract task scope**

Run: `git status --short`

Expected: only the Task 1 files listed above and pre-existing approved documentation changes appear; do not stage or commit them.

### Task 2: Manifest parsing and safe overlay upload handling

**Files:**
- Modify: `backend/app/main.py`
- Modify: `tests/backend/test_api.py`

**Interfaces:**
- Consumes: `OverlaySettings`, `MergePlan.image_overlay/video_overlay`, and configuration limits from Task 1.
- Produces: `_parse_overlay_settings(value: object, kind: str) -> OverlaySettings | None` and an extended `_parse_manifest(raw, file_count) -> MergePlan`.
- Produces: optional multipart fields `overlay_image` and `overlay_video`, stored at generated paths and attached to the `Job`.

- [ ] **Step 1: Write failing API tests for all manifest/file pairings**

Cover no overlays, image only, video only, both, omitted `overlays`, valid one-frame schedules, unknown keys, missing/extra fields, boolean/float/negative/reversed frames, invalid enums, duplicate parts, descriptor/file mismatches, unsupported extensions, empty/oversized parts, hostile filenames, and cleanup/file closure. Assert representative payloads:

```python
assert captured.image_overlay_settings == OverlaySettings(0, 0, "top-right", "small")
assert captured.image_overlay_path.name == "overlay-image.png"
assert captured.video_overlay_path.name == "overlay-video.mp4"
```

Also assert OpenAPI lists both optional binary fields and `max_files` permits primary clips plus music plus both overlays.

- [ ] **Step 2: Run the API tests and confirm overlay cases fail**

Run: `python -m pytest tests/backend/test_api.py -q`

Expected: existing tests pass and new overlay tests FAIL because descriptors and parts are ignored or rejected.

- [ ] **Step 3: Implement strict parsing, pairing, streaming, and cleanup**

Accept only `image` and `video` keys; require exactly `start_frame`, `end_frame`, `position`, and `size` in non-null descriptors. Add extension sets for still images and reuse the primary video extension set for PIP. Use one bounded upload-copy helper for clips, music, and overlays while preserving their distinct limits/error codes. Validate part counts/presence before storing, update the OpenAPI schema, and leave all partial-job removal in the existing exception path.

- [ ] **Step 4: Run the API tests**

Run: `python -m pytest tests/backend/test_api.py -q`

Expected: PASS with the existing API tests unchanged in meaning.

- [ ] **Step 5: Inspect the upload-contract task scope**

Run: `git status --short`

Expected: Task 2 changes are limited to `backend/app/main.py` and `tests/backend/test_api.py`, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 3: Authoritative overlay preflight and project bounds

**Files:**
- Modify: `backend/app/media.py`
- Modify: `tests/backend/test_media.py`
- Modify: `tests/backend/test_api.py`

**Interfaces:**
- Consumes: `project_frame_count`, overlay job paths/settings, and current primary/media probes.
- Produces: `_probe_image(source: Path) -> dict[str, Any]`, `_validate_overlay_dimensions(metadata, label) -> None`, and an extended `validate_job(job) -> None` that sets `job.total_project_frames`.

- [ ] **Step 1: Write failing media-preflight tests**

Test PNG and JPEG stills, valid VFR PIP, PIP audio ignored, allowed extension with wrong decoded type, APNG/animated or unsupported codec, multiple/no video streams, no finite PIP duration/frame, zero/oversized dimensions, over 40 megapixels, one-frame/final-frame ranges, and out-of-bounds ranges. Include a primary edit whose untouched end is clamped so an initially plausible overlay becomes invalid:

```python
pipeline.validate_job(job)
assert job.total_project_frames == expected_frames

with pytest.raises(InvalidMediaError, match="overlay.*project frame"):
    pipeline.validate_job(job_with_range_past_clamped_timeline)
```

Assert probe argument lists contain only `file,pipe` and the required video/still-image demuxer whitelists.

- [ ] **Step 2: Run the preflight tests and confirm missing validation failures**

Run: `python -m pytest tests/backend/test_media.py tests/backend/test_api.py -q`

Expected: FAIL because overlay media is not probed and project bounds are not calculated.

- [ ] **Step 3: Implement media probing and authoritative range checks**

Retain current primary trim clamping, calculate each clip’s frames from its probed source FPS, and sum into `job.total_project_frames`. Require exactly one PNG (`png`) or JPEG (`mjpeg`) still-image stream, one usable PIP video stream with positive finite duration/frame count, positive dimensions no larger than 8192 per axis or 40,000,000 pixels, and `0 <= start <= end < total_project_frames`. Wrap tool/read failures in the existing sanitized `InvalidMediaError` path.

- [ ] **Step 4: Run the preflight and API tests**

Run: `python -m pytest tests/backend/test_media.py tests/backend/test_api.py -q`

Expected: PASS, including partial-job cleanup when preflight rejects an overlay.

- [ ] **Step 5: Inspect the preflight task scope**

Run: `git status --short`

Expected: Task 3 changes are limited to its listed media/API files, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 4: Frame-exact Video 1 output and FFmpeg overlay composition

**Files:**
- Create: `backend/app/composition.py`
- Create: `tests/backend/test_composition.py`
- Modify: `backend/app/media.py`
- Modify: `tests/backend/test_media.py`

**Interfaces:**
- Consumes: validated `Job.total_project_frames`, `OverlaySettings`, overlay paths, and project FPS.
- Produces: `OverlayGraph(filter_complex: str, output_label: str)` and `build_overlay_graph(output_fps: int, total_project_frames: int, video: tuple[int, OverlaySettings] | None, image: tuple[int, OverlaySettings] | None) -> OverlayGraph`.
- Produces: `MediaPipeline._compose_overlays(job: Job, base_path: Path, destination: Path) -> None`.

- [ ] **Step 1: Write failing graph and pipeline tests**

In `test_composition.py`, assert all size boxes, five coordinate expressions, `D = E-S+1`, PTS offsets, escaped inclusive `between(n,S,E)`, PIP `fps/scale/trim`, `eof_action=pass`, `repeatlast=0`, still `rgba`, PIP-before-image labels, and final CFR/frame bound. In `test_media.py`, assert:

- normalized clips use `clip_project_frames` and exact seconds;
- no-overlay/no-music keeps the short path;
- overlay inputs follow base, PIP, image order;
- a PIP begins at its scheduled PTS and becomes transparent at source EOF even when `end_frame` is later;
- the overlay command maps only base audio, copies AAC audio, encodes H.264 video, and limits duration/frames;
- music runs after composition and copies composed video;
- original/music volumes and mute behavior remain unchanged;
- overlay failures retain timeout and sanitized-error behavior.

- [ ] **Step 2: Run composition/media tests and confirm they fail**

Run: `python -m pytest tests/backend/test_composition.py tests/backend/test_media.py -q`

Expected: FAIL because the graph builder and composition stage do not exist.

- [ ] **Step 3: Implement the pure graph builder and staged render**

Use these fixed boxes: small `256:144`, medium `384:216`, large `512:288`; use a 24-pixel corner margin and the approved centre expression. Bound every normalized Video 1 intermediate to its computed project frames. Offset the PIP’s first decoded frame to `start_frame`, trim long sources to the scheduled duration, and configure the overlay filter with `eof_action=pass:repeatlast=0` so a short source contributes no pixels after EOF. Compose optional PIP then optional image in one filter graph, never map PIP audio, copy base AAC audio, and end with project FPS/`yuv420p`/SAR 1. Keep existing H.264 medium/CRF 23, AAC 192 kbps/48 kHz/stereo, and fast-start behavior. Feed the composed intermediate into the unchanged background-music mix.

- [ ] **Step 4: Run backend media tests**

Run: `python -m pytest tests/backend/test_composition.py tests/backend/test_media.py -q`

Expected: PASS.

- [ ] **Step 5: Inspect the renderer task scope**

Run: `git status --short`

Expected: Task 4 changes are limited to its listed composition/media files, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 5: Frontend overlay data, validation, manifest, and multipart contract

**Files:**
- Create: `frontend/src/lib/overlays.ts`
- Create: `frontend/src/lib/overlays.test.ts`
- Modify: `frontend/src/lib/clips.ts`
- Modify: `frontend/src/lib/clips.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `OverlayKind`, `OverlayPosition`, `OverlaySize`, `OverlaySchedule`, `ImageOverlay`, `VideoOverlay`, and `OverlayState` types matching the spec.
- Produces: `projectFrameCount(...)`, `projectTotalFrames(clips, outputFps)`, `validateOverlaySchedule(schedule, totalFrames)`, and `defaultOverlaySchedule(kind, totalFrames)`.
- Changes: `buildMergeManifest(clips, audio, outputFps, overlays)` emits nullable `overlays.image/video` descriptors.
- Changes: `submitMerge(clips, manifest, uploads: { backgroundAudio?: File; overlayImage?: File; overlayVideo?: File }, signal?)` appends named parts exactly once.

- [ ] **Step 1: Write failing frontend data-contract tests**

Assert half-up tie behavior, supported FPS/speeds, summed frame counts, first/final/one-frame schedule validity, invalid total/ranges, image/video defaults, two independent descriptors, no-overlay nulls, and FormData part names. Extend `Health.limits` expectations with both overlay maximums. Inspect submitted FormData in `App.test.tsx` so files are not serialized into JSON or primary `files`.

- [ ] **Step 2: Run focused frontend tests and confirm the interfaces fail**

Run: `npm test -- --run src/lib/overlays.test.ts src/lib/clips.test.ts src/App.test.tsx`

Working directory: `frontend`

Expected: FAIL because overlay types/helpers and upload fields do not exist.

- [ ] **Step 3: Implement the pure frontend contract**

Use `Math.floor(value + 0.5)` explicitly. Keep existing clip manifest fields unchanged, always emit `overlays: { image: descriptorOrNull, video: descriptorOrNull }`, and append only populated optional files in `submitMerge`. Extend limits without changing existing API/job types.

- [ ] **Step 4: Run focused frontend tests**

Run: `npm test -- --run src/lib/overlays.test.ts src/lib/clips.test.ts src/App.test.tsx`

Working directory: `frontend`

Expected: PASS.

- [ ] **Step 5: Inspect the frontend-contract task scope**

Run: `git status --short`

Expected: Task 5 changes are limited to its listed frontend library/test files, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 6: Video 2 editor and App-owned overlay lifecycle

**Files:**
- Create: `frontend/src/components/OverlayTrack.tsx`
- Create: `frontend/src/components/OverlayTrack.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: overlay types/helpers and API submission contract from Task 5.
- Produces: `OverlayTrack` with props for image/video values, total project frames, overlay limits, disabled state, and `onSelect`, `onMetadata`, `onMetadataError`, `onScheduleChange`, and `onRemove` callbacks keyed by `OverlayKind`.
- Produces: App-owned selection, metadata, replacement, range/position/size editing, render gating, reset, and object-URL cleanup.

- [ ] **Step 1: Write failing editor and lifecycle tests**

Test both labeled slots, accepted extensions, empty/oversized/wrong-extension errors, image/video metadata success and failure, defaults, all enum choices, inclusive range errors, disabled state without Video 1 duration, invalidation after clip edits without silent clamping, replacement preserving valid settings, render gating, and submission of both overlay files. Track `URL.createObjectURL`/`revokeObjectURL` across replace, remove, reset, and unmount; assert each superseded URL is revoked once and the current URL is not revoked early.

- [ ] **Step 2: Run editor/App tests and confirm missing UI/state failures**

Run: `npm test -- --run src/components/OverlayTrack.test.tsx src/App.test.tsx`

Working directory: `frontend`

Expected: FAIL because Video 2 editor state and controls do not exist.

- [ ] **Step 3: Implement the editor and App lifecycle**

Render accessible number inputs as the authoritative inclusive range controls and selects for position/size. Default ready images to top-right/small and PIP to bottom-right/medium over the full current project. Track selections made before a valid timeline so defaults initialize once when a timeline first becomes available; later duration changes must never auto-extend or clip a user schedule. Replacements preserve only valid existing settings. Connect overlay validity to `canMerge`, manifest construction, multipart submission, and reset/cleanup.

- [ ] **Step 4: Run editor/App tests**

Run: `npm test -- --run src/components/OverlayTrack.test.tsx src/App.test.tsx`

Working directory: `frontend`

Expected: PASS.

- [ ] **Step 5: Inspect the Video 2 editor task scope**

Run: `git status --short`

Expected: Task 6 changes are limited to its listed editor/App/style files, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 7: Timeline overlay preview and professional workspace header

**Files:**
- Modify: `frontend/src/components/TimelineDemo.tsx`
- Modify: `frontend/src/components/TimelineDemo.test.tsx`
- Modify: `frontend/src/components/TimelineDemo.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: App-owned overlays, `totalProjectFrames`, and selected project FPS from Tasks 5–6.
- Produces: Video 2 lane items and program-preview layers with the renderer’s five positions and 20/30/40% bounding boxes.
- Produces: one compact header containing `ReelWeave`, `Sequence 01`, workspace navigation, and availability state, with all prohibited marketing blocks absent.

- [ ] **Step 1: Write failing timeline/header tests**

Assert image and PIP are hidden before `startFrame`, visible on the scheduled start frame, and hidden after `endFrame`. For a PIP shorter than its schedule, assert it is muted, seeks to `(projectFrame-startFrame)/fps` while its source exists, then is removed/transparent from source EOF through the scheduled end frame. Assert it sits below the image in DOM/CSS stacking and uses the selected class/position/size. Assert real Video 1 timing uses the shared frame helper. Remove assertions for fake Video 2/track controls and assert they are absent or disabled.

In `App.test.tsx`, assert these exact strings are absent in merge and timeline views:

```text
Ad Assembly Timeline
SMALL CLIPS. BIGGER STORIES.
Bring your favorite moments together in one seamless video.
Upload, arrange, and let your story unfold.
Your clips. Your story.
```

Assert the compact operational header remains usable at the existing navigation breakpoints.

- [ ] **Step 2: Run timeline/App tests and confirm preview/copy failures**

Run: `npm test -- --run src/components/TimelineDemo.test.tsx src/App.test.tsx`

Working directory: `frontend`

Expected: FAIL because the overlay placeholder/fake controls and marketing content still exist.

- [ ] **Step 3: Implement real preview layers, lane display, and header cleanup**

Pass overlay state into `TimelineDemo`, derive the playhead project frame from the shared clock, and sync muted PIP playback to its relative schedule only while relative time is less than its finite source duration. Hide/remove the PIP at source EOF even if the scheduled range continues. Position both overlay elements with renderer-equivalent percentages/margins. Show the approved approximate-preview disclosure. Replace the fake overlay/track interactions with actual lane items and honest controls. Remove the five marketing/tagline blocks rather than paraphrasing them, and retain only the specified operational header content.

- [ ] **Step 4: Run the complete frontend unit suite, lint, and build**

Run: `npm test -- --run`

Run: `npm run lint`

Run: `npm run build`

Working directory: `frontend`

Expected: all commands exit 0.

- [ ] **Step 5: Inspect the timeline/header task scope**

Run: `git status --short`

Expected: Task 7 changes are limited to its listed timeline/App/style files, alongside earlier task files and approved documentation; do not stage or commit them.

### Task 8: Real composition integration, browser workflow, and release verification

**Files:**
- Modify: `tests/integration/test_real_merge.py`
- Modify: `frontend/e2e/reelweave.spec.ts`
- Modify: `docs/verification.md`

**Interfaces:**
- Consumes: the complete backend/frontend contract from Tasks 1–7.
- Produces: deterministic real-media proof of frame boundaries, alpha/z-order, video/audio codecs, ignored PIP audio, and the full browser workflow.

- [ ] **Step 1: Write the failing real-media integration test**

Use the existing opt-in FFmpeg fixture pattern to generate tiny colored Video 1 sources with original audio, a shorter colored PIP containing a distinct audio tone, a transparent PNG with an opaque marker, and background music. Submit both overlays across a Video 1 cut. Assert FFprobe reports 1280×720 H.264, selected CFR, exact frame count, AAC stereo, MP4, and expected duration. Extract frames immediately before/at the scheduled start, immediately before/at PIP source EOF, at the later scheduled end, and at image/PIP overlap. Assert the PIP appears at its scheduled start, the base Video 1 pixels are restored from PIP EOF through the scheduled end, PNG transparency is preserved, and image-over-PIP z-order is correct. Measure/map audio so original/music controls apply and the PIP tone is absent.

- [ ] **Step 2: Run the focused integration test against the completed pipeline**

Run: `python -m pytest tests/integration/test_real_merge.py -k overlay -v`

Expected: PASS against the completed Tasks 1–7 pipeline, or SKIP only when the environment lacks FFmpeg/FFprobe. Any other failure identifies a pipeline gap that must be corrected in the owning task before continuing.

- [ ] **Step 3: Extend the Playwright workflow and verification guide**

Update the browser test to select/configure both overlay types, verify inline invalid-range blocking, inspect multipart fields, render/poll/preview/download/reset, verify the MP4-only delivery UI, and assert the prohibited marketing strings and MOV option are absent at desktop and mobile sizes. Update `docs/verification.md` with the exact backend, frontend, Playwright, and opt-in real-media commands and the expected skip rule.

- [ ] **Step 4: Run complete release verification**

Run: `python -m pytest tests/backend -q`

Run: `python -m pytest tests/integration/test_real_merge.py -v`

Run: `npm test -- --run`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run test:e2e`

Working directory for `npm` commands: `frontend`

Expected: every available suite exits 0; the real-media suite may report SKIP only for unavailable FFmpeg/FFprobe, and that skip must be stated in the handoff.

- [ ] **Step 5: Inspect final scope and hand off without repository mutation**

Run: `git status --short`

Expected: only Tasks 1–8 implementation/test/documentation files plus the approved spec and plan are changed or untracked. Do not stage, commit, push, or deploy; report the verification results and wait for Veeresh’s explicit approval for any subsequent repository or deployment action.
