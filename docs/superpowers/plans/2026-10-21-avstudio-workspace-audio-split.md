# AVStudio Workspace and Audio Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after the user reviews this plan and selects an execution method. Steps use checkbox syntax for tracking. No execution is authorized by the current planning request.

**Goal:** Deliver the approved cinematic workspace and editable audio splits with faithful preview and MP4/MOV/WAV/MP3 exports.

**Architecture:** Extend existing audio occurrences, history transactions, source leases and playback mapping. Use the approved minimal render-manifest V4 extension for multiple music sources; retain V1–V3 rendering and read portable project V1 while writing V2. Style existing mounted editor regions against the attached reference without a new workspace framework or playback rewrite.

**Tech Stack:** Existing React 19/TypeScript, CSS, lucide-react, Vitest/Testing Library, Playwright/Edge, Python/FastAPI/pytest and installed FFmpeg/FFprobe.

**Spec:** [Approved workspace/audio-split design](../specs/2026-10-21-avstudio-workspace-audio-split-design.md), approved by the user before this planning request. Its historical proposed-status label does not undo that approval.

## Global Constraints

- Planning runs in the current workspace on `backup/avstudio-oct16`; this document is the only new deliverable of this turn. Preserve the existing untracked specification.
- No code/test implementation, commits, pushes, deployment, package installation or configuration changes now. Future execution also has no Git write/commit steps, package/configuration changes or deployment authorization. Backend tasks below are proposed future execution scope, not permission to start them now.
- “A frontend adapter may be used only when the existing backend contract can faithfully render every required split, moved, trimmed, deleted and replaced audio segment in **MP4, MOV, WAV and MP3** outputs.” Preview capability cannot reduce final-render requirements.
- Select the spec's V4 backend path: V3 requires all music segments to share one source, while a browser compilation adapter has no established decode/resource fidelity proof. Do not implement that adapter in parallel or substitute whole-lane replacement. Reconsidering this decision requires a documented fidelity result and plan revision.
- “No audio operation mutates Video 1 or Video 2 occurrences, windows, order, speed, or original-audio flags.” Detach is the existing explicit prerequisite for editing linked original audio; splitting never implicitly detaches.
- “Timeline coordinates are safe integer project frames and half-open intervals `[start, start + duration)`.” Supported project FPS stays 24/25/30/50/60; normalized source samples stay at 48 kHz.
- Preserve existing audio ownership, ripple insertion, playback/readiness/decoder continuity, Save/Open/relink, optional format availability, job errors/results/downloads and source cleanup. Keep MP4 included in the existing format-selection contract.
- “Split Audio is always visible.” Keep Timeline Tools outside tracks on the left at every width, existing 44 px minimum tool targets and no dependency on Ctrl+L.
- Do not weaken existing assertions, change timeouts/thresholds to obtain passes, skip failures, add inert reference controls, fabricate waveform/thumbnail data or perform unrelated refactoring.
- No new lanes, overlaps within an audio lane, effects, fades, automation, subframe editing, docking/resizing framework or features excluded by the spec. Reference UI acceptance and export parity are independent gates.

## Review Focus

1. Async replacement completes after Open, Undo, deletion or another replacement: stale results must not overwrite the current project (Task 5).
2. One physical source appears in both buses or many music pieces: upload/input deduplication must not lose references, double gain or create an invalid FFmpeg graph (Tasks 2–4).
3. Stereo, mono, compressed delay and partial-frame EOF: backend normalization must retain content/channel semantics and validate each piece against its own source (Tasks 3 and 10).
4. Long errors, narrow windows and 200% zoom: status must remain readable/reachable without moving the canvas/timeline or remounting media (Task 9).
5. An oracle shares the implementation's ownership/offset bug: parity checks must use independent expected events and must fail on deliberately corrupted audio (Task 10).

## Working boundaries and dependency order

Paths are repository-relative. New modules below have narrow responsibilities; do not extract playback effects or rename existing components merely to reduce file sizes.

