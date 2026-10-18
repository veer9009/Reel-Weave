# AVStudio Professional Workspace UI Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for a separately authorized implementation, task by task. Use `superpowers:subagent-driven-development` only if the user explicitly chooses delegation. Steps use checkboxes for tracking. This request authorizes the plan only; do not begin execution.

**Goal:** Refine the existing AVStudio desktop workspace's layout, density, copy, and visual states while preserving every editing, playback, render, and export behavior.

**Architecture:** Keep current components, props, callbacks, state owners, and mounted media instances. Prefer scoped CSS and small presentation-only JSX/copy edits; do not extract editor logic or add a workspace framework. Preserve the unresolved playback/audio work as the comparison baseline, not a problem to repair within UI tasks.

**Tech Stack:** Existing React 19, TypeScript, CSS, lucide-react, Vitest/Testing Library, and Playwright with installed Edge; existing FFmpeg fixtures for regression verification. No dependency or configuration changes.

**Spec:** `docs/superpowers/specs/2026-10-17-avstudio-professional-workspace-ui-design.md` (approved by the user on 2026-10-17).

## Global constraints

- This task writes only this plan. No application code, tests, screenshots, or existing documents are changed during planning. Future steps below require separate implementation authorization, including the listed presentation tests and visual captures.
- No package installs, package/lock/configuration changes, backend changes, commits, pushes, deployment, branch creation/switching, reset, stash, cherry-pick, or cleanup of existing work. Local test servers using existing configuration are verification, not deployment.
- "Preserve current timeline behavior, rendering, exports, controls, and their availability exactly."
- "Do not edit playback/audio hooks, media event wiring, source probes, decoder handling, synchronization, seeking, resume behavior, EOF logic, or unresolved playback verification assertions."
- Preserve trim, split, ripple delete, undo/redo, Video 1 version replacement, Video 2, PIP EOF, independent audio, music, reuse, and current drag/drop work in progress. Retain distinctions between keyboard deletion and lane-specific ripple actions.
- Preserve predicates, edit locks, history, gestures, source identities, object URLs, pending probes, frame mappings, FPS, durations, track order/conditional visibility, canvas composition, trim/drop geometry, export capabilities, submission, polling, recovery, results, and reset semantics.
- "MP4 remains mandatory; MOV, WAV, and MP3 retain their current optional availability and final-mix semantics."
- Existing primary and Timeline Tools targets remain at least 44px; other compact targets at least 24x24px with spacing, preferably 32px for non-timeline icons. Do not reduce timeline hit areas.
- Use current branding assets/fonts/icons and dark palette: background `#0b0d16`, card `#131622`, text `#f1f1f7`, muted `#a5a7bc`, line `#292c3f`, accent `#ad9bff`. No new assets, remote requests, decorative gradients, fake waveforms, or dashboard filler.
- Shell targets: 56px desktop bar, 12px outer padding, 8px panel gaps, approximately 240px media and 300px Inspector; 13px controls, 12px metadata, 13-14px section headings. Use a 4px spacing rhythm and 16px section separation.
- Three columns at 1280px+, media/monitor plus full-width Inspector at 900-1279px, single column below 900px. Preserve the timeline's 760px minimum inner width and internal horizontal scroll; no page overflow at 320px. Vertical scrolling is allowed.
- Normal text contrast 4.5:1; large text/meaningful control boundaries 3:1. Preserve semantic names, keyboard hints, focus behavior, recovery text, and live-region meaning.
- No new editing features, backend/export behavior, transport functions, shortcuts, docking/resizing/persistence, timeline zoom, reusable image model, or beginner/mobile mode.

## Current baseline and isolation boundary

Read-only inspection on 2026-10-17 found:

- Active branch: `backup/avstudio-oct16`.
- HEAD: `1c7777c829369840a6bd8bc8afd76a837d948584`, `WIP: preserve playback and audio regression fixes`.
- Local `origin/backup/avstudio-oct16` resolves to the same hash; no fetch was performed, so this is not a claim about live remote state.
- Prior commit: `1e689c6`, `WIP: AV Studio timeline audio and export development`; local main: `4ccc471`.
- Initial working tree: only the approved UI spec is untracked. Preserve it; do not stage it or treat it as disposable.
- HEAD includes mapping/readiness changes in `usePreviewMedia.ts`, audio mapping/gating changes in `useProjectAudio.ts`, their tests, playback diagnostics and E2E harness changes, and V3 overlay validation fixes. These are existing WIP, not UI deliverables to recreate or revert.

