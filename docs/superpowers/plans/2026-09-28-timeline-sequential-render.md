# ReelWeave Milestone 2 Timeline Sequential Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the uploaded Video 1 timeline plan render through ReelWeave's existing FastAPI and FFmpeg job flow as one ordered H.264/AAC MP4.

**Architecture:** Extend the existing multipart merge manifest with an explicit clip-ID permutation and supported output FPS. Parse that contract into a small backend plan object, reorder the existing job inputs and edits together, and parameterize the current media pipeline; keep React `App` as the sole owner of edits, audio, FPS, and job submission while TimelineDemo delegates to the same merge callback.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, FastAPI, Python dataclasses, pytest, FFmpeg/FFprobe.

**Spec:** `docs/superpowers/specs/2026-09-28-timeline-sequential-render-design.md`

## Global Constraints

- Render only real uploaded Video 1 clips; sample storyboard cards never enter request data.
- Render only sequential MP4 output. Do not implement Video 2 overlays, multi-track rendering, or MOV output.
- Preserve inclusive source-frame trims, speeds `1`, `0.75`, and `0.5`, existing original/background-audio volume and mute behavior, job polling, preview, download, and cleanup.
- Support project FPS values `24`, `25`, `30`, `50`, and `60`; keep Auto as a UI convenience that resolves the first source rate to the nearest supported project FPS.
- Keep the Timeline Demo prototype and visual-only/multi-track notices honest.
- Add no packages, database, authentication, deployment, system changes, commits, or pushes.
- Continue from the current uncommitted files; do not reset or overwrite unrelated changes.

## File Structure

- `frontend/src/lib/clips.ts`: project-FPS types/resolution and complete merge-manifest construction.
- `frontend/src/App.tsx`: persistent FPS selection and the single merge submission/result flow.
- `frontend/src/components/TimelineDemo.tsx`: timeline FPS control and real-plan merge action; sample UI stays display-only.
- `frontend/src/components/TimelineDemo.css`: styling for the MP4 render action/status.
- `backend/app/jobs.py`: parsed manifest value objects and per-job output FPS.
- `backend/app/main.py`: manifest validation, safe ID-order mapping, and job population.
- `backend/app/media.py`: selected-FPS normalization and final H.264/AAC concat.
- Existing focused test files are extended; no parallel endpoint, renderer, or component is created.

## Review Focus

- Auto with a fractional source rate such as `29.97` must visibly resolve to supported `30` FPS and submit `30`, not an unsupported float (Task 1 and Task 4).
- Duplicate catalog IDs must be rejected even when `order` has the correct length, preventing one upload from replacing another in an ID map (Task 2).
- `order` with unknown, duplicate, or missing IDs must fail before queueing and leave no stored job (Task 2).
- Reordering must keep each stored input path paired with its own trim/speed edit (Task 2 and Task 3).
- Both per-clip normalization and final concat must use the chosen FPS; changing only one stage must fail a command-argument assertion (Task 3).

---

### Task 1: Frontend Manifest and Project-FPS Contract

**Files:**
- Modify: `frontend/src/lib/clips.ts:1-205`
- Test: `frontend/src/lib/clips.test.ts:1-165`

**Interfaces:**
- Produces: `SUPPORTED_PROJECT_FPS`, `ProjectFps`, `ProjectFpsSelection`, `resolveProjectFps(selection, firstSourceFps): ProjectFps | null`.
- Produces: `buildMergeManifest(clips: ClipEdit[], audio: AudioSettings, outputFps: ProjectFps, order?: string[]): MergeManifest` with `output_fps` and `order`.
- Consumes: existing `ClipEdit`, `AudioSettings`, inclusive frame values, and speed values without changing their semantics.

- [ ] **Step 1: Add failing FPS resolution tests**

Add focused cases proving `auto` resolves `24` to `24`, `29.97` to `30`, `59.94` to `60`, missing metadata to `null`, and explicit supported selections unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run src/lib/clips.test.ts` from `frontend`.

Expected: FAIL because `resolveProjectFps` and the project-FPS types do not exist.

- [ ] **Step 3: Implement the supported FPS resolver**

Define `SUPPORTED_PROJECT_FPS = [24, 25, 30, 50, 60] as const`. For `auto`, return `null` unless the source FPS is finite and positive; otherwise return the supported value with the smallest absolute distance. Do not add NTSC fractional rates to the backend contract.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run src/lib/clips.test.ts` from `frontend`.

Expected: all `clips.test.ts` tests pass.

- [ ] **Step 5: Add a failing complete-manifest test**

Update the existing manifest test to call `buildMergeManifest(..., 25, ['first', 'second'])` while the clip catalog remains `[second, first]`, then assert:

