# AVStudio Editing Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for later authorized inline execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes neither execution nor delegation.

**Goal:** Make AVStudio's real four-track timeline the default editing workspace while preserving validated editing, rendering, result and cleanup behavior.

**Architecture:** App keeps sole ownership of project/job state and supplies existing edit callbacks to a unified EditingWorkspace. A pure timeline projection and shared presentation hook drive ProjectTimeline and ProgramMonitor, while existing editing components populate media/inspector panels. Preserve the current API and compositor, including PIP disappearance at EOF.

**Tech Stack:** Existing React/TypeScript/Vite, Vitest/Testing Library, Playwright with installed Edge, Python/FastAPI, pytest, FFmpeg/FFprobe. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-avstudio-editing-workspace-design.md` (read in full; approved by the user, despite its historical pending-review status line).

## Global constraints

- This task writes this plan only. Do not execute its implementation steps, write application code, create assets, regenerate screenshots, install packages, change settings, commit, push or deploy. Stop for plan review.
- During later execution, no automatic staging or commit steps are included. Git commands here are read-only. No settings/configuration changes or dependency installation are required.
- Opening `/` displays a single editing workspace and one main landmark. Remove `timelineDemo`, `Timeline Demo`, `Back to Merge`, wizard navigation, sample media, generated waveforms, stale export notices and marketing panels from active UI.
- App retains clips, FPS, overlays, audio settings, health, upload/job/polling state, errors and object URL ownership. No second render pipeline, API, project model or persisted project migration.
- Four fixed tracks: Video 2, Video 1, Audio 1, Audio 2. One image/logo and one PIP maximum; image above PIP. No arbitrary tracks or timeline drag editing.
- Inclusive source trims; supported speeds `1`, `0.75`, `0.5`; Auto FPS and explicit `24`, `25`, `30`, `50`, `60`; half-up project frame math through existing helpers. Render still requires at least two clips.
- PIP must become transparent/absent at source EOF in browser preview and final MP4. Never repeat, hold, freeze or pad its last frame. Keep requested schedules intact; continue base video, image/logo and audio.
- Browser sequence preview remains silent and approximate. Completed MP4 is authoritative for composition/audio. Preserve existing 1280×720 SDR H.264/AAC MP4 output and MOV input support, with no MOV export.
- Preserve health limits, supported uploads, trim/speed editing, overlays, global original/music controls, readiness, uploads, status polling/retry, safe failures, expired jobs, preview/download, cancellation handling and cleanup. Completed projects remain locked until New project.
- Use the playback-only `resetPlayback()` and whole-project New project operations defined in Shared interfaces consistently. Individual asset removal retains its existing scoped behavior.
- Preserve `REELWEAVE_*` configuration contracts, package identity, backend module tree, paths, API/output names and historical specs/plans/evidence. Rename current product-facing text and current documentation only.
- Exclude transitions, effects, text editing, free positioning, extra overlays/music, waveform analysis, audio audition, new formats/quality options, persistence, undo/redo, database, authentication, deployment and infrastructure.

## Review focus

1. A pending middle clip must not compress subsequent timeline offsets or acquire fictional timing; Task 1 tests an all-or-unavailable projection.
2. A short PIP beginning at a nonzero frame must disappear exactly at EOF while the longer schedule and underlying composition continue; Tasks 3 and 7 test both render paths.
3. Collapsing inspector sections must preserve metadata observation and drafts; Task 4 tests metadata completion while collapsed.
4. Structural changes and New project during media lifetime must stop playback and clean up owned resources without stale selection or polling leaks; playback-only `resetPlayback()` must preserve project resources and selection. Tasks 2 and 5 cover these lifecycles.
5. Very short intervals, long names and collapsed errors must remain reachable at 320px and 200% zoom without widening the page; Tasks 6 and 8 cover access and layout.

## File map and ownership

| File | Planned responsibility |
| --- | --- |
| `frontend/src/lib/timeline.ts`, `timeline.test.ts` (new) | Pure complete-project frame projection and presentation selection types |
| `frontend/src/hooks/useProjectPlayback.ts`, `useProjectPlayback.test.tsx` (new) | One presentation clock, clamping, seeking, pause and playback-only `resetPlayback()` |
| `frontend/src/components/ProjectTimeline.tsx`, `.css`, `.test.tsx` (rename/adapt TimelineDemo files) | Real lanes/ruler/selection; remove embedded monitor/demo data |
| `frontend/src/components/ProgramMonitor.tsx`, `.test.tsx` (new) | Source/PIP playback, image visibility, silent-preview transport |
| `frontend/src/components/EditingWorkspace.tsx`, `.css`, `.test.tsx` (new) | Single main region, panel composition and responsive shell |
| `frontend/src/components/Inspector.tsx`, `.test.tsx` (new) | Persistent collapsible sections and selection reveal |
| `frontend/src/App.tsx`, `App.test.tsx` | Preserve handlers; connect shell, selection and shared playback; lifecycle tests |
| `frontend/src/components/MergeSummary.tsx`, `JobResult.tsx` | Delivery summary and result copy, without duplicate render action |
| `frontend/src/components/ClipList.tsx`, `TrimEditor.tsx`, `OverlayTrack.tsx`, `BackgroundAudioTrack.tsx`, `UploadCard.tsx` | Targeted selection/focus/error/accessibility adaptations only |
| `frontend/src/styles.css`, `frontend/index.html` | Remove obsolete marketing styles; global focus/theme and browser metadata |
| `frontend/public/branding/avstudio-icon.svg`, `avstudio-wordmark.svg` (new, later only) | Local SVG monogram, wordmark and favicon |
| `tests/backend/test_composition.py`, `tests/integration/test_real_merge.py` | Preserve and strengthen PIP EOF checks |
| `backend/app/composition.py`, `backend/app/media.py` | Read-only by default; minimal EOF correction only if regression tests prove a defect |
| `frontend/e2e/avstudio.spec.ts` (rename existing branded test) | Default-workspace real media flow, EOF and responsive/accessibility checks |
| `README.md`, `docs/verification.md`, `docs/screenshots/*` | Current AVStudio guidance and later verification evidence |

Do not modify `frontend/package.json`, lockfiles, environment files or Playwright configuration. Existing `clips.ts`, `overlays.ts` and `api.ts` contracts are consumed unchanged; their existing tests remain regression coverage.

## Shared interfaces

Define these types in `frontend/src/lib/timeline.ts` before consumers are implemented:

```ts
type TimelineSelection =
  | { kind: 'none' }
  | { kind: 'clip'; id: string }
  | { kind: 'overlay'; overlayKind: OverlayKind }
  | { kind: 'audio'; track: 'original' | 'music' };
type TimelineItem = {
  clip: ClipEdit; startFrame: number; endFrame: number; frameCount: number;
};
type TimelineProjection = {
  status: 'empty' | 'unavailable' | 'ready';
  fps: ProjectFps | null; items: TimelineItem[];
  totalFrames: number; durationSeconds: number;
};
function buildTimeline(clips: Clip[], fpsSelection: ProjectFpsSelection): TimelineProjection;
```

Export the types. `empty` means no clips; explicit FPS may resolve, but no current frame exists. `unavailable` means any clip is uneditable or FPS unresolved; return no timed items and zero project duration, while the media list retains every uploaded entry. `ready` uses the existing `isEditableClip`, `resolveProjectFps` and `projectFrameCount` helpers, including their nearest-supported Auto FPS behavior. Never replace helper math with a new rounding rule.

`useProjectPlayback(timeline: TimelineProjection, structuralRevision: number)` returns `{ frame: number | null, playing: boolean, seek(frame: number): void, toggle(): void, pause(): void, resetPlayback(): void }`. `resetPlayback()` stops playback and returns the playhead to frame 0 of the existing ready project. It preserves clips, overlays, music, job/result state, selection, settings, URLs, requests and structural revision: no project clearing, URL revocation, request cancellation/restart or revision increment. For an empty/unavailable projection, no valid current frame exists, so the hook remains stopped with `frame: null`.

EditingWorkspace owns this hook and presentation selection; App owns a monotonic structural revision incremented by successful structural edits, FPS changes and New project. This revision never enters a manifest. A change pauses and clamps playback; empty/unavailable projection clears frame and playing. Selection is reconciled against live clip IDs, overlay slots and music presence.

New project is the only whole-project clearing operation. It invokes App's existing project-clearing handler to clear clips, overlays, music, job/result state, selection and project settings, stops presentation playback, and releases owned media resources. It makes no backend job cancellation/deletion request. It is distinct from playback-only `resetPlayback()`.

`ProjectTimeline` props: `{ timeline, overlays, backgroundAudio, audioSettings, selection, frame, fpsSelection, disabled, onFpsSelectionChange, onSeek, onSelect }`, using existing `OverlayState`, `BackgroundAudio`, `AudioSettings` and `ProjectFpsSelection` types, `onSeek: (frame: number) => void`, `onSelect: (selection: TimelineSelection) => void`. `disabled` freezes project FPS changes; selection/seek remain passive operations.

`ProgramMonitor` props: `{ timeline, overlays, frame, playing, onSeek, onToggle }`, using the same types/callbacks. `Inspector` props: `{ selection, clipContent, overlayContent, audioContent, deliveryContent }`; contents are React nodes composed from App's existing state/callbacks. Clip selection details are separate from the currently previewed clip. Inspector disclosure controls keep bodies mounted, hiding presentation while preserving metadata observers.

`EditingWorkspace` props: `{ clips, timeline, overlays, backgroundAudio, audioSettings, fpsSelection, structuralRevision, editingLocked, onFpsSelectionChange, mediaContent, clipContent, overlayContent, audioContent, deliveryContent, resultContent }`. All content props are React nodes; state props use existing types and the definitions above. It owns selection, selection reconciliation and playback, composes Inspector/ProjectTimeline/ProgramMonitor, and renders the single main landmark. App keeps the header outside it and mounts TrimEditor with existing callbacks.

---

### Task 1: Pure real-project timeline projection

**Files:** Create `frontend/src/lib/timeline.ts` and `timeline.test.ts`.
**Interfaces:** Produce `TimelineSelection`, `TimelineItem`, `TimelineProjection`, `buildTimeline` above; consume existing clips/overlays helpers.

- [ ] Write failing tests named `empty_has_no_sample_timing`, `mixed_fps_trim_speed_boundaries`, `pending_middle_clip_invalidates_timing`, `unreadable_clip_invalidates_timing`, `auto_uses_first_source_only`, and `half_up_and_single_frame_match_existing_helper`.
  Assert empty Auto FPS is null, no intervals and duration zero; explicit empty 25 FPS resolves but has no frames. With 30 source frames at 30 FPS/speed 1 and 30 source frames at 60 FPS/speed 0.5, output 25 FPS produces two 25-frame slots `[0,24]` and `[25,49]`, N=50, duration=2. Pending middle metadata produces unavailable/no timed items, not two compressed ready intervals. Auto never resolves from a later clip when the first is unreadable.
- [ ] From `frontend`, run `npm.cmd test -- src/lib/timeline.test.ts`; confirm new tests fail because the projection is missing, rather than fixture/type errors.
- [ ] Implement the exact exported interfaces and all-or-unavailable projection, preserving inclusive source trims and existing helpers. No sample defaults or metadata probing.
- [ ] Repeat the focused command; expect all new cases to pass. Also run `npm.cmd test -- src/lib/clips.test.ts src/lib/overlays.test.ts` to establish unchanged frame/manifest validation.

### Task 2: Shared integer playhead and selection-safe playback

**Files:** Create `frontend/src/hooks/useProjectPlayback.ts`, `useProjectPlayback.test.tsx`; consume Task 1 interfaces. Selection integration occurs in Task 4.
**Interfaces:** Produce `useProjectPlayback` exactly as defined above.

- [ ] Write failing hook tests with fake timers: `empty_transport_disabled`, `seek_clamps_to_integer_frame`, `play_stops_at_final_frame`, `play_at_end_restarts`, `structural_revision_pauses_even_when_total_unchanged`, `shortening_clamps`, `unavailable_clears_position`, `resetPlayback_stops_and_returns_to_zero`, `resetPlayback_preserves_existing_project`, `resetPlayback_without_valid_timeline_keeps_null_frame`, `unmount_cancels_clock`.
  For N=50/FPS=25, assert seek(100) is 49, playback stops at 49, and toggling at the end starts at zero. An order change at unchanged N pauses. Call `resetPlayback()` on a still-ready projection: frame becomes zero and playing becomes false while the same projection/items/settings remain intact. On empty/unavailable projections it remains stopped with null frame. No pending timer updates after unmount.
- [ ] Run `npm.cmd test -- src/hooks/useProjectPlayback.test.tsx` from frontend; confirm failures target missing behavior.
- [ ] Implement one elapsed-time clock with integer frame derivation and a cleanup-safe animation/timer source. Derive progress from elapsed time, not accumulated rounded increments; cap at N−1. Pause on revision/status/FPS changes and keep same-project passive seeking coherent.
- [ ] Repeat focused tests; require no timer leaks or act warnings. Add a throttled-clock test: advancing elapsed time by one second at 25 FPS advances 25 frames even when callbacks were sparse.

### Task 3: Program monitor with source trim/speed and PIP EOF disappearance

**Files:** Create `ProgramMonitor.tsx`, `ProgramMonitor.test.tsx`; extract applicable preview tests from `TimelineDemo.test.tsx` without retaining samples.
**Interfaces:** Consume Task 1 projection, Task 2 playback values and ProgramMonitor props above. Produce monitor/transport presentation only; no file ownership or project editing.

- [ ] Write failing tests: `empty_monitor_no_video`, `paused_metadata_load_seeks_trim`, `speed_maps_project_time_to_source`, `cross_clip_boundary_switches_source`, `image_inclusive_boundaries`, `pip_short_source_absent_at_eof`, `pip_seek_back_before_eof_restores`, `pip_schedule_ends_before_source`, `source_error_does_not_change_render_readiness`, `pause_and_unmount_stop_media`.
  Use a clip trimmed from source frame 60 at source 30 FPS/speed 0.5: local project second 1 seeks source second 2.5. With F=25, PIP start=10, end=49 and duration=0.4s, it is present at frame 19 and absent from frame 20 through 49; seeking back to frame 19 restores it. Its descriptor remains `[10,49]`. Test source `ended` handling as well as frame-derived visibility. Image survives PIP EOF. Base and PIP elements remain muted.
- [ ] Run `npm.cmd test -- src/components/ProgramMonitor.test.tsx`; confirm failing behavioral assertions.
- [ ] Extract source playback/overlay presentation into the exact monitor interface. Resolve current clip from playhead, map source trim/speed, synchronize on loaded metadata, and hide PIP unless both scheduled range and relative source time are valid. Handle actual EOF without leaving the final frame visible; clear the EOF flag on valid backward seeking or source replacement. Preserve browser play-error messaging without blocking render. Remove storyboard/synthetic scenes and include `Add video clips to begin`, `Silent browser preview · approximate`, and distinct source-preview accessible labels.
- [ ] Repeat focused tests; all pass. Add source-replacement regression so old PIP EOF/error state cannot hide the replacement. Do not add final-mix audition or final-frame padding.

### Task 4: Real lanes and unified workspace composition

**Files:** Rename/adapt `TimelineDemo.tsx/.css/.test.tsx` to `ProjectTimeline.tsx/.css/.test.tsx`; create `EditingWorkspace.tsx/.css/.test.tsx`, `Inspector.tsx/.test.tsx`; modify `App.tsx`, `MergeSummary.tsx`, `JobResult.tsx` and `App.test.tsx`.
**Interfaces:** Produce the exact shared component interfaces above. App supplies existing editor components as panel nodes with unchanged handlers; its structural revision is presentation-only.

- [ ] Write failing tests for `default_route_is_editor`, `exact_real_lane_counts`, `overlay_sublanes_select_and_seek`, `audio_alignment_and_music_presence`, `ruler_integer_frames_and_duration_boundary`, `selection_distinct_from_playhead`, `inspector_collapsed_metadata_survives`, `removal_reconciles_selection`, `single_render_action_and_main`.
  Assert one main, no navigation switch, always-present named Sequence timeline, all four track headings, two real clips means exactly two Video 1 intervals and two Audio 1 intervals. No music means no Audio 2 interval. Overlay width uses inclusive range/N; simultaneous slots remain separately selectable, image above PIP. Audio mute is textual; original sound presence is unknown unless existing metadata proves it. Range min=0/max=N−1/step=1; duration boundary=N/F is not selectable. Click clip/overlay seeks its start and opens its inspector without changing clip order. Move playhead elsewhere without changing selected inspector item.
- [ ] Run `npm.cmd test -- src/components/ProjectTimeline.test.tsx src/components/EditingWorkspace.test.tsx src/components/Inspector.test.tsx src/App.test.tsx`; confirm new default/real-content assertions fail. Migrate obsolete demo tests to corresponding real behavior rather than retaining contradictory sample expectations.
- [ ] Implement the single shell and four real lanes. Remove sample names, sample campaign artwork, generated Waveform, dummy format select, trim handles, stale sequential-only/export-development notices and wizard/marketing views. Keep integer ticks with adaptive density and one geometry mapping; unavailable projection shows `Timeline timing unavailable`, not later compressed slots. Constrain invalid overlay overflow visually without changing frame values. Preserve true short-interval widths; provide selection through media/inspector controls.
- [ ] Wire App state/callbacks into content props; remove `timelineDemo` entirely. Inspector bodies remain mounted under collapsible native disclosures with error summaries outside hidden bodies. Provide fixed MP4 delivery, output 1280×720, duration/count/resolved FPS and exactly one `Render MP4` button using existing readiness. New project uses App's existing whole-project clearing handler, clears clips/overlays/music/job/result/selection/project settings and presentation playback, and makes no implicit backend cancellation/deletion request. Do not wire New project to playback-only `resetPlayback()`. Brand home activation preserves project state.
- [ ] Repeat focused tests; pass. Verify selected item removal clears selection; deleting music clears its selection; structural edits/FPS update revision and pause; same-ID draft/metadata survives collapsed inspector; no duplicate metadata loaders added for thumbnails.

### Task 5: Preserve upload, editing, render and cleanup lifecycle

**Files:** Modify `App.test.tsx`, relevant existing component tests; targeted changes to `App.tsx`, `ClipList.tsx`, `OverlayTrack.tsx`, `BackgroundAudioTrack.tsx`, `MergeSummary.tsx`, `JobResult.tsx` only as failures require. Keep `lib/clips.ts` and `lib/api.ts` contracts unchanged.
**Interfaces:** Existing handlers, `buildMergeManifest`, `submitMerge`, job polling and object URL ownership; consume Task 4 shell.

- [ ] Add/migrate failing app regressions for the complete workspace flow: health pending/retry and tool unavailability; rejected format/empty/oversized/count-limited selection; metadata pending/error; button reorder; inclusive trim save/cancel; all three speeds; Auto/explicit FPS; independent overlay add/replace/remove and schedule errors; original/music volume/mute; music readiness; one-clip render disabled.
  Assert render manifest order/trims/speeds/FPS/audio/overlays and named multipart files are byte-for-byte/field-for-field equivalent to the existing expected fixture. Selection/frame/revision never enter the request. Invalid overlay after shortening remains unchanged and blocks Render MP4.
- [ ] Add lifecycle tests: `timeline_visible_during_all_job_states`, `busy_and_completed_lock_edits`, `poll_failure_retry_not_resubmit`, `expired_job_can_retry`, `failed_render_preserves_project`, `completed_preview_download_and_new_project`, `resetPlayback_preserves_project_selection_job_and_resources`, `replacement_revokes_only_old_url`, `unmount_aborts_and_revokes_owned_urls`.
  Assert upload/queued/processing disable mutations, FPS and resubmission; passive seek remains available. Completed keeps timeline visible and locks editing until New project. Poll failures preserve job ID and Retry status checks the same job. Verify New project performs the complete project-clearing contract in Shared interfaces. Replace/remove/New project/unmount revoke each owned URL appropriately and preserve unrelated/current URLs until their lifetime ends. In a workspace hook harness, call `resetPlayback()` and assert only playing/frame change: clips, overlays, music, selection, audio/FPS settings, job/result, readiness, URLs, requests and structural revision are unchanged, with no URL revocation or request cancellation/restart. Do not add a new user-facing playback control merely to exercise this test.
- [ ] Run `npm.cmd test -- src/App.test.tsx src/components/OverlayTrack.test.tsx src/lib/clips.test.ts src/lib/overlays.test.ts`; confirm failures are new integration/lifecycle expectations. Preserve already-green regression tests without manufacturing failures in unchanged media logic.
- [ ] Make minimal shell/handler adaptations to satisfy readiness/locking/focus requirements. Retain health retry, upload abort, poll disposal, metadata validation, safe messages and existing backend lifecycle. Use neutral stage text: Uploading media, Queued, Rendering MP4, Render failed, MP4 ready. JobResult remains authoritative rendered preview/download, distinct from ProgramMonitor.
- [ ] Repeat focused tests and then `npm.cmd test`; all pass. Inspect the diff to ensure no rendering contract, cleanup policy or upload limit has changed.

### Task 6: AVStudio assets, UI branding and accessible controls

**Files:** Later create `frontend/public/branding/avstudio-icon.svg`, `avstudio-wordmark.svg`; modify `frontend/index.html`, `App.tsx`, `styles.css`, relevant components/tests; add `frontend/src/components/TrimEditor.test.tsx` if separate coverage is needed.
**Interfaces:** Header link accessible name `AVStudio workspace`; decorative embedded artwork; icon favicon path `/branding/avstudio-icon.svg` and wordmark path `/branding/avstudio-wordmark.svg`.

- [ ] Write failing app/accessibility assertions for AVStudio brand name, no visible or accessible ReelWeave/Timeline Demo, named regions and inputs, selected states, associated field-error/disabled-render explanations, and one polite status announcement per job stage rather than per playback frame. Add trim-dialog Escape, focus containment and focus-return tests; item removal returns focus to nearest surviving entry/upload. Opening inspector retains trigger focus.
- [ ] Add browser tests that inspect document title `AVStudio — Editing workspace`, description `Assemble video clips, overlays, and audio into an MP4 in AVStudio.`, favicon link, and successful same-origin loading of both SVGs. Assert no external SVG href/font/script/image dependency; absence of raw old-brand text in runtime accessible labels and product copy. Keep absence-test literals allowed.
- [ ] Run focused unit tests with `npm.cmd test -- src/App.test.tsx src/components/TrimEditor.test.tsx src/components/Inspector.test.tsx`; run `npm.cmd run test:e2e -- --grep "AVStudio branding"` for the new isolated browser metadata/asset test. Require clear red assertions before asset/copy changes.
- [ ] Hand-author icon at 64×64 with dark `#111827` square, ~14px corners, 8px safe margin, interlocked cyan/blue A (`#38BDF8`→`#2563EB`) and soft-white V (`#F3F4F6`). Preserve A crossbar/apex and V valley with a clean crossing separation. Wordmark ~240×64, 12px gap and path-lettered AVStudio; no external fonts or raster dependency. Use scoped IDs/intrinsic dimensions and decorative header artwork; compact header includes visible AVStudio text. Replace active breadcrumbs/footer/status copy without slogans. Preserve package/configuration names.
- [ ] Apply labels, native selected states, clear focus rings, error descriptions and TrimEditor dialog behavior; do not capture keys in fields or announce each frame. Add PIP inspector explanation for EOF-shortened visibility; it changes no schedule values.
- [ ] Repeat focused unit/browser tests; pass. Manually inspect monogram at 16/24/32/64px, letter recognition, 32px icon clear space, and no duplicate accessible name. No image-generation tool, font installation or SVG overlay-upload support is required.

### Task 7: Pin final-MP4 PIP EOF behavior without unnecessary backend changes

**Files:** Extend `tests/backend/test_composition.py`, `tests/integration/test_real_merge.py`. Only change `backend/app/composition.py` or `media.py` if a new meaningful test demonstrates an EOF defect.
**Interfaces:** Consume existing `build_overlay_graph(output_fps, total_project_frames, video, image)` and `/api/merge` pipeline; no new API or stage.

Evidence: current graph already contains `eof_action=pass:repeatlast=0:shortest=0` and no final-frame padding. Existing `test_real_overlay_boundaries_transparency_z_order_and_ignored_pip_audio` includes a post-EOF pixel assertion. Preserve these behaviors; add boundary coverage rather than rewriting the compositor.

- [ ] Add focused graph regression `test_pip_eof_never_repeats_or_pads_last_frame`: assert pass-through/no-repeat/no-shortest-truncation and absence of `tpad`/clone/loop padding in the PIP preparation path, while image alpha and z-order are unchanged. Run `.\.venv\Scripts\python.exe -m pytest tests/backend/test_composition.py -q` from root. A green result is expected for already-correct behavior; do not force a red test by breaking code.
- [ ] Extend real-media fixtures with deterministic 25 FPS base, a 10-frame/0.4s contrasting PIP beginning at project frame 10, scheduled through 49, plus a transparent image/logo and original/music audio. Extract frames 19, 20, 21 and 49: PIP region exists at 19 and shows underlying base at/after 20; image region remains visible. Use codec-tolerant color thresholds and a PIP sample pixel outside the logo. Probe exact total frames/duration/FPS/H.264/AAC and retain ignored-PIP-audio/original/music assertions.
- [ ] Add a second case ending PIP schedule before source EOF and assert inclusive scheduled end followed by absence, plus a no-overlay baseline comparison. Reuse existing fixture/extraction helpers where possible, keeping generated files under test temporary paths.
- [ ] Run the opt-in integration command from the final verification section; require actually executed checks, not skips. If new cases fail, record the specific frame mismatch before adjusting only EOF handling in the existing composition stage. Never add frame holding, frozen padding, looped PIP or shortest-output truncation. Rerun the new cases and existing real-media suite after a correction. If cases pass initially, leave backend application files unchanged.

### Task 8: Responsive, keyboard and real-workflow E2E coverage

**Files:** Rename `frontend/e2e/reelweave.spec.ts` to `frontend/e2e/avstudio.spec.ts`; modify `EditingWorkspace.css`, `ProjectTimeline.css`, `styles.css` and component semantics only as tests require. Keep existing Playwright installed-browser/config behavior.
**Interfaces:** Task 4 regions/control names; Task 6 branding; existing real-fixture and job endpoints.

- [ ] Write failing responsive checks at 1440×900, 1024×768, 899×768, 390×844, 320×640 and short desktop 1280×600. Assert media/monitor/inspector columns at ≥1280, two-column upper panels plus full-width inspector at 900–1279, and stacked DOM order below 900. `document.documentElement.scrollWidth` must not exceed viewport width at 320; timeline container alone may scroll horizontally. Long filenames and one-frame intervals remain accessible by media/inspector selection. No footer obscures controls; main actions have ≥44px hit targets. Check reduced-motion style behavior without changing system settings.
- [ ] Add keyboard-only workflow assertions for file input access, reorder, trim opening/save/cancel/Escape/focus restoration, inspector disclosure, FPS select, overlay schedules, audio sliders and Render MP4. Native seek range Arrow/Home/End updates integer frame/current-frame text. Invalid collapsed sections retain visible summary and linked error. Check screen-reader names/live region behavior with existing browser accessibility assertions; no new audit package.
- [ ] Migrate real E2E upload/configure/render/play/download/New project flow to default workspace, removing all view-switch clicks. Assert timeline visible during upload, queued/processing and completion; one submission; editing locked appropriately; downloaded MP4 playable/probe-valid; New project clears clips, overlays, music, job/result state, selection and project settings without deleting the backend result. Add browser PIP frame 19/20/backward-seek assertions using the Task 7 deterministic duration and seek values; final MP4 EOF is separately proven by Task 7 frame extraction.
- [ ] Run `npm.cmd run test:e2e` from frontend; confirm the newly introduced layout/keyboard assertions fail before styling fixes, while already-correct media behavior stays green.
- [ ] Implement exact breakpoints, approximate desktop widths 260px/flexible monitor ≥360px/300px, 16px gaps, full-width timeline ≥280px when space permits, sticky track labels, letterboxed monitor, ordinary page scrolling for short windows and no horizontal page overflow. Retain inspector mounted metadata and all mobile controls. No unsupported drag cursors, handles or inactive tools.
- [ ] Repeat E2E and component tests; pass. Manually review 200% browser zoom, keyboard-only flow and screen-reader announcements, AA 4.5:1 text/3:1 control contrast, focus visibility, tiny intervals and both overlay slots. Browser zoom is a temporary review action, not a persisted application/system setting change. Record findings rather than claiming automation proves all accessibility.

### Task 9: Current documentation and screenshot migration

**Files:** Modify `README.md`, `docs/verification.md`; regenerate later `docs/screenshots/desktop-empty.png`, `desktop-arranged.png`, `mobile-arranged.png`, `mobile-result.png`; add `desktop-result.png` if no current desktop result capture exists.
**Interfaces:** Task 8 E2E capture workflow; approved current UI and unchanged setup/configuration contracts.

- [ ] Add/migrate screenshot capture steps to real desktop empty/arranged/result and mobile arranged/result states. Assert expected workspace/status before each capture; screenshots must come from successful existing-browser tests, not mock artwork. Run E2E before replacing documented evidence.
- [ ] Update README heading and current editing instructions to AVStudio, explain `AVStudio (formerly ReelWeave)` once when linking historical material, and retain existing `REELWEAVE_*` examples explicitly as legacy configuration names. Describe default timeline, supported edits, silent preview, PIP absence at EOF and authoritative MP4 result. Update screenshot captions and verification checklist.
- [ ] Leave historical specifications/plans/execution evidence and filenames untouched, including the approved specification. Keep generated download filename/API/package identity unchanged. Confirm documentation has no normal-workflow instruction to open Timeline Demo or return to Merge and no suggestion of new formats/features.
- [ ] Inspect screenshot evidence and current docs against accepted design and test outcomes. Capture failures or missing prerequisites honestly; do not write success claims before final checks complete.

## Plan review and execution boundary

Plan self-review checks every specification section against Tasks 1–9: layout/navigation (4,8), projection/state (1–5), branding (6,9), real/approximate behavior (1,3,4,7), accessibility/responsive (6,8), migration/testing (5,7–9), scope constraints (global). Verify shared names/types remain consistent, no placeholders remain, and no automatic git mutation commands appear. Only this plan is written now. Stop and ask the user to review it; later execution requires a separate instruction.

## Complete final verification for later authorized execution

All commands below use existing tools. Run commands separately from the stated working directory. Do not install missing tools, alter configuration files, or report skipped real-media checks as passes. Record initial baseline failures, then final outcomes; resolve introduced failures before claiming completion. Repeating broad tests is necessary only after a relevant new change/failure.

- [ ] From repository root, run backend validation and formatting checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend
.\.venv\Scripts\python.exe -m ruff check backend tests
.\.venv\Scripts\python.exe -m ruff format --check backend tests
```

Expected: backend suite passes, including EOF graph tests; Ruff checks pass. Do not autoformat unrelated code.

- [ ] Run real-media tests with the existing opt-in enabled only in the child process, without setting persistent/session environment configuration:

```powershell
.\.venv\Scripts\python.exe -c 'import os, subprocess, sys; child_env = dict(os.environ, RUN_FFMPEG_TESTS="1"); sys.exit(subprocess.call([sys.executable, "-m", "pytest", "tests/integration", "-q"], env=child_env))'
```

Expected: real tests execute and pass for sequential ordering, trim/speed/FPS, image transparency/z-order, exact PIP EOF absence, continued base/image/audio, mix and MP4 preview/download/deletion. Confirm FFmpeg/FFprobe availability from test output; missing media tools leave this acceptance unmet.

- [ ] From `frontend`, run all existing frontend checks:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
npm.cmd run test:e2e
```

Expected: unit/component suites, lint, format and TypeScript/Vite build pass; installed-Edge real-flow, responsive, branding and keyboard browser checks pass. No browser installation or configuration change. Verify screenshot captures were regenerated from passing runs.

- [ ] Inspect current frontend copy and references from root:

```powershell
rg -n 'ReelWeave|Reel.?Weave|Timeline Demo|Back to Merge|SAMPLE AD|SAMPLE STORYBOARD|Multi-track export in development|Only uploaded clips on Video 1' frontend/src frontend/index.html frontend/public
rg -n 'TimelineDemo|timelineDemo' frontend/src frontend/e2e
rg -n 'eof_action|repeatlast|tpad' backend/app/composition.py tests/backend/test_composition.py
git diff --check
git diff --stat
git diff --name-only
```

Expected: first two scans have no active UI or obsolete component references; allowed absence-test literals are reviewed individually. EOF options remain pass-through/no repetition with no PIP final-frame padding. Diff has no whitespace errors. Review both tracked changes and untracked new files: no package/lock/config changes, historical-doc rewrites, unrelated backend edits or out-of-scope features. Git diff omits untracked assets/files, so inspect those explicitly before completion.

- [ ] Complete manual visual/accessibility review: icon 16/24/32/64px and wordmark; desktop/tablet/320px/short-height/200% zoom; media-to-render keyboard flow; focus/error/status announcements; contrast; long names and short intervals; both overlay slots; PIP absent after EOF in source preview and rendered result; browser silent-preview notice; MP4 playback/download/New project. Confirm whole-project clearing is exclusive to New project and playback-only `resetPlayback()` preserves project state through the hook/integration tests. Document any limitations and unexecuted checks in `docs/verification.md` without editing historical execution evidence.
- [ ] Report final changed files, meaningful test outcomes, real-media EOF evidence and any remaining unmet acceptance checks. End verification at the repository root with this read-only command:

```powershell
git status --short
```