Current evidence sources are local ignored `var/AVStudio-verification-2026-10-17.md`, `var/verify-e2e-final.log`, `var/verify-playback.log`, focused recheck logs, and `var/e2e-full-evidence.zip`. Do not edit/remove/overwrite these. They may not accompany another checkout; this summary preserves the critical boundary. `docs/verification.md` contains older milestone evidence and silent-preview statements; it is not authoritative for current audible preview acceptance.

The local report was recorded against `1e689c6` plus working changes later preserved in `1c7777c`. Do not describe its numbers as a fresh run of current HEAD. It reports 334 frontend tests in 42 files passing serially, 216 backend/integration tests passing, and lint/format/build passing. The full E2E result was 11 passed / 9 failed. Two later focused legacy/optional-MP3 journeys passed; there is no clean full-suite result.

Seven unresolved playback cases in that full run:

| Case | Recorded failure; keep acceptance threshold unchanged |
| --- | --- |
| Same-source split, speed 0.75 | 42.117ms residual versus 40ms one-project-frame limit |
| Repeated split, speed 0.5 | Unexpected pause |
| Video 2 decoder handoff | Active URL still/equally base where replacement was expected; cause unestablished |
| Genuine buffering resume | Preparing Preview persisted after resource release; 15s assertion timeout |
| Native audio alignment, speed 1 | Maximum 58.168ms versus 50ms limit |
| Native audio alignment, speed 0.75 | Maximum 191.281ms versus 50ms limit |
| Native audio alignment, speed 0.5 | Maximum 259.174ms versus 50ms limit |

The earlier focused playback log has a different failing subset and measured values. Preserve run-specific results rather than combining them into one passing narrative. Manual audible/visual acceptance, screen-reader use, and native zoom remain pending.

**Isolation rule:** UI changes are an explicit file/hunk allowlist against the current baseline. Do not branch or roll back to main for isolation. If playback work changes while UI execution is underway, pause overlapping edits, record the new baseline, and inspect the diff; do not reconcile behavior by guessing. A known failing gate remains open. A new/different failure requires investigation and may block UI acceptance; revert only the attributable UI hunk if needed, never the WIP baseline. No playback repair is included.

## File map and interface contracts

All paths under this table are future edit candidates, not changes made by this planning task. No production file needs to be created.

| Files | Future responsibility / permitted edits |
| --- | --- |
| `frontend/src/styles.css` | Scoped application/header typography, surfaces, focus, compact controls; avoid global selectors affecting media or dialogs |
| `frontend/src/components/EditingWorkspace.css` | Desktop grid, panel spacing, aligned Inspector fields, responsive shell, monitor chrome |
| `frontend/src/App.tsx` | Header markup/copy/classes only; composed content copy where necessary; no state/handler/prop-wiring changes |
| `frontend/src/components/EditingWorkspace.tsx` | Region heading/copy/classes and existing tools' accessible descriptions only; do not alter selection, effects, shortcuts, hooks, callbacks, or props |
| `frontend/src/components/MediaBin.tsx`, `UploadCard.tsx`, `ClipList.tsx` | Compact current import/source rows, copy and names; preserve accept attributes, source model, drag/drop, readiness, and all existing controls |
| `frontend/src/components/ProgramMonitor.tsx` | Compact outer heading and transport icon/accessible-name presentation only; protected media subtree and all logic unchanged |
| `frontend/src/components/Inspector.tsx` | Compact section chrome; preserve all existing disclosures, content instances, and selection effect |
| `frontend/src/components/ProjectTimeline.tsx`, `ProjectTimeline.css` | Header/label/toolbar chrome and state contrast; preserve lane geometry, ruler, placement/gesture code, conditional lanes |
| `frontend/src/components/ExportOptions.tsx`, `MergeSummary.tsx`, `JobResult.tsx` | Compact current Delivery/result copy and layout; preserve controls, IDs, predicates, requests, per-artifact status and recovery |
| Existing component tests named in tasks | Add focused presentation/contract cases; retain every behavioral assertion |
| Create `frontend/e2e/professional-workspace.spec.ts` | UI-only layout, state visibility, focus, reflow/media identity, visual evidence; reuses `mediaFixtures.ts` unchanged |
| Create `docs/avstudio-professional-workspace-ui-verification.md` during execution | UI-specific baseline, copy/control inventory, verification results, screenshot references, known failures, and unmet targets; do not rewrite playback evidence |