| Boundary | Files and responsibility |
| --- | --- |
| Split eligibility/planning | New `frontend/src/lib/audioSplit.ts` and `.test.ts`; reuse `audioTimeline.ts` and `positionedEdits.ts` arithmetic/validators. No UI state or resource allocation outside an accepted candidate. |
| Source/model/history | Existing `editHistory.ts`, `advancedTimeline.ts`, `positionedEdits.ts`, `projectSources.ts`, `projectContext.ts`, `placement.ts`, `hooks/useEditHistory.ts` and `App.tsx`; every occurrence's source is authoritative. |
| Project persistence | Existing `projectFileTypes.ts`, `projectFileJson.ts`, `projectFile.ts`, `hooks/useProjectFiles.ts` only where typing requires it; versioned compatibility and atomic replacement. |
| Render contract | Existing backend `jobs.py`, `manifests.py`, `main.py`, `media.py`; add V4, reusing catalogs/uploads/job handling. Existing frontend `advancedManifest.ts`, `api.ts`, `App.tsx`; choose V4 only for multiple music sources. |
| Audio rendering | Existing backend `render_plan.py`, `audio_composition.py`, `advanced_media.py`; source-indexed music validation/placement into the existing audio master. Picture resolution/encoding semantics stay unchanged. |
| Controls/layout | Existing `EditingWorkspace.tsx/.css`, `ProjectTimeline.tsx/.css`, `IndependentAudioTrack.tsx`, `PositionedTrack.tsx`, `PositionedClipEditor.tsx`, `Inspector.tsx`, `ProgramMonitor.tsx`, `MediaBin.tsx`, `App.tsx`, `styles.css`; reuse mounted regions and callbacks. |
| Independent parity evidence | New `frontend/e2e/audio-edit-parity.spec.ts`, `frontend/e2e/audioParityFixtures.ts`, `tests/integration/test_v4_audio_exports.py`; extend existing tests/fixtures where noted below. No product-only diagnostic API. |

Order: baseline → split planner → V4 parser → render graph → source/manifest routing → history/replacement → persistence → contextual UI → preview regression → visual/layout work → parity journeys → full verification. No parallel agent work is selected by this plan. Each task gets its own RED/GREEN review checkpoint; no commits. A passing existing behavior is a characterization result, not an instruction to rewrite it.

**Command convention:** `npm.cmd` commands run from `frontend`; `.venv/Scripts/python.exe` commands run from repository root. Paths in commands follow that convention. Focused tests must fail for the intended missing behavior before production edits, then pass without weakening assertions. Record exact failures/pass counts and affected files in `docs/avstudio-workspace-audio-split-verification-2026-10-21.md` during execution, not now. Preserve evidence under `var/avstudio-workspace-audio-split/`.

### Task 0: Establish current behavior and the export-contract gate

**Files:** Read approved spec, this plan, current source/tests and existing playback evidence. Future execution creates the verification document above; no product changes.

**Interfaces:** Consumes current branch/HEAD/status, installed test tools and the attached reference. Produces a baseline record distinguishing current results from historical reports.

- [ ] Record `git status --short --branch`, `git rev-parse HEAD`, `ffmpeg -version`, `ffprobe -version`, frontend/package scripts and backend capabilities. Do not install missing tools or change encoder/config settings; record the specific unavailable gate.
- [ ] Run `npm.cmd test -- --maxWorkers=1`, `npm.cmd run test:e2e -- --output=../var/avstudio-workspace-audio-split/baseline`, and `.venv/Scripts/python.exe -m pytest tests/backend`. Record exact failures, skips and trace locations. Check existing FFmpeg test opt-in instructions before the real-export baseline.
- [ ] Capture current populated/empty workspace at 1536x1024, plus current audio selection and status states. Keep the supplied reference available for human side-by-side review; do not replace it with generated assets.
- [ ] Record the concrete V3 limitation: `backend/app/manifests.py` rejects a music segment whose source differs from the shared catalog reference; `render_audio_master` opens one music source. Confirm V4 is the selected minimal path, with no browser adapter or narrowing of export support.
- [ ] Classify any failing preservation gate before editing its owner. Fix only a demonstrated task-relevant cause with its own failing regression; use systematic debugging if failures occur. Do not silently import old plans' broader execution authorization.

### Task 1: Shared frame-exact audio split planner

**Files:** Create `frontend/src/lib/audioSplit.ts`, `audioSplit.test.ts`; modify `audioTimeline.ts/.test.ts`, `positionedEdits.ts/.test.ts` only where their existing split validation needs correction.

**Interfaces:** Define `AudioSplitTarget = {kind: 'independent' | 'music'; id: string}`; `AudioSplitRequest = {snapshot: EditSnapshot; sources: ProjectSources; projection: AdvancedTimelineProjection; target: AudioSplitTarget | null; frame: number | null; editingLocked: boolean; gestureActive: boolean; modalOpen: boolean; limits: Limits}`; `AudioSplitPlan = {nextSnapshot: EditSnapshot; leftId: string; rightId: string}`. Export `audioSplitIssue(request: AudioSplitRequest): EditIssue | null` and `planAudioSplit(request: AudioSplitRequest, allocateId: () => string): EditResult<AudioSplitPlan>`.