```ts
expect(manifest.output_fps).toBe(25);
expect(manifest.order).toEqual(['first', 'second']);
expect(manifest.clips.map(({ client_id }) => client_id)).toEqual([
  'second',
  'first',
]);
```

Retain assertions for inclusive frame values, speeds, `trim_saved`, and every audio setting.

- [ ] **Step 6: Run the manifest test and verify RED**

Run: `npm test -- --run src/lib/clips.test.ts` from `frontend`.

Expected: FAIL because the manifest lacks `output_fps` and `order`, or because the function does not accept FPS/order.

- [ ] **Step 7: Extend `MergeManifest` and `buildMergeManifest`**

Add `output_fps: ProjectFps` and `order: string[]`. Default `order` to `clips.map(clip => clip.id)` so both UI entry points produce a complete real-clip permutation; never derive it from TimelineDemo sample items.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `npm test -- --run src/lib/clips.test.ts` from `frontend`.

Expected: all `clips.test.ts` tests pass.

### Task 2: Backend Manifest Validation and Safe Ordering

**Files:**
- Modify: `backend/app/jobs.py:14-52`
- Modify: `backend/app/main.py:38-103, 178-271`
- Test: `tests/backend/test_api.py:1-130`

**Interfaces:**
- Consumes: JSON fields `clips`, `order`, `output_fps`, and existing `audio`.
- Produces: `ManifestClip(client_id: str, edit: ClipEdit)` and `MergePlan(clips: tuple[ManifestClip, ...], order: tuple[str, ...], output_fps: int, audio_mix: AudioMixSettings)` in `jobs.py`.
- Produces: `_parse_manifest(raw: object, file_count: int) -> MergePlan`.
- Produces: `Job.output_fps: int = 30`; after upload, `Job.input_paths` and `Job.clip_edits` are both in validated `MergePlan.order`.

- [ ] **Step 1: Update the API test manifest helper and add an accepted reorder test**

Make the helper include catalog IDs, `order` in catalog order, and `output_fps: 30`. Add a test that submits catalog `[clip-0, clip-1]`, order `[clip-1, clip-0]`, distinct trims/speeds, and `output_fps: 25`; capture the queued job and assert path `001` pairs with clip-1's edit first, path `000` pairs with clip-0's edit second, and `job.output_fps == 25`.

- [ ] **Step 2: Run the accepted reorder test and verify RED**

Run: `.venv\Scripts\python -m pytest tests/backend/test_api.py -k "reorders or output_fps" -v` from repository root.

Expected: FAIL because the backend ignores `order`/`output_fps` and keeps multipart order.

- [ ] **Step 3: Add failing parameterized manifest-validation tests**

Cover missing/unsupported/bool `output_fps`; non-list order; blank/non-string/duplicate catalog IDs; and order with an unknown, duplicate, or missing ID. Assert HTTP 422, the appropriate existing `invalid_manifest` code (use `invalid_fps` for unsupported FPS and `invalid_order` for unsafe permutations), no executor call, and no residual job directory.

- [ ] **Step 4: Run validation tests and verify RED**

Run: `.venv\Scripts\python -m pytest tests/backend/test_api.py -k "manifest or order or fps" -v`.

Expected: new invalid inputs are accepted or return the wrong response before implementation.

- [ ] **Step 5: Add plan dataclasses and parse the complete contract**

Implement immutable `ManifestClip` and `MergePlan`. `_parse_manifest` must preserve the existing frame, speed, `trim_saved`, and audio validation, require IDs unique in the clip catalog, require `output_fps in {24, 25, 30, 50, 60}` with booleans rejected, and require `order` to be an exact unique permutation of catalog IDs.

- [ ] **Step 6: Populate the existing job in validated timeline order**

Store multipart files once in catalog order as today. Build an internal mapping from validated catalog IDs to `(stored_path, ClipEdit)`, then assign ordered `job.input_paths`, ordered `job.clip_edits`, `job.output_fps`, and existing `job.audio_mix` before preflight and queue submission. Do not expose client IDs as filesystem names.

- [ ] **Step 7: Run the backend API suite and verify GREEN**

Run: `.venv\Scripts\python -m pytest tests/backend/test_api.py -v`.

Expected: all API tests pass, including existing upload cleanup, queue, status, preview, and download cases.

### Task 3: Selected-FPS FFmpeg Pipeline

**Files:**
- Modify: `backend/app/media.py:182-405`
- Test: `tests/backend/test_media.py:1-408`
- Test: `tests/integration/test_real_merge.py:1-240`