Freeze all `frontend/src/hooks/*`, `frontend/src/lib/*`, source probes, track/edit behavior components, test fixtures, backend, packages/configuration, existing historical docs/assets, and `frontend/e2e/playback-continuity.spec.ts`. Run their tests unchanged. Preserve `timeline-drag-audio-export.spec.ts` and its real-worker export harness. Existing `avstudio.spec.ts` and `advanced-timeline.spec.ts` should run unchanged; retain their stable accessible labels and existing vertical tools layout to avoid needless selector churn.

Existing interfaces remain unchanged:

- `EditingWorkspace` receives the existing `mediaContent`, `clipContent`, `overlayContent`, `audioContent`, `deliveryContent`, `resultContent: ReactNode` and existing controller/action props; it adds no new controller or state.
- `Inspector` consumes existing `selection: TimelineSelection` and existing ReactNode sections; it must keep all section content mounted while collapsed.
- `MediaBin` retains `onImport(file: File, type: 'video' | 'audio'): void`, `onRemove(id: string): void`, `onPlace(draft: PlacementDraft): boolean`, and optional `onPip(file: File): void`, with existing props/types.
- `MergeSummary` retains `disabled: boolean`, `busy: boolean`, `onMerge(): void` and its current clip/timeline props. `ExportOptions` retains controlled formats/capabilities/disabled props. `JobResult` retains its existing job and `onNewProject(): void` contract.
- `ProgramMonitor` keeps its existing Props, transport/audio objects, callbacks, keys, refs, media tree, events, and effect dependencies. No public interface additions in any task.

**Two explicit scope decisions:** Keep Render MP4 in its current Delivery owner/location, using the spec's fallback: a top-bar move crosses App/EditingWorkspace/Inspector/MergeSummary ownership and would invite duplicated controls or state plumbing. Record the top-bar render placement as unmet; do not introduce a portal, duplicate button, or export drawer. Likewise, retain image upload in its current overlay workflow/owner; the left area may describe available media entry points, but do not fabricate reusable images or duplicate its file input. New project stays in its current result context under current availability.

## Review focus

1. Resize/zoom with a playing preview or pending metadata: retain the exact media nodes, Inspector drafts, selection, and current actions (Tasks 2, 4, 7).
2. Long filenames, one-frame clips, and scrolled drops: avoid widening intervals or changing frame mapping while keeping names and placement accessible (Tasks 3, 5, 7).
3. Removing apparently repetitive copy: retain destructive replacement consequences, disabled reasons, source/project units, sound/EOF limitations, and recovery (Tasks 3-6).
4. Partial export success or unavailable formats: preserve mandatory MP4, capability gates, independent results/links, and reset locks (Task 6).
5. Independent-audio Delete/Backspace versus explicit ripple; input/modal shortcut exclusions: compact icons must not merge these behaviors (Task 5).

## Execution and test policy

Execute sequentially after separate approval. Each task has a test-first gate, a minimal presentation change, and a focused check. Future test edits are limited to the listed UI coverage, not unresolved playback assertions. Characterization tests should pass before production edits; new design expectations should fail for the intended presentation reason before the corresponding change. Do not manufacture failures by changing established semantics. If an expectation already passes, retain the characterization and do not claim a red phase. CSS/layout assertions belong in the browser, not jsdom computed-layout mocks. No tests are executed during planning.

All npm commands below run in `frontend` using `npm.cmd` on Windows. Use installed tools through scripts; no `npx` command that might download tooling. No `npm run format` across the repository. If a tool/browser is unavailable or execution is denied, record the blocked gate without installing or changing configuration.

### Task 1: Freeze baseline and inventory existing controls