- [ ] Add parameterized `split_at_exact_project_frame` tests for both lanes and each supported FPS. At 30 FPS, assert literal piece tuples `[[100,25,4800],[125,35,44800]]` for `(S,D,O,F)=(100,60,4800,125)`. Assert contiguous half-open ranges, fresh unique IDs, equal total samples and identical source recipe/provenance.
- [ ] Add `rejected_split_is_observationally_unchanged`: start/end/outside/null/fractional/unsafe frames; one-frame piece; missing/stale target; linked-picture-only selection; unready source; invalid timeline/FPS; lock/gesture/modal; total segment/catalog limits. Assert `allocateId` is not called for ineligible requests, snapshot and sources are untouched, and issue lane/segment/reason are specific. Test malformed candidate IDs are rejected before commit.
- [ ] Run `npm.cmd test -- src/lib/audioSplit.test.ts src/lib/audioTimeline.test.ts src/lib/positionedEdits.test.ts --maxWorkers=1`; expected RED for the new planner, while existing correct arithmetic remains characterized.
- [ ] Implement the two pure exports, delegating existing split helpers. Validate source bounds and the candidate, retain frozen normalization FPS/trim/speed and use `O + (F-S)*48000/fps`. Return both IDs; do not mutate picture or perform history/selection changes here.
- [ ] Rerun the focused command GREEN; include repeated cuts, first/last interior frame, nonzero offsets and 1x/0.75x/0.5x frozen video recipes. Review diff against exact model invariants.

### Task 2: Minimal V4 parsing, catalogs and job routing

**Files:** Modify `backend/app/jobs.py`, `manifests.py`, `main.py`; create `tests/backend/test_v4_manifest.py`, `test_v4_api.py`; extend `tests/backend/advanced_fixtures.py`. Keep legacy tests unchanged except additive coverage.

**Interfaces:** Add frozen `MultiSourceMusicPlan(segments: tuple[MusicSegment, ...])` and `V4MergePlan` with V3 fields except `schema_version: Literal[4]` and `music: MultiSourceMusicPlan | None`. Define `ModernMergePlan = V3MergePlan | V4MergePlan`; widen existing `Job.v3_plan` typing to this union without renaming job storage. Export `parse_v4_manifest(value: dict, video_file_count: int, max_clips: int) -> V4MergePlan`. `_parse_manifest` dispatches 4 explicitly; existing V3 entry remains strict.