**Interfaces:**
- Consumes: `Job.input_paths`/`Job.clip_edits` already ordered together and `Job.output_fps` validated by Task 2.
- Produces: the same `Job.result_path` MP4 and existing audio behavior, with CFR video at `job.output_fps`.

- [ ] **Step 1: Add a failing FFmpeg argument test for FPS at both stages**

Create a two-clip job with `output_fps = 25`, probe metadata at distinct source rates, and existing fake `_run` capture. Assert every normalization `-vf` contains `fps=25`; assert the concat command has `fps=25`, `-r 25`, `-fps_mode cfr`, `libx264`, `-preset medium`, `-crf 23`, `aac`, `-b:a 192k`, and `+faststart`.

- [ ] **Step 2: Run the focused media test and verify RED**

Run: `.venv\Scripts\python -m pytest tests/backend/test_media.py -k "selected_fps" -v`.

Expected: FAIL because normalization and concat are hardcoded to 30 FPS.

- [ ] **Step 3: Parameterize the existing pipeline**

Build `base_video_filter` from `job.output_fps`, and use the same integer for concat `fps=` and `-r`. Leave trim-before-speed filters, `atempo`, resolution/padding, H.264/AAC settings, audio mix, duration calculation, and concat-file order unchanged.

- [ ] **Step 4: Run all media unit tests and verify GREEN**

Run: `.venv\Scripts\python -m pytest tests/backend/test_media.py -v`.

Expected: all media tests pass after updating hardcoded 30-FPS assertions to use the job default or explicit selected FPS.

- [ ] **Step 5: Update the opt-in real integration manifest and output assertion**

Add `order` and `output_fps` to every integration manifest. In the mixed merge, choose `25` and assert `r_frame_rate == '25/1'`; retain codec, resolution, pixel format, audio, color-order, aspect-ratio, trim/speed/music-duration, preview, download, and delete assertions.

- [ ] **Step 6: Run integration only when real tools are available**

Run tool discovery: `Get-Command ffmpeg, ffprobe -ErrorAction SilentlyContinue`.

If both exist, run: `$env:RUN_FFMPEG_TESTS='1'; .venv\Scripts\python -m pytest tests/integration/test_real_merge.py -v; Remove-Item Env:RUN_FFMPEG_TESTS`.

Expected when available: all real integration tests pass. If unavailable, do not fabricate a result; record the opt-in integration/manual render as still required.

### Task 4: Timeline Render Action Through the Existing UI Flow

**Files:**
- Modify: `frontend/src/App.tsx:35-530`
- Modify: `frontend/src/components/TimelineDemo.tsx:31-500`
- Modify: `frontend/src/components/TimelineDemo.css:280-340, 680-715`
- Test: `frontend/src/components/TimelineDemo.test.tsx:1-305`
- Test: `frontend/src/App.test.tsx:89-440`
- Test: `frontend/e2e/reelweave.spec.ts:1-210`

**Interfaces:**
- Consumes: Task 1 `ProjectFpsSelection`, `resolveProjectFps`, and extended `buildMergeManifest`.
- Produces: `TimelineDemo` props `fpsSelection`, `onFpsSelectionChange`, `canMerge`, `busy`, and `onMerge` in addition to `clips` and `musicName`.
- Produces: one `App.merge()` path used by both `MergeSummary` and `TimelineDemo`.

- [ ] **Step 1: Add failing component tests for controlled FPS and MP4-only action**

Render TimelineDemo with two editable uploaded clips and controlled `fpsSelection='auto'`. Assert `29.97` source displays effective `30 FPS`, changing to `25` calls `onFpsSelectionChange('25')`, `Merge current timeline` calls `onMerge`, the action is disabled when `canMerge` is false/busy, and the delivery control offers MP4 only. Keep assertions for the prototype notice and visual-only Video 2 controls.

- [ ] **Step 2: Run TimelineDemo tests and verify RED**

Run: `npm test -- --run src/components/TimelineDemo.test.tsx` from `frontend`.

Expected: FAIL because FPS is internal, MOV is still selectable, and no real merge action exists.

- [ ] **Step 3: Make TimelineDemo controlled and add the render action**

Remove internal FPS and format state. Resolve Auto through Task 1's helper, retain sample cards strictly as preview placeholders, display MP4 as the only real format, and add the accessible `Merge current timeline` button. The button invokes only the supplied callback; it must never construct files or manifest data.

- [ ] **Step 4: Run TimelineDemo tests and verify GREEN**

Run: `npm test -- --run src/components/TimelineDemo.test.tsx` from `frontend`.

Expected: all TimelineDemo tests pass with updated supported-FPS expectations.

- [ ] **Step 5: Add a failing App integration test for timeline submission**