**Files:** Read the approved spec, files/tests above, local evidence, `frontend/package.json`, `playwright.config.ts`, and `vite.config.ts`. Future evidence: `docs/avstudio-professional-workspace-ui-verification.md`. No production edits.

**Interfaces:** Consumes current Git/source state and installed verification scripts; produces an immutable baseline identity, allowed-hunk inventory, and before-run evidence used by every later task.

- [ ] Record `git status --short`, `git branch -vv`, `git rev-parse HEAD origin/backup/avstudio-oct16`, and `git diff --name-only`. Preserve initial untracked spec/plan and any intervening user edits. Do not fetch or mutate Git.
- [ ] Inventory every visible control by region, label/accessibility name, handler, value, disabled predicate, shortcut, and recovery route. Include conditional dialogs, pending replacements, context menu, keyboard placement, audio lift/ripple, and each format. Record each proposed copy edit with retained meaning; no control deletion is permitted.
- [ ] Establish fresh frontend baseline: `npm.cmd test -- --maxWorkers=1`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run build`. Record exact exit codes/counts and pre-existing failures without repairing them.
- [ ] Preserve old ignored archives/logs before running the existing `npm.cmd run test:e2e` (normal Playwright output is replaced by later runs). Use a new UI-specific evidence location, leaving old artifacts untouched. Record all cases individually; no expectation of full green playback.
- [ ] Capture current matching-state screenshots at the viewport matrix in Task 7, and record lane/canvas/handle dimensions and time-to-pixel mapping at a fixed frame. Use existing media fixtures and an unchanged project state.
- [ ] Confirm the file allowlist and fallback decisions above in the UI verification document. This task passes when the baseline and known failure identities are recorded, not when unresolved playback becomes green.

### Task 2: Desktop shell, hierarchy, and compact header

**Files:** `styles.css`, `components/EditingWorkspace.css`, presentation markup in `App.tsx`/`EditingWorkspace.tsx`; tests `frontend/src/App.test.tsx`, `components/EditingWorkspace.test.tsx`; create `frontend/e2e/professional-workspace.spec.ts`.

**Interfaces:** Consumes existing regions/content props from the file map; produces the same mounted tree with compact shell classes. No new props or callbacks.

- [ ] Add `professional_shell_has_named_regions_and_one_submission` to App tests, reusing existing health/job mocks: one main, brand name `AVStudio workspace`, current region names, exactly one `Render MP4` button, unchanged disabled reason association, no Save/Open/extra Export action. Add a browser case `desktop_shell_uses_available_width_without_clipping` checking 56px bar at 1440x900, 12px workspace padding, 8px grid gaps, three upper columns, timeline below. New layout assertions should fail against old spacing.
- [ ] Run `npm.cmd test -- --maxWorkers=1 src/App.test.tsx src/components/EditingWorkspace.test.tsx` and `npm.cmd run test:e2e -- e2e/professional-workspace.spec.ts --grep desktop_shell`; distinguish passing characterization from expected design failures.
- [ ] Apply scoped CSS and minimal classes: full available desktop width, approximately 240px/300px side columns, flexible monitor, compact branding/status. Retain heading semantics, shrink duplicate sequence-heading emphasis, and keep one compact visible sequence identifier in its existing timeline context. Use an accessible existing heading for the main workspace rather than blanket hiding headings. Keep Render/New project in their current owners as decided above.
- [ ] Repeat the focused commands; expect new layout checks and prior passing contracts to pass. Compare initial lane/canvas mapping measurements: no time scaling or canvas-composition change. Aim for about 40% usable height for timeline at 1440x900 through shell allocation/scrolling, never smaller lanes; record any geometry constraint preventing that target.

### Task 3: Compact Media Bin and verified text reduction

**Files:** `MediaBin.tsx`, `UploadCard.tsx`, `ClipList.tsx`, scoped existing CSS; tests `MediaBin.test.tsx`, `ClipList.test.tsx`, `App.test.tsx`, new UI E2E file. Do not change `TimelineDropZone` logic colocated in `MediaBin.tsx`.

**Interfaces:** Existing import/append, import/reuse, placement, removal, and PIP callbacks unchanged; no image-bin model.

- [ ] Add `compact_bin_keeps_source_specific_actions_and_loading_errors` using `advancedFixture()` and existing ready/loading fixtures. Assert compact visible heading `Media Bin`, full long filename in accessible names, Place on Track, source-specific removal/PIP names, loading status, disabled placement, and metadata-error remedy. Assert existing placement commits preserve the source. New compact copy expectation should fail before editing.
- [ ] Add `append_and_reuse_imports_remain_distinct` to App coverage with current mocks: `Choose video clips` retains append behavior; `Import video to bin` and `Import audio to bin` keep their existing behavior/accepts/multiple attributes; image upload still uses the current overlay flow. Do not rename stable input labels used by protected E2E tests.
- [ ] Run `npm.cmd test -- --maxWorkers=1 src/components/MediaBin.test.tsx src/components/ClipList.test.tsx src/App.test.tsx`; confirm intended red assertions only.
- [ ] Compact existing rows, upload area, icons, metadata, and gaps. Remove verified redundant bin introduction and oversized dropzone artwork/headings. Preserve accepted formats/limits, upload timing notice, empty/loading/error copy, and all controls. `Use as PIP` may be short visible text but its accessible name must include the file. Ellipsis is only for filenames, with full name discoverable by hover/focus; errors wrap.
- [ ] Repeat tests and add browser `long_media_names_do_not_widen_workspace`; assert no document overflow, non-drag placement stays reachable, no misleading image reuse control, and full filename remains available. Log each removed sentence and its retained semantics in the copy inventory.

### Task 4: Program chrome and contextual Inspector presentation

**Files:** Presentation-only `ProgramMonitor.tsx`, `Inspector.tsx`, existing CSS, Inspector-related copy in `EditingWorkspace.tsx`; tests `ProgramMonitor.test.tsx`, `Inspector.test.tsx`, `EditingWorkspace.test.tsx`, UI E2E file.

**Interfaces:** Unchanged monitor Props, selection/content props, native disclosures, transport/audio state. No media subtree edits or Inspector unmounting.

- [ ] Add `compact_program_keeps_transport_and_truthful_state_copy`: compact heading `Program`; existing Play/Pause names invoke the existing callback once; time/frame output remains non-live; approximate-preview text, preparing/failure states, and Resume Audio remain visible under the existing state fixtures. Use existing Props/type fixtures, not fabricated transport fields. Retain all current same-source/EOF tests unchanged.
- [ ] Extend Inspector characterization with `all_inspector_sections_remain_reachable_without_selection`; existing sections and Delivery stay available, selected section still opens, a draft survives collapse/reveal, and the same metadata/video node completes while collapsed. Add a replacement guidance assertion retaining strict-inside constraint, cut-frame ownership, matching donor time, donor consumption, and other Video 1 order.
- [ ] Run `npm.cmd test -- --maxWorkers=1 src/components/ProgramMonitor.test.tsx src/components/Inspector.test.tsx src/components/EditingWorkspace.test.tsx`. Expect only the new compact heading expectation to fail before presentation edits; guard tests should pass.
- [ ] Style monitor exterior and transport as a compact row; a Play/Pause icon may replace its visible text with the same dynamic accessible name. Keep complete visible notices/recovery and canvas geometry. Style Inspector headings, aligned fields and units; retain every disclosure/chooser/apply/save/cancel action, default open state, selection effect, and mounted content. Retain long consequence text when a shorter equivalent cannot be verified.
- [ ] Repeat tests. Add browser `reflow_preserves_monitor_and_inspector_instances`: at a paused fixed frame store media-node references, enter a draft, change viewport, assert exact nodes, values, selection, and frame persist; CSS reflow must not issue extra submission/history/edit actions. A live-playing variant records node identity and unexpected pause/seek writes without asserting new alignment behavior. Unchanged playback diagnostics remain the authoritative behavioral gate.

### Task 5: Timeline labels, tools, and distinguishable states

**Files:** `ProjectTimeline.css`, presentation-only `ProjectTimeline.tsx`/`EditingWorkspace.tsx`; tests `ProjectTimeline.test.tsx`, `EditingWorkspace.test.tsx`, UI E2E file. Read track components; leave their behavior code unchanged.

**Interfaces:** Same `videoToolbar`/`videoToolbarHelp` content, existing frame/selection/placement/actions and native timeline position input. Preserve vertical tools at every width to satisfy existing E2E and avoid changing keyboard semantics.

- [ ] Add/extend `tools_keep_exact_names_disabled_reasons_and_keyboard_hints`: all four current tools remain outside tracks, 44px browser targets, accurate accessible names, current shortcuts/descriptions, invalid split reason visible and associated. Do not replace split guidance with tooltip-only copy.
- [ ] Add `audio_keyboard_lift_stays_distinct_from_explicit_ripple` in EditingWorkspace tests using its existing `audioActions` fixture and independent selection: Delete and Backspace dispatch existing `lift`; explicit Ripple Delete dispatches `ripple-delete`. Preserve current input/IME/repeat/modal/lock exclusions, clip selection and focus behavior. These are characterization tests, not a request to alter handlers.
- [ ] Run `npm.cmd test -- --maxWorkers=1 src/components/ProjectTimeline.test.tsx src/components/EditingWorkspace.test.tsx src/components/MediaBin.test.tsx src/components/PositionedTrack.test.tsx src/components/IndependentAudioTrack.test.tsx src/components/TimelineTrimHandle.test.tsx`. Retain `scrolled_drop_indicator_and_commit_use_the_same_frame` (existing fixture expects frame 53).
- [ ] Compact the existing header/help chrome and preserve source/project-frame explanation. Apply restrained picture/audio/Video 2/overlay accents and text/type distinctions; retain actual track names and conditional order. Separate focus ring, selection border, invalid range, and drop state without changing widths, padding-derived hit geometry, lane heights, ruler mapping, or stacking.
- [ ] Add browser `fixed_labels_and_short_intervals_survive_scroll` with existing advanced fixtures: labels remain fixed under horizontal scroll, all lanes share the ruler, one-frame widths match baseline, valid/invalid ghost coordinates and committed frames agree. Run `npm.cmd run test:e2e -- e2e/professional-workspace.spec.ts --grep "fixed_labels|tools"` and existing `npm.cmd run test:e2e -- e2e/avstudio.spec.ts --grep "Timeline Tools"`. Both should pass without editing the old toolbar expectations.

### Task 6: Delivery, render progress, partial results, and copy audit

**Files:** Presentation-only `ExportOptions.tsx`, `MergeSummary.tsx`, `JobResult.tsx`, existing CSS and composed processing copy in `App.tsx`; tests `ExportOptions.test.tsx`, `JobResult.test.tsx`, `App.test.tsx`/`App.history.test.tsx`; UI E2E file.

**Interfaces:** Keep existing controlled formats/capabilities and submission/readiness/job/reset props unchanged. Render remains in Delivery, single instance, same `render-hint` association.

- [ ] Extend current mandatory-MP4 test for all capability combinations and locked states. Assert MP4 is checked/disabled, optional format unavailable messages visible, and changing an allowed option yields the same current format list. Keep exact format labels.
- [ ] Extend result tests for partial success, failed optional artifact with no link, pending artifact with no premature link/reset, completed playback/downloads, and current New project availability. In App tests assert blocking readiness, Retry status, failure, upload/queued/processing messages, keep-tab-open guidance, and no fabricated percentage/ETA/Cancel control. Use existing job/API mocks; do not add backend endpoints.
- [ ] Run `npm.cmd test -- --maxWorkers=1 src/components/ExportOptions.test.tsx src/components/JobResult.test.tsx src/App.test.tsx src/App.history.test.tsx`. Contract tests should pass before edits. Add a failing browser layout expectation only where the current result/settings overflow or oversized hierarchy violates the spec.
- [ ] Compact format/summary/results presentation. Keep MP4 inclusion, actual output profile/units, active-overlays/audio inclusion, readiness reason, unique status/errors, and per-format recovery. Only remove ready-state/repeated filler with a recorded semantic justification. Do not change busy text, availability conditions, link destinations, handlers, or polling/reset behavior.
- [ ] Repeat focused tests and run unchanged `npm.cmd run test:e2e -- e2e/timeline-drag-audio-export.spec.ts` to exercise real downloads/optional failure/scrolled placement. Record failures without changing its routing/proxy or export logic. Complete the per-sentence copy inventory across all touched components; no blanket paragraph or heading hiding.

### Task 7: Responsive, keyboard, and visual acceptance coverage

**Files:** Existing CSS, UI E2E file; UI verification document and new UI-specific captures only. Do not replace existing screenshot files or playback archives. No new test configuration, browser, font, or accessibility package.

**Interfaces:** Same DOM instances/actions at every breakpoint. UI evidence uses current fixtures and Playwright `testInfo.outputPath`/attachments; reviewed before/after captures are copied to a new `docs/screenshots/professional-workspace-ui/` directory only during future execution.

- [ ] Write browser tests first: `breakpoints_keep_all_actions_and_internal_timeline_scroll`, `keyboard_focus_and_error_text_remain_visible`, and `state_matrix_has_readable_non_decorative_chrome`. Use role/label locators, bounding boxes, document overflow, active element, associated descriptions, actual disabled state, and node identity. Existing tests/fixtures provide job responses for visual states; do not mock away playback failures or use product delays.
- [ ] Check 1440x900, 1920x1080, 1280x720, 1024x768, 768x1024, 320x800, 1440x600; also 1279/1280 and 899/900 breakpoint edges. Assert three/two/one-column placement as specified, wrapping header/actions, no page horizontal overflow, 760px timeline inner minimum, readable fixed labels, unobscured last lane/results, all format/retry/reset controls available under their original conditions. No overflowing menus/drawers are introduced.
- [ ] Run `npm.cmd run test:e2e -- e2e/professional-workspace.spec.ts`; confirm new layout requirements fail before responsive CSS edits where applicable.
- [ ] Apply only shell reflow/wrapping/scroll CSS. Below 800px height allow page scrolling rather than forcing a fixed viewport. Keep tools vertical, fields wrapping, all disclosures mounted, media instances stable, focus rings visible, error text untruncated. Tooltips must be discoverable by hover and focus; use scoped CSS on existing controls with persistent accessible descriptions, not new shortcut handling or stateful popovers. Disabled explanations stay visible.
- [ ] Repeat UI E2E. Capture before/after same-state pairs: empty/loading/error media; populated long names; each selected track; one-frame/scrolled timeline; trim/placement dialogs; invalid drop; monitor ready/preparing/failure/audio-resume; upload/queue/render/failure/poll-retry; partial/complete/failed exports. Desktop captures cover the full state matrix; each alternate viewport covers empty, populated, dialog/error, and result layouts. Add PIP before/after EOF from existing behavioral fixtures; screenshots do not prove EOF correctness.
- [ ] Review paired captures at identical fixture/frame/selection/capabilities. Check hierarchy, spacing, alignment, restrained colors, disabled/selected/focus states, contrast (4.5:1 text, 3:1 meaningful boundaries), no fake progress or waveforms, and preserved canvas/track geometry. Do not mask media behavior in behavioral evidence or overwrite old expected playback outcomes. Start with paired captures and measured assertions; do not create a snapshot baseline by blindly accepting current output.
- [ ] Manually test native browser 200% zoom (viewport resizing is not a substitute), reduced motion, keyboard-only upload/placement/edit/render navigation, focus return from dialogs/deletion, tooltip focus, and actual screen-reader names/status/errors without per-frame announcements. Record unperformed checks as pending, never automated passes. Accessibility changes requiring new keyboard behavior remain outside scope.

### Task 8: Final verification and acceptance report

**Files:** UI verification document and approved UI evidence only; inspect every eventual changed hunk against Task 1. No new production changes unless an attributable presentation regression returns to its owning task/test cycle.

**Interfaces:** Consumes completed task evidence and baseline; produces separate UI results, unresolved playback results, and exact Git status. No integration/deployment step follows.

- [ ] Audit changed paths with `git diff --name-only` and all untracked files with `git status --short`. Inspect `git diff -- frontend/src frontend/e2e`; protected files must have no UI-task changes, including playback assertions, hooks/libs, source probes, backend, package/lock/configuration files. Compare to Task 1 so pre-existing changes are not misattributed. Read new files directly because ordinary diff omits untracked content.
- [ ] Run `npm.cmd test -- --maxWorkers=1`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run build`. Required outcome: no new failures, passing new UI tests, unchanged existing behavior assertions; record exact counts/exit codes, not historical numbers. Do not use repository-wide auto-format to fix unrelated baseline failures.
- [ ] Run `npm.cmd run test:e2e -- e2e/professional-workspace.spec.ts` and then `npm.cmd run test:e2e` with existing installed Edge/config. Archive each run separately before another replaces its output. Explicitly enumerate unchanged `playback-continuity.spec.ts` results and compare failure identities/measurements with Task 1; full E2E may remain red. Do not skip/mark expected failures, loosen 40ms/50ms limits, add retries/timeouts, mute audio, or hide preparing/errors to get green.
- [ ] Run unchanged backend regression suites as verification only: from repository root, `.\.venv\Scripts\python.exe -m pytest tests/backend -q`. Run real integration coverage using process-local opt-in with restoration, never a configuration edit:

  ```powershell
  $uiPriorFfmpegOptIn = $env:RUN_FFMPEG_TESTS
  try {
    $env:RUN_FFMPEG_TESTS = '1'
    & .\.venv\Scripts\python.exe -m pytest tests/integration -q
    $uiIntegrationExit = $LASTEXITCODE
  } finally {
    if ($null -eq $uiPriorFfmpegOptIn) {
      Remove-Item Env:RUN_FFMPEG_TESTS -ErrorAction SilentlyContinue
    } else {
      $env:RUN_FFMPEG_TESTS = $uiPriorFfmpegOptIn
    }
  }
  Write-Output "UI regression integration exit: $uiIntegrationExit"
  ```

  Expect no new regression and no unreported skips; record missing tools/blocked execution without installs or backend changes. Existing browser tests already start local services using unchanged configuration; do not launch a deployed environment.