- [ ] Add `test_v4_accepts_per_piece_music_sources`: two catalog entries and adjacent music pieces keep distinct source IDs, exact positions/offsets and all four requested formats. Add `test_v3_still_rejects_mixed_music_sources` and legacy V1/V2/V3 acceptance characterizations.
- [ ] Add rejection cases for unknown/duplicate IDs, booleans as integers, negative/zero ranges, duplicate JSON keys, extra keys/shared music source field in V4, missing/unreferenced catalog uploads under existing rules, unsupported schema versions, invalid formats and existing source/segment/byte limits. Multipart failure must leave no queued job or leaked upload directory.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/backend/test_v4_manifest.py tests/backend/test_v4_api.py tests/backend/test_v3_manifest.py tests/backend/test_v3_api.py -q`; expect RED on V4 support, not on a fixture syntax/import accident.
- [ ] Add version-aware parsing and shared structural validation without a fake V3 payload or relaxing V3 equality checks. Update every modern-plan dispatch/upload/job branch in `main.py` and typed job storage. Deduplicate source catalogs by ID, not by filename; retain per-occurrence identities.
- [ ] Rerun GREEN. API acceptance tests may stub the worker to isolate queue/cleanup; actual V4 processing is Task 3. Record old-format compatibility and structured error evidence.

### Task 3: Source-indexed music validation and real audio rendering

**Files:** Modify `backend/app/render_plan.py`, `audio_composition.py`, `advanced_media.py`, `media.py`, and `jobs.py` only for modern-plan typing/routing. Create `tests/backend/test_v4_render_plan.py`; extend `test_audio_composition.py`, `test_advanced_media.py`; create `tests/integration/test_v4_audio_exports.py`.

**Interfaces:** Export `resolve_v4_render_plan(plan: V4MergePlan, video_sources: dict[str, VideoSourceInfo], audio_sample_counts: dict[str, int], recipe_sample_counts: dict[VideoEditRecipe, int]) -> ResolvedRenderPlan`. Widen resolved `music` to `MusicPlan | MultiSourceMusicPlan | None`; add `music_sample_counts: dict[str,int]` with a default factory, retaining legacy `music_sample_count` for existing callers. Export `build_segmented_music_graph(segments: tuple[MusicSegment,...], output_fps: int, total_frames: int, input_indexes: dict[str,int]) -> AudioGraph`; keep `build_music_graph` as the legacy single-input wrapper.

- [ ] Add `test_each_music_piece_validates_its_own_eof` and overlap/order tests: a long source must not hide another piece's short source; preserve current sub-frame EOF padding allowance. Assert picture slices and original ownership match the same pre-edit picture/independent inputs.
- [ ] Add graph tests for repeated music sources, shared original/music source, silence/gaps, out-of-export windows, mono/stereo normalization and source-input deduplication. Assert each stream is split before multiple consumption, offsets use samples, and music gain/mute is applied exactly once after placement.
- [ ] Run `.venv/Scripts/python.exe -m pytest tests/backend/test_v4_render_plan.py tests/backend/test_audio_composition.py tests/backend/test_advanced_media.py -q`; expect RED on missing multi-source validation/graph. Add a real two-source WAV render test and run it RED with FFmpeg opt-in enabled as described below.
- [ ] Implement source-indexed validation and graph routing; share existing picture/independent resolution rather than fork its algorithm. Route V4 through existing decode/normalization, audio master, encoders, download lifecycle and cleanup. Open every distinct decoded source once, including sources shared between buses. Keep existing V1–V3 graph behavior available.
- [ ] Rerun focused backend and V4 real-render tests GREEN. Assert 48 kHz stereo PCM content/channel placement, unchanged picture/duration, same master used by all output encoders and legacy tests still passing. Validate failure cleanup and optional encoder failure preserves the primary result.

### Task 4: Per-piece source reachability and V4 frontend requests

**Files:** Modify `frontend/src/lib/positionedEdits.ts`, `advancedTimeline.ts`, `placement.ts`, `projectSources.ts`, `projectContext.ts`, `advancedManifest.ts`, `api.ts`, `App.tsx`; extend their existing tests plus `frontend/src/lib/advancedManifest.test.ts`, `api.test.ts`, `projectSources.test.ts`, `projectContext.test.ts`, `placement.test.ts`, `frontend/src/App.advanced.test.tsx`.

**Interfaces:** Each `MusicOccurrence.sourceId` is authoritative. Add `requiresV4(snapshot: EditSnapshot): boolean`, true when music has more than one distinct source; `V4MergeManifest = Omit<V3MergeManifest, 'schema_version' | 'music'> & {schema_version: 4; music: null | {segments: NonNullable<V3MergeManifest['music']>['segments']}}`; `V4MergeRequest = Omit<V3MergeRequest,'manifest'> & {manifest: V4MergeManifest}`. Export `buildV4MergeRequest` with the same parameters as `buildV3MergeRequest`, returning `V4MergeRequest`, and `submitV4Merge(render: V4MergeRequest, signal?: AbortSignal): Promise<Job>`.

- [ ] Add `distinct_music_sources_survive_projection_and_submission`: literal segment source IDs/offsets, both uploaded files, one catalog entry per source, one original file shared across buses, no generated WAV, V4 even for MP4-only. Same filenames with different IDs stay distinct. Test source/segment/identifier/64 KiB manifest and combined audio upload limits before network submission.
- [ ] Add `history_and_project_context_keep_all_piece_sources_alive`: bin removal cannot dispose media still referenced by a piece/history/Open context; clearing the last reference releases it. Characterize whole-song replacement separately from selected-piece replacement.
- [ ] Run `npm.cmd test -- src/lib/advancedManifest.test.ts src/lib/api.test.ts src/lib/projectSources.test.ts src/lib/projectContext.test.ts src/lib/placement.test.ts src/App.advanced.test.tsx --maxWorkers=1`; expect RED on multi-source validation/routing.
- [ ] Remove runtime equality dependence on `musicSourceId`; collect IDs from every piece. Temporarily retain the legacy snapshot field until Task 6 removes it, but never use it as music truth. Factor manifest field assembly so V4 does not call a single-source legacy builder with invalid multi-source state. Choose V4 first, otherwise preserve existing V3/older routing, limits and request error mapping. No API endpoint/config change.
- [ ] Rerun focused tests plus `src/lib/positionedEdits.test.ts` and `src/lib/advancedTimeline.test.ts` GREEN. Verify submission is blocked atomically on missing media/limit failures and legacy export requests remain valid.

### Task 5: Atomic split history and selected-piece replacement

**Files:** Modify `frontend/src/hooks/useEditHistory.ts/.test.tsx`, `frontend/src/lib/editHistory.ts/.test.ts`, `frontend/src/App.tsx`, `App.history.test.tsx`, `App.advanced.test.tsx`; add music replacement cases to existing source/probe fixtures.

**Interfaces:** Add history API `splitAudio(target: AudioSplitTarget, frame: number): EditResult<{leftId: string; rightId: string}>`, calling Task 1 under current locks and committing one `Split Audio` entry. Extend existing async audio candidate flow with `replaceAudioPiece(target: AudioSplitTarget, file: File): Promise<boolean>`; use project/source generation tokens and expected target identity. Keep `IndependentAudioActions.onEdit` boolean compatibility for non-split edits; add `onSplit(target: AudioSplitTarget, frame: number): EditResult<{leftId: string; rightId: string}>` and `onReplaceMusicFile(id: string, file: File): void` at the App/UI boundary.

- [ ] Add `split_is_one_history_entry_and_redo_reuses_ids`: assert selected result is right ID, playhead remains cut frame via existing mapping, Undo restores original, redo reuses the same IDs and offsets, rejected cuts preserve redo history. Apply to both lanes, detached recipes and locked/gesture states.
- [ ] Add `replace_only_selected_half` and async race cases: preserve ID/start/duration, replacement offset zero, sibling/source recipe unchanged, detached provenance cleared only on replacement. Reject too-short/unready media without a commit. Replacement finishing after Open/Undo/delete/another candidate cannot mutate the successor or leak a source lease.
- [ ] Run `npm.cmd test -- src/hooks/useEditHistory.test.tsx src/lib/editHistory.test.ts src/App.history.test.tsx src/App.advanced.test.tsx --maxWorkers=1`; expect RED for missing API/race protection.
- [ ] Implement through existing commit/transport/lease paths. Retain gesture preview/cancel as one transaction and lane-only ripple/Lift behavior. Return IDs explicitly instead of inferring the right piece from array differences. Whole-song replace remains a separate handler and label.
- [ ] Rerun GREEN; test split→move→trim→replace→ripple-delete→Undo/Redo, asserting `video1`/`video2` deeply equal their pre-audio-edit values and no detached sound reappears. Verify history eviction/clear releases unused files.

### Task 6: Portable project V2 and V1 migration

**Files:** Modify `frontend/src/lib/projectFileTypes.ts`, `projectFileJson.ts`, `projectFile.ts`, `editHistory.ts`, `hooks/useProjectFiles.ts` where required; update shared fixture typing without removing legacy fixtures. Extend `projectFile*.test.ts`, `projectFileCompatibility.test.ts`, `hooks/useProjectFiles.test.tsx`, `frontend/src/App.projectFiles.test.tsx`, `frontend/e2e/project-files.spec.ts`, their existing fixture modules and all remaining `musicSourceId` runtime call sites.

**Interfaces:** Add `PortableEditV2 = Omit<PortableEditV1,'musicSourceId'>`, `ProjectDocumentV2 = Omit<ProjectDocumentV1,'schemaVersion'|'edit'> & {schemaVersion: 2; edit: PortableEditV2}` and `ProjectDocument = ProjectDocumentV1 | ProjectDocumentV2`. Parser accepts strict V1/V2; serializer emits V2. Add `migrateProjectDocumentV1(document: ProjectDocumentV1): ProjectDocumentV2` after V1 validation; retained legacy types describe input only. Remove `musicSourceId` from live `EditSnapshot` once all consumers use per-piece IDs.

- [ ] Add `v1_music_migrates_without_timing_change` and `v2_round_trip_preserves_every_audio_window`: literal frames/offsets/recipes/provenance/source identities, overlays, FPS, audio settings and formats. V2 rejects shared music source field, missing references, duplicate IDs/invalid ranges and future versions; V1 retains its old equality checks.
- [ ] Add atomic Open/relink tests with two music files, split detached audio, renamed/missing media, Open cancellation and failed validation. Saved data has no derived export file, transient selection or source URL. Include post-relink V4 manifest equality.
- [ ] Run `npm.cmd test -- src/lib/projectFile.test.ts src/lib/projectFileJson.test.ts src/lib/projectFileCompatibility.test.ts src/hooks/useProjectFiles.test.tsx src/App.projectFiles.test.tsx --maxWorkers=1`; expect RED on V2 support.
- [ ] Implement V1 validation→migration→normal restore, V2 serialization, complete source-role enumeration and all-source relinking. Keep current embedded/external media policy, project-context history and resource cleanup. Update user-facing unsupported-version messaging truthfully; old app versions cannot read V2.
- [ ] Rerun GREEN plus other `projectFile*.test.ts`; run `npm.cmd run test:e2e -- project-files.spec.ts --output=../var/avstudio-workspace-audio-split/project-files`. Inspect a saved V2 and migrated V1 manually; confirm legacy fixture files remain readable.

### Task 7: Visible audio tools and contextual editing controls

**Files:** Modify `frontend/src/components/EditingWorkspace.tsx/.test.tsx`, `ProjectTimeline.tsx/.test.tsx`, `IndependentAudioTrack.tsx/.test.tsx`, `PositionedTrack.tsx/.test.tsx`, `PositionedClipEditor.tsx/.test.tsx`, `Inspector.tsx/.test.tsx`, `App.tsx` and associated App history tests. Extend `frontend/e2e/timeline-drag-audio-export.spec.ts` or create `audio-split-controls.spec.ts` for dedicated action journeys.

**Interfaces:** UI consumes Task 1 eligibility and Task 5 split/replacement results. Keep `TimelineSelection`'s existing independent/music kinds. Add props/callbacks carrying those exact types; they own no duplicate snapshot or playhead state. Continue using existing selection-request/focus mechanism with returned `rightId`.

- [ ] Add `split_audio_is_visible_and_contextual`: accessible name and visible label `Split Audio`; enabled only for interior editable audio, exact visible unavailable reasons for each rejected state. Picture selection cannot invoke audio split. `Split Video` retains picture behavior. Linked audio shows visible Detach Audio; no Ctrl+L listener is added.
- [ ] Add keyboard/click tests for right-piece selection/focus, unchanged cut position, both halves' move/trim/replace, lane-only Delete/Backspace, explicit Lift, minimum-length pieces, modal/input exclusions and render locks. Assert muted/volume labels say which bus they affect and Resume Audio remains reachable.
- [ ] Run `npm.cmd test -- src/components/EditingWorkspace.test.tsx src/components/IndependentAudioTrack.test.tsx src/components/PositionedTrack.test.tsx src/components/PositionedClipEditor.test.tsx src/components/Inspector.test.tsx src/App.history.test.tsx --maxWorkers=1`; expect RED for dedicated control/selected-piece music replacement.
- [ ] Wire the existing controls to the typed planner/history results. Provide keyboard-accessible reasons beside disabled native buttons and real hover/focus tooltips. Do not route audio through picture edits or reset a music lane on per-piece replacement.
- [ ] Rerun GREEN and the dedicated browser journey. Verify labels/icons outside uninterrupted tracks and real source/range data in Inspector; no screenshot-only fake controls.

### Task 8: Preview continuity and ownership through audio edits

**Files:** Extend `frontend/src/hooks/useProjectAudio.test.tsx`, `usePreviewMedia.test.tsx`, `useProjectPlayback.test.tsx`, `frontend/src/components/ProgramMonitor.test.tsx`, `frontend/e2e/playback-continuity.spec.ts`; modify corresponding production hooks only if these tests demonstrate a specific missing behavior.

**Interfaces:** Preserve `useProjectAudio({snapshot,sources,projection,transport})`, `resolveAudioOwnership` and the existing live transport/generation/positionRevision contract. New occurrence identity is not a changed decoder mapping when source/time/speed are continuous.

- [ ] Add `continuous_audio_split_does_not_restart_native_voice`: split a playing audio occurrence while preserving source mapping; assert no new source load/seek/pause, one audible owner per bus, unchanged picture media identity and cut-time continuity. Cover music and frozen original at 1x/0.75x/0.5x.
- [ ] Add boundary preview tests for move/trim/delete/replace, muted winning original owner, detached-original deletion, independent overlays and additive music. Retain deferred play completion tests for stale generations, real NotAllowedError/decode failure and explicit Pause winning over pending work.
- [ ] Run `npm.cmd test -- src/hooks/useProjectAudio.test.tsx src/hooks/usePreviewMedia.test.tsx src/hooks/useProjectPlayback.test.tsx src/components/ProgramMonitor.test.tsx --maxWorkers=1`; missing behavior must produce a focused failure. If all new cases already pass, retain characterization and do not rewrite playback.
- [ ] Fix only any demonstrated ownership/mapping/readiness defect; preserve source leases, voice pools and media nodes. Do not change playback clocks or synchronization thresholds to accommodate the feature.
- [ ] Run focused tests GREEN and `npm.cmd run test:e2e -- playback-continuity.spec.ts play-pause-baseline.spec.ts pause-resume-readiness.spec.ts --output=../var/avstudio-workspace-audio-split/playback`. Existing residual/audio tolerances remain unchanged; unresolved failure blocks continuity acceptance.

### Task 9: Reference-aligned shell and invariant status geometry

**Files:** Modify `frontend/src/styles.css`, `App.tsx` presentation, `components/EditingWorkspace.tsx/.css`, `ProjectTimeline.tsx/.css`, `MediaBin.tsx`, `Inspector.tsx`, `ProgramMonitor.tsx`, and existing presentational control classes only as needed. Extend `ProgramStatus.test.tsx`, `EditingWorkspace.test.tsx`, `MediaBin.test.tsx`, `frontend/e2e/professional-workspace.spec.ts`, `reserved-preview-status.spec.ts`, `avstudio.spec.ts`. No new layout state framework.

**Interfaces:** Existing mounted region IDs/keys/refs/callbacks are protected. One permanent status area for each picture/audio/tool reason region; its reserved dimensions belong to the responsive shell, not preview state. Expose full wrapping error text/recovery via bounded internal scrolling where needed.

- [ ] Before styling, add browser geometry assertions: at each fixed viewport, monitor/canvas/timeline rectangles stay unchanged within 1 CSS px rounding tolerance across ready/preparing/playing/paused/resume-required/failed, long errors and Split Audio enablement. Assert the left rail never enters/scales tracks, all tracks share ruler alignment, and hidden→shown messages do not alter panel sizing. Force states with existing test fixtures, not product delays or injected corrective CSS.
- [ ] Run `npm.cmd run test:e2e -- professional-workspace.spec.ts reserved-preview-status.spec.ts avstudio.spec.ts --output=../var/avstudio-workspace-audio-split/layout-red`; retain relevant RED geometry/control evidence. Add component tests asserting media instances survive status/responsive updates and every required action remains reachable.
- [ ] Apply spec palette (`#050c14`, `#09131e`, `#0c1926`, `#203446`, `#e7edf6`, `#a7b7ce`, `#00bfff`, `#087fff`), 4–6 px corners, 52–60 px app bar, 36–44 px headings, 8–12 px gutters and compact labels. Target upper panels 27/46/27 at spacious desktop, with narrower side panels at smaller widths; timeline gets one third to two fifths of usable height subject to existing lane geometry. Keep logo, real media, original lane order and 44 px tool targets.
- [ ] Keep the monitor's picture dominant, Inspector fields aligned, Media Bin compact, and all tools labelled with real hover/focus/disabled behavior. Preserve status slots and full recovery text. No fake search/Record/avatar/effects/meter/zoom UI; no copied reference media or waveform artwork. No new keyboard modes, media remounts, broad glow or gradients.
- [ ] Rerun layout/component tests GREEN. Capture side-by-side reference review at 1536x1024, 1440x900 and 1920x1080; also verify 1280x720, 768x1024, 320x800, short-window scrolling, reduced motion and 200% zoom. Check contrast (4.5:1 ordinary text, 3:1 meaningful control boundaries), focus/tooltips, full filenames/errors, native click/drag alternatives, no page overflow and unchanged time-to-pixel mapping. Record required adaptations from the reference and any unmet criterion; screenshots alone are not a geometry or functionality pass.