Upload two files, complete their metadata, set distinct trim/speed state using existing controls, open Timeline Demo, select `25 FPS`, click `Merge current timeline`, and inspect the `/api/merge` FormData. Assert only the two uploaded `files` exist in catalog order; `manifest.order` contains only their IDs; `manifest.output_fps == 25`; clips retain inclusive frames/speeds; existing audio fields remain present; no sample name, Video 2, overlay, or MOV value occurs in serialized manifest; and the UI returns to the existing queued/processing result view.

Update the existing Playwright journey to enter Timeline Demo after arranging its generated real clips, select `25 FPS`, and start the render with `Merge current timeline`; retain its completed preview, playback, MP4 download, reset, cleanup, responsive-layout, and browser-error assertions.

- [ ] **Step 6: Run the App test and verify RED**

Run: `npm test -- --run src/App.test.tsx` from `frontend`.

Expected: FAIL because App does not own FPS or pass a timeline merge callback.

- [ ] **Step 7: Wire App state to the single merge path**

Add `fpsSelection: ProjectFpsSelection` to App, compute the supported output FPS from the first editable clip, pass it to `buildMergeManifest`, and include FPS readiness in the existing disabled predicate. Pass the same predicate and `merge` callback to TimelineDemo. On timeline submission, close TimelineDemo so existing status, preview, and download UI becomes visible. Preserve clip/audio state when merely navigating between views.

- [ ] **Step 8: Style the timeline action without redesigning the prototype**

Add only the button and disabled/busy styles needed inside the existing delivery panel. Preserve the prototype notice and the explicit visual-only overlay/track copy.

- [ ] **Step 9: Run the focused frontend tests and verify GREEN**

Run: `npm test -- --run src/App.test.tsx src/components/TimelineDemo.test.tsx src/lib/clips.test.ts` from `frontend`.

Expected: all focused frontend tests pass.

### Task 5: Contract Documentation and Full Verification

**Files:**
- Modify: `README.md:274-305`
- Verify: all modified backend/frontend files and existing suites

**Interfaces:**
- Consumes: the finalized manifest and UI behavior from Tasks 1–4.
- Produces: accurate local API documentation and a verification record for handoff.

- [ ] **Step 1: Update the existing merge API documentation**

Document required `output_fps`, exact-permutation `order`, catalog `clips`, inclusive frame ends, supported FPS values, and MP4-only sequential Video 1 behavior. State that Timeline Demo samples, Video 2 overlays, and MOV are not rendered.

- [ ] **Step 2: Run formatting checks on changed source**

Run: `npm run format:check` from `frontend`.

Expected: exit 0. If it reports changed project files, run the repository formatter only on files changed by this milestone, then rerun the check.

- [ ] **Step 3: Run the complete backend test suite**

Run: `.venv\Scripts\python -m pytest -v` from repository root.

Expected: all configured backend tests pass; report exact passed/skipped counts.

- [ ] **Step 4: Run backend lint**

Run: `.venv\Scripts\python -m ruff check backend tests` from repository root.

Expected: exit 0 with no lint errors.

- [ ] **Step 5: Run the complete frontend unit suite**

Run: `npm test` from `frontend`.

Expected: all Vitest files and tests pass; report exact counts.

- [ ] **Step 6: Run frontend lint**

Run: `npm run lint` from `frontend`.

Expected: exit 0 with no ESLint errors.

- [ ] **Step 7: Run the frontend production build**

Run: `npm run build` from `frontend`.

Expected: TypeScript project build and Vite production bundle exit 0.

- [ ] **Step 8: Run the existing Playwright frontend journey**

Run: `npm run test:e2e` from `frontend`.

Expected when Edge, FFmpeg, and FFprobe are available: the generated-video desktop/mobile timeline merge, completed preview playback, MP4 download, reset, and cleanup journey passes. Preserve pre-run copies of tracked screenshot baselines and restore those exact bytes afterward so verification does not introduce screenshot changes. If a required browser or media tool is unavailable, report the exact skip/blocker and retain the focused unit/API/integration evidence without claiming E2E passed.

- [ ] **Step 9: Review the final diff against scope**

Run: `git status --short` and `git diff --check`, then inspect `git diff` plus untracked TimelineDemo/design/plan files. Confirm no Video 2 render path, MOV output path, deployment, dependency, database, authentication, system-setting, commit, or push change was introduced.

- [ ] **Step 10: Report exact evidence and remaining manual work**

List changed files; every verification command with exit/result counts; whether real FFmpeg integration ran or was unavailable; any browser/manual 10–20 clip render still required; and explicitly confirm Milestone 3 features were not implemented.