- [ ] Complete manual checks: compare all control handlers/values/locks/shortcuts with inventory; trim/split/ripple/undo/redo; both replacement workflows; independent audio lift/ripple, music and source reuse; pointer/keyboard placement at scroll; PIP EOF/backward seek; canvas proportions; all four export settings/results/downloads and retry/reset. Record audible alignment and playback observations separately as still subject to unresolved gates. Do not claim professional UI review verifies playback/rendering.
- [ ] Report UI test/visual/manual results, known baseline failures, new failures/blockers, unmet top-bar Render placement and image-entry grouping constraints, and unperformed checks. UI scope may be reviewed independently, but there is no claim of fully passing AVStudio acceptance while playback or required checks remain unresolved.
- [ ] Run final `git diff --check`, then `git status --short`. Both command results and exact status go into the report. No staging, commits, pushes, branch actions, or deployment follows.

## Completion conditions and self-review

The plan is ready for review when all spec sections map to tasks: desktop shell/header (2), Media Bin and text reduction (3), monitor/Inspector (4), timeline/tools (5), Delivery/status/results (6), responsiveness/accessibility/visual and manual checks (7), baseline isolation and final regression evidence (1, 8). Each task names exact files, unchanged interfaces, concrete assertions, commands, and acceptance outcomes. All five review-focus cases have owning tests.

Self-review completed while writing this plan:

- Current backup state and ignored report evidence are distinguished from fresh verification and live remote state. No stale report is treated as a clean current run.
- Test-first work is future authorized UI coverage, not tests modified now. Existing passing invariants are characterized without manufactured red tests; design failures are introduced only for intended presentation changes.
- No test modification weakens playback thresholds, export assertions, or known failures. The seven unresolved gates remain explicit, including uncertainty about decoder handoff.
- Top-bar Render relocation and duplicate image entry points are deliberately not implemented across ownership boundaries; the spec's fallback is explicit and must be reported, not disguised as completion.
- Responsive layout keeps vertical tools to preserve existing E2E expectations, all actions and node identities. Timeline density cannot change frame geometry or media composition.
- Text reduction retains unique editing consequences, keyboard hints, limitations, status/errors, disabled reasons, accessibility relationships, and source/project units.
- No new runtime interfaces, packages/configuration, backend changes, commits, pushes, deployment, branch mutations, or mobile beginner editor are planned.

This document is an implementation plan only. Application code has not been changed, and no test, live playback, or export run is claimed during planning. Await separate implementation authorization after plan review.