### Task 10: Independent audio parity matrix and all-format export journeys

**Files:** Create `frontend/e2e/audioParityFixtures.ts`, `audio-edit-parity.spec.ts`; extend `frontend/e2e/mediaFixtures.ts`, existing project fixtures and `tests/integration/test_v4_audio_exports.py` from Task 3. Reuse `tests/integration/advanced_fixtures.py` and existing decoded-audio helpers without replacing their ownership assertions.

**Interfaces:** Test-only fixtures define `ExpectedAudioEvent = {lane: 'original'|'music'; sourceId: string; timelineStartFrame: number; durationFrames: number; sourceStartSample: number; gain: number}`. Export fixture helpers `generateAudioParityMedia(folder: string): {picture: string; sourceA: string; sourceB: string; stereo: string; compressed: string}` and `capturePreviewPcm(page: Page, durationFrames: number, fps: number): Promise<{sampleRate: number; channels: Float32Array[]; projectStartSeconds: number}>`. Capture actual post-gain Web Audio output using a test-injected audio capture sink/worklet at context initialization; leave the native destination connected and add no product instrumentation/package. Store channel PCM and timing anchors as evidence.

- [ ] Build independently specified event maps with tone windows, silence, impulses, asymmetric stereo and two different music files. Test the oracle first: deliberately shift an offset by one frame, remove/double a piece, restore detached linked sound and swap channels; every corruption must fail. Never derive expected events from `resolveAudioOwnership`, the render plan or the edited snapshot under test.
- [ ] Add failing real journeys for split, move, start/end trim, ripple delete plus Lift, and replacement. For each lane category (detached original, independent file, music), operate the real editor, capture preview PCM, render the same committed snapshot and download/decode MP4/MOV/WAV/MP3. Assert both preview and exports against the independent map, not just against each other. If behavior already passes, retain characterization rather than manufacture a failure.
- [ ] Run backend integration RED/GREEN with real FFmpeg and `npm.cmd run test:e2e -- audio-edit-parity.spec.ts --output=../var/avstudio-workspace-audio-split/parity`. Keep each browser journey within the existing 120-second test budget by using short fixtures and separate cases, not longer timeouts or reduced assertions.
- [ ] Cover every supported project FPS for each edit/lane/format in backend parameterized tests. Browser journeys cover each edit/lane/format and all FPS overall, plus frozen recipes at 1x/0.75x/0.5x, repeated cuts, nonzero offsets, near-export EOF and a combined sequence after Undo/Redo and Save/Open/relink. Validate unchanged picture packets/decoded frames/duration with the existing format-appropriate oracle, including preserved ripple insertion before audio edits.
- [ ] Require exact window/sample positions in model/PCM-master/WAV fixtures using existing PCM quantization bounds. For lossy MP4/MOV/MP3, use existing sound-oracle energy ratio 0.7–1.3, wanted/unwanted tone ratio greater than 20, silence energy below `1e-7`, and impulse error at most 10 ms on normalized fixtures. Measure codec priming/padding independently on an unedited control, freeze per-format allowances before edited results, and do not optimize alignment against the edited output. Retain existing browser 40 ms continuity/50 ms sound-alignment bounds where applicable; do not relax them or use codec delay to excuse a wrong edit.
- [ ] All matrix cases must pass with real audio, including original/music gains once and no restored/doubled owner. Capture listening evidence at untouched split boundaries and inspect real picture output. A browser capture/encoder unavailable in this environment is an explicitly incomplete gate, not permission to substitute transport observations or skip a format. Correct any defect through a failing regression in its owning task.

### Task 11: Complete regression and review handoff

**Files:** Update only the future verification document/evidence references unless an actual regression requires a new RED/GREEN fix in its owning task. Read the final full diff against the approved spec and this plan.

**Interfaces:** Consumes all task evidence; produces a reviewable diff, exact verification counts, visual comparison notes, fidelity matrix and remaining limitations. No merge/commit/push/deploy action.

- [ ] From `frontend`, run `npm.cmd test -- --maxWorkers=1`, `npm.cmd run lint`, `npm.cmd run format:check`, and `npm.cmd run build`. Run commands separately; expected exit 0. Format only changed files with installed tools if needed, without repository-wide rewrites.
- [ ] From root, run `.venv/Scripts/python.exe -m pytest tests/backend -q`. Then run `.venv/Scripts/python.exe -m pytest tests/integration -q` with the existing `RUN_FFMPEG_TESTS=1` process-only opt-in: preserve its prior environment value and restore it afterward. This is not a configuration-file change. Require real FFmpeg tests to execute; report every skip/capability gap instead of a misleading green count.
- [ ] From `frontend`, run `npm.cmd run test:e2e -- --output=../var/avstudio-workspace-audio-split/final`. Require complete retained assertions, unchanged deadlines, no waived failures and no new skips. Compare baseline failures honestly; baseline status does not exempt a required milestone contract.
- [ ] Review populated/empty/audio-selected/error/locked/export-result captures against the attached reference, geometry data, preview capture and four-format audio parity artifacts. Report any manual listening or visual gap explicitly. Confirm legacy Save/Open, V1–V3 requests, optional export failure recovery, source disposal and Video 1 ripple insertion still work.
- [ ] Run `git diff --check` and `git status --short`; inspect diff for packages/configuration/unrelated changes, accidental source assets and test weakening. Record exact counts, files changed, path selection (V4), compatibility limits (old apps cannot open project V2), reference adaptations and unresolved gates. Do not claim full completion with any required gate unresolved.
- [ ] Present results for user review. Do not stage, commit, push, deploy, create a PR, install tools or change configuration. A later integration action needs separate user direction.

## Plan self-review and handoff

Spec coverage: data/split invariants → Tasks 1/5; per-piece edits/source lifetime → 4/5; Save/Open → 6; minimal faithful backend and every format → 2/3/4/10; visible controls → 7; live preview/ownership → 8; reference hierarchy/density/colour/interaction and stable layout → 9; regressions/out-of-scope enforcement → 0/11. Each Review Focus condition has a named owning test task. Interfaces use the same target/result, V4 request, music segment and project-version definitions across task boundaries.

This plan is ready for review, not execution. Native sequential execution is recommended because model/history/persistence/render changes share interfaces and need gates between them. The user has not selected an execution method for this milestone; select native execution or explicitly requested subagent-driven execution after reviewing the plan. No subagents, implementation tests, product edits or verification suites were run to produce this document.
