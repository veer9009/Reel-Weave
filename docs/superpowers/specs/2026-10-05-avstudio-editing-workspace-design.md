# AVStudio next milestone: default editing workspace

Date: 2026-10-05
Status: proposed design; awaiting user review
Milestone: workspace integration and product rename following completed Milestones 1–3

## Intent and constraints

AVStudio opens directly into a professional, timeline-centered workspace for assembling uploaded clips into one MP4. The timeline displays the actual project and shares the existing validated editing controls and rendering flow. Success means a user can upload, arrange, trim, change speed, configure overlays and audio, preview, render, and download without entering or leaving a demo view.

This document is the only deliverable authorized in this task. Application code, assets, tests, settings, dependencies, screenshots, and existing documentation remain untouched during specification writing. No installation, commit, push, or deployment is authorized. The SVG assets described below are future implementation deliverables, not files created by this specification.

User-specified requirements are the AVStudio rename, interlocked A/V identity, default real-content timeline, retained validated controls, MP4 rendering, and the explicit scope exclusions below. Design assumptions are a single in-memory project labeled `Sequence 01`, the existing fixed output profile, and a silent approximate browser sequence preview. These preserve the current capabilities rather than introducing persistence or a new playback engine.

## Existing project evidence

- `frontend/src/App.tsx` owns clips, FPS selection, overlays, audio settings, metadata readiness, upload state, job polling, errors, and object URL cleanup. A `timelineDemo` boolean currently switches between the timeline and a hidden merge workspace; timeline rendering switches back to that workspace.
- `frontend/src/components/TimelineDemo.tsx` already derives frame lengths, previews source clips and overlays, and invokes the shared render callback. It pads the sequence to at least twelve sample entries, draws generated waveforms, and contains stale statements about sequential-only rendering and multi-track export being in development.
- `UploadCard`, `ClipList`, `TrimEditor`, `OverlayTrack`, `BackgroundAudioTrack`, `MergeSummary`, and `JobResult` hold the existing controls and result presentation. These capabilities must remain reachable in the unified workspace.
- `frontend/src/lib/clips.ts` and `frontend/src/lib/overlays.ts` supply existing manifest, FPS, frame-count, and overlay-validation logic. Milestone 3 documents and implements image/PIP composition and original/background audio mixing.
- `frontend/index.html`, `App.test.tsx`, `TimelineDemo.test.tsx`, `frontend/e2e/reelweave.spec.ts`, README, and screenshot documentation contain current naming or navigation assumptions that require a later migration.

These are read-only observations, not a fresh assertion that every historical validation suite passes. This design does not rerun rendering or generate screenshots.

## Approach decision

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Integrate the existing timeline and validated control components into one workspace | Requires layout and presentation-state changes while preserving rendering contracts | Recommended |
| Keep the merge page and make a timeline tab initially selected | Lower layout effort, but continues splitting the primary workflow across screens | Rejected |
| Replace the frontend with a new editor architecture | Enables broader editing concepts, but expands risk and scope beyond this milestone | Rejected |

Use the first approach. The timeline is a projection of existing project state; it is not a separate project model or render engine.

## Page layout and navigation

The default `/` screen contains one application header and one `main` editing workspace. Remove the `Timeline Demo` / `Back to Merge` switch and upload–arrange–merge wizard navigation. Do not add another editor route or a legacy page toggle.

Desktop wireframe:

```text
AVStudio wordmark | Sequence 01                  Backend status
-------------------------------------------------------------
Media and controls | Program preview          | Inspector
Upload clips       | Play/pause, time, frame   | Clip / overlays
Ordered clip list  | Silent preview notice     | Audio / delivery
-------------------------------------------------------------
Timeline | Project FPS: Auto / 24 / 25 / 30 / 50 / 60
Frame ruler and playhead
Video 2  | PIP and image/logo intervals
Video 1  | Actual sequential uploaded clips
Audio 1  | Original audio aligned to Video 1
Audio 2  | Actual background music, if selected
-------------------------------------------------------------
Render status / completed MP4 preview / download / New project
```

- Header: local AVStudio wordmark, `Sequence 01`, and truthful backend availability. Avoid slogans, marketing panels, and claims implying media never reaches the configured backend. The logo identifies the workspace; activating its home link stays within the workspace and does not reset project state.
- Media panel: keep `UploadCard` and the ordered `ClipList`. Show file names, metadata status, trim and speed summaries, explicit move earlier/later controls, removal, and trim entry. Existing file-upload behavior may remain; this does not authorize timeline drag editing.
- Program monitor: source preview with overlays, transport, current project frame, duration, and a persistent compact `Silent browser preview · approximate` note. Empty state says `Add video clips to begin`; no sample storyboard, sample resolution, or fabricated duration appears.
- Inspector: vertically stacked, collapsible Clip, Video 2 overlays, Audio, and Delivery sections. Selection opens the relevant section and scrolls it into view. Collapse only presentation; preserve inputs, draft state, and required metadata observation. Users can configure both overlays and both audio settings without selecting a timeline item first.
- Timeline: always visible as a primary workspace region, below the upper panels. Four fixed tracks in order Video 2, Video 1, Audio 1, Audio 2. FPS selector and resolved FPS are adjacent to the ruler. Empty tracks provide explanatory text rather than sample blocks.
- Delivery: fixed-format `MP4`, truthful existing output details, duration, clip count, resolved FPS, and one primary `Render MP4` action. Adapt `MergeSummary` as summary content; remove duplicate merge actions. Do not describe source resolution as output resolution or offer a format selector with one pretend choice.
- Results: keep job status and `JobResult` inside the same workspace, in a full-width region after the timeline. Rendering never navigates to another page. On submission announce status and bring the status region into view; on completion expose rendered MP4 playback and download. Keep program-preview and rendered-result labels distinct. `New project` uses existing reset behavior and explains that it clears browser project state; it does not cancel/delete a backend job.

At 1280px and above, use approximately 260px media, a flexible monitor of at least 360px, and 300px inspector with 16px gaps. The timeline occupies full available width with at least 280px of working height when space permits. Panels scroll internally only on sufficiently tall desktop screens; shorter screens use ordinary page scrolling. No fixed footer covers controls.

## Component boundaries and state changes

`App` remains the sole owner of project and job state. Remove `timelineDemo` and its conditional branches. Compose a single `EditingWorkspace`; rename `TimelineDemo` to `ProjectTimeline` and its associated test/style files during implementation. The timeline component renders tracks/ruler and delegates monitor presentation to `ProgramMonitor`. This targeted separation avoids embedding upload, inspection, and delivery behavior inside a large timeline component.

| Unit | Responsibility and input | State ownership |
| --- | --- | --- |
| App / EditingWorkspace | Compose panels; supply existing edit callbacks, health, readiness and job state | App retains all existing project/job state |
| ProjectTimeline | Derive and display frame intervals; report item selection and seeking | No copied clips or overlay descriptors |
| ProgramMonitor | Source playback, trim/speed mapping, approximate overlay preview, media errors | Shared presentation playhead/play state |
| Existing media/edit components | Keep upload, metadata, reorder, trim, speed, overlay and audio validation | Existing callbacks update App state |
| Inspector | Arrange current controls; expose selected item details | Selected item and section expansion only |
| Delivery / JobResult | Render readiness, submit, poll feedback, final playback/download/reset | Existing App job lifecycle |

Introduce a stable selection descriptor: none, clip ID, image overlay, PIP overlay, Audio 1, or Audio 2. Keep this distinct from the clip currently under the playhead. Clicking a Video 1 item selects it and seeks to its start; clicking an overlay selects it and seeks to its scheduled start. Audio 1 opens original-audio controls; Audio 2 opens music controls. This is selection and inspection, not timing manipulation.

Use one shared integer project-frame position, plus presentation-only playing state. For a ready nonempty project, valid positions are `0..N-1`. Empty projects use no current frame and disabled transport. Playhead time is frame/FPS; source time is trim-start/source-FPS plus elapsed project time multiplied by speed. Stop on the final frame; Play at the end restarts at frame zero. Preserve browser seek-on-metadata behavior and pause source/PIP media when playback stops or the component unmounts.

On removal, clear a selection referencing the removed item. On timeline shortening, clamp the playhead to the new final frame. Pause playback during structural edits or FPS changes; retain valid selection and clamp its position. Invalid overlay schedules remain visible as invalid and block rendering; do not silently alter their ranges. Reset clears selection, playback, FPS, media, overlays, audio settings, errors and result through the existing cleanup flow.

Retain object URL ownership, abort handling, metadata loading/error states, health retry, polling retry, and safe backend error behavior. Do not create duplicate metadata-loading videos just to render thumbnails. Ready clips get timing intervals; if any Video 1 clip is unresolved or invalid, show its real list entry and status, but disable sequence playback and show `Timeline timing unavailable` rather than inventing or compressing later clip offsets. Render remains blocked until readiness is restored.

## Real timeline content and frame semantics

Let `F` be resolved project FPS. For each ready Video 1 clip, use the existing `projectFrameCount` helper with inclusive source trim count, source FPS and selected speed. Its result is `max(1, floor(sourceFrames / sourceFPS / speed * F + 0.5))`. A clip starts at the sum of all preceding clip frame counts. Its inclusive end is start + count − 1. Total project frames `N` are the sum of these counts; project duration is `N/F`.

No sample cards enter either display or manifest. Clip count is exactly the number of real uploaded clips. Timeline widths reflect project-frame duration, with a scrollable minimum content width to keep short intervals discoverable. Very short intervals retain exact geometry; their accessible selection target and list entry remain usable without falsifying duration.

| Track | Actual representation | Meaning |
| --- | --- | --- |
| Video 1 | One interval per uploaded, ready clip in existing order | Sequential trims and speed are real render inputs |
| Video 2 | At most one image/logo and one PIP interval | Inclusive project-frame schedules and existing position/size settings are real render inputs |
| Audio 1 | One aligned interval per Video 1 clip, labeled original audio | Shares trim/speed boundaries; existing global original volume/mute is real |
| Audio 2 | One project-length interval only when background audio exists | Music starts at zero and uses the existing loop/truncate/mix behavior |

Video 2 uses two compact sublanes under a single track heading so simultaneous image and PIP intervals are legible. These are fixed slots, not additional user-created tracks. Image/logo renders above PIP, retaining the validated compositor order. Display invalid schedules with an error badge and exact requested frame values; constrain visual overflow to the lane without changing the descriptor.

PIP visibility is bounded by both its inclusive scheduled project-frame range and its source video duration. In the browser preview and final FFmpeg-rendered MP4, PIP becomes transparent/absent when the source reaches EOF, even if its scheduled range continues. Never hold or freeze the final PIP frame. Keep the scheduled lane interval and descriptor unchanged; EOF affects visibility, not the requested schedule.

Audio 1 cannot infer that every source contains sound unless existing metadata actually establishes it. Label presence as unknown when necessary; the backend's existing silence padding remains authoritative. Do not introduce audio probing or waveform analysis. Muted tracks remain visible and show a textual muted indicator.

Auto FPS resolves with the existing helper from the first clip's metadata. Until resolvable, show `Waiting for source FPS`; never invent 30 FPS for the empty project. Explicit choices remain 24, 25, 30, 50 and 60. Keep browser-derived FPS marked estimated. Source trim fields remain source frames; overlay schedules and ruler use project frames.

Ruler ticks use integer project frames with adaptive label density, starting at zero. Label the project duration boundary separately from the final selectable frame `N-1`. The seek control has integer frame steps; its accessible text includes frame, total frame count, time and FPS. Keep one pixel-to-frame mapping across all tracks. No trim handles, drag cursors, magnetic snapping, or decorative controls suggest unsupported editing.

## Rendering and workflow states

Use the existing `submitMerge`, manifest construction, multipart parts, `/api/merge`, job polling, video and download endpoints. No new backend contract, processing stage or project schema is needed.

The existing FFmpeg composition stage must make PIP transparent/absent at source EOF, matching browser preview behavior. It must never repeat, hold, freeze or pad the final PIP frame through the remaining scheduled interval. Preserve the base video, image/logo overlay and audio after PIP EOF. This EOF rule takes precedence over any existing final-frame-hold behavior; all other rendering requirements remain unchanged.

- Empty/one clip: timeline workspace stays open. Show an empty monitor or the available clip; explain `Add at least two video clips to render` and disable Render MP4. Keep the existing minimum of two clips.
- Metadata loading/error: show per-asset status and remediation. Preserve supported formats and server-provided size/count limits. Overlay upload requires a ready Video 1 timeline.
- Ready: enable Render MP4 only under the existing complete readiness predicate: nonbusy, no completed job awaiting reset, at least two valid clips, available FFmpeg/FFprobe, valid background-audio metadata, resolved FPS, and valid ready overlays.
- Uploading/queued/processing: keep project tracks visible. Freeze project mutations, FPS and render submission; passive selection and silent preview may remain available. Show truthful indeterminate stage text, without fabricated progress percentages or ETA.
- Failed: retain all project settings, show the existing safe error, and allow correction/retry when idle. Polling failure has a separate `Retry status` action and does not imply the backend job stopped. Preserve expired-job handling.
- Completed: keep the timeline visible alongside rendered MP4 playback/download. Editing and a second render remain disabled until `New project`, preserving the current completed-job workflow. Keep status/download retry behavior; do not silently overwrite a completed result.

Use neutral operational copy such as `Uploading media`, `Queued`, `Rendering MP4`, `Render failed`, and `MP4 ready`. Remove stale multi-track-development and Video-1-only export notices. Delivery must state that active overlays and configured audio are included.

## Branding and local SVG assets

Future asset paths: `frontend/public/branding/avstudio-icon.svg` and `frontend/public/branding/avstudio-wordmark.svg`. Both are hand-authored local vectors with no external font, image, script, filter dependency, package, or remote request. Use the icon asset as the SVG favicon; use the horizontal asset in the header and icon-only variant on compact screens. This is an application brand asset, not a newly supported SVG media-overlay upload format.

Icon construction: a 64×64 viewBox with a dark `#111827` rounded square, approximately 14px corner radius and 8px internal safe margin. Build a geometric cyan/blue A (`#38BDF8` to `#2563EB`, simple local linear gradient) and soft-white V (`#F3F4F6`) as filled paths. The A apex, crossbar and V valley must remain recognizable. Interlock one diagonal crossing using path layering and a small background-colored separation so neither letter collapses into an indistinct zigzag. Avoid shadows, extrusion, film-strip detail and tiny ornament. Review at 16, 24, 32 and 64px; simplify crossing geometry if small-size recognition fails.

Horizontal variant: approximately 240×64 viewBox, the same icon, a 12px gap, and `AVStudio` in a restrained medium/semibold sans-serif treatment. Convert wordmark lettering to paths for deterministic rendering without font installation. Keep exact capitalization and avoid a tagline. Application text outside the asset continues using the existing local/system font stack.

Accessible brand name comes from the wrapping link (`AVStudio workspace`); embedded artwork is decorative to avoid duplicate announcements. Standalone meaningful assets have an explicit AVStudio accessible name. Keep SVG IDs scoped so inline instances cannot collide. Provide intrinsic width/height, preserve aspect ratio, and maintain approximately 8px clear space at 32px icon size.

### Rename inventory and compatibility

- Replace rendered ReelWeave names, split Reel/Weave text, RW artwork, breadcrumbs, footer branding and accessible product labels with AVStudio. Remove sample campaign artwork entirely.
- Browser title becomes `AVStudio — Editing workspace`; description becomes `Assemble video clips, overlays, and audio into an MP4 in AVStudio.` Set the local favicon reference.
- Rename frontend test descriptions, demo component/test/style filenames, and the branded E2E filename; update imports and selectors. Remove expectations that require opening Timeline Demo or returning to Merge.
- Refresh current README product heading, workspace instructions and screenshot captions, and update current verification documentation. Regenerate documented desktop/mobile screenshots only during later implementation verification.
- Preserve historical milestone specs, plans, execution evidence and their filenames as dated records. Current documentation explains `AVStudio (formerly ReelWeave)` once where it helps readers understand those records. Old demo wording may remain in historical records and absence-test literals, but never normal rendered UI or accessible labels.
- Preserve existing `REELWEAVE_*` environment variable contracts, installation paths, API endpoint names, generated output filenames and internal identifiers that are not visible product branding. Document legacy configuration naming in current README. Do not rename the workspace directory, backend module tree, package identity or deployment settings as part of the UI rename.

## What is real and what is visual-only

Real: uploaded files, project order, inclusive source trims, supported speeds, selected/resolved FPS, actual overlay descriptors, original/background audio settings, validation, frame geometry, selection/seeking, and the existing rendered MP4 job/result flow.

Approximate: browser playback timing and CSS overlay placement/size. Keep the existing silent sequence preview; it does not audition the final audio mix. Browser preview and final FFmpeg-rendered MP4 both make PIP transparent/absent at source EOF; neither holds or freezes the final PIP frame. Explain in the PIP section that visibility ends at source EOF if its schedule exceeds source duration; final MP4 playback is the authoritative composition and audio check. A browser playback failure does not disable an otherwise valid backend render.

Visual-only: track colors, thumbnails and selection highlight. Remove the generated `Waveform` bars and replace them with neutral audio bands; these do not claim measured signal amplitudes. No synthetic waveforms, sample media, fake quality options, extra tracks or inactive effect tools appear in the workspace.

## Accessibility and responsive behavior

- Use a single main landmark, ordered headings, named Media, Program preview, Inspector, Sequence timeline, and Render result regions. Every file input, FPS selector, audio slider, overlay control and action has an explicit accessible name.
- Use native buttons/selects/ranges. Clips and overlays are keyboard-selectable with an explicit selected state. The playhead range supports native arrow/Home/End behavior at integer frames. Do not capture editing shortcuts while focus is in form inputs.
- Roving focus is unnecessary in this milestone: ordinary tab order follows media, monitor, inspector, timeline, result. The scrollable timeline has a keyboard-focusable container and sticky track headings. Revealing an inspector section preserves selection-button focus; closing trim returns focus to its trigger, and removal moves focus to the nearest surviving item or upload control.
- Retain TrimEditor's keyboard dismissal and focus containment where provided; fill any missing dialog semantics during the workspace integration. Associate field errors and render-disabled explanations with affected controls using descriptive relationships. Announce additions, moves, removals and job-stage changes politely; avoid announcing every playback frame. Announce blocking failures clearly.
- Track roles and states use text/icons as well as color. Target WCAG AA contrast: 4.5:1 for normal text and 3:1 for meaningful controls/focus boundaries. Use cyan selection accent, dark neutral surfaces, and clear focus rings. Provide at least 44px touch targets for primary controls. Respect reduced motion and avoid decorative pulsing.
- At 900–1279px, use media + monitor columns and place the inspector full-width below them, then the timeline and result. At less than 900px, stack header, media, monitor, inspector, timeline and result in that DOM order. Compact header uses icon plus visible AVStudio text. No horizontal page overflow at 320px; only the timeline's own content scrolls horizontally.
- Inspector sections collapse to keep the phone workflow manageable, but validation summaries and relevant errors remain discoverable outside collapsed bodies. Preserve all supported controls on mobile; never replace them with disabled desktop-only placeholders. Use responsive monitor aspect ratio with letterboxing and no distortion. Verify keyboard and 200% zoom access without obscured controls.

## Migration and future validation strategy

This describes later implementation acceptance, not commands to execute during this specification task.

1. Integrate the shell and shared presentation state while keeping App's edit handlers, validation helpers and rendering contracts. Remove duplicate/hidden legacy workspace and demo data. Adapt existing components rather than rewriting media logic.
2. Introduce the two local SVG assets and browser metadata; migrate visible copy, component/test names and current documentation. Keep the explicit compatibility exceptions above.
3. Update frontend behavior tests to start on the real workspace and exercise upload, button-based reorder, trim, speed, FPS, overlay selection/configuration/removal, audio controls, rendering, polling failures, result preview/download and reset without view switching.
4. Replace sample-storyboard expectations with empty-state and exact-real-count assertions: zero clips means no intervals, two clips means two Video 1 intervals, and larger projects have no padding. Test frame counts with mixed source FPS, trims and speeds; playhead clamping; pending/error metadata; inclusive one-frame overlays; overlapping image/PIP sublanes; invalid schedules after edits; no audio band without selected music; and mute indicators.
5. Verify manifest and multipart equivalence for the same project before/after workspace integration. No presentation selection/playhead state enters submission data. Preserve existing backend validation and media tests; add no backend behavior merely to support visual layout.
6. Add assertions for AVStudio header/accessibility/browser title/favicon, absence of ReelWeave and Timeline Demo in active UI, and absence of sample cards, generated waveform claims, MOV export options, stale multi-track-development text and misleading trim/drag handles. Scope branding scans to active product surfaces with documented compatibility exceptions.
7. Update the existing Playwright workflow to upload two real clips, configure both overlay slots and audio, preview/seek, render once, poll, play/download MP4, and reset entirely within the workspace. Assert it stays visible during processing and completion. Capture desktop empty/arranged/result and mobile arranged/result views under `docs/screenshots`, with current captions. Screenshots are evidence, not a substitute for behavior checks.
8. Run existing frontend unit tests, lint, format check, production build, backend suites, and existing Edge-based E2E checks with already installed tooling. Run opt-in real FFmpeg integration coverage for sequential composition, overlay boundaries, FPS and original/background audio. Do not install missing tools or alter settings; report any unavailable checks honestly and leave their acceptance unmet.

PIP EOF regression coverage must exercise a source shorter than its scheduled range in both browser preview and real FFmpeg output. Verify PIP visibility immediately before EOF and absence at and after EOF through the remaining scheduled interval, with base video, image/logo and audio continuing. Also cover schedules ending before source EOF and seeking across EOF in the browser. Any existing final-frame-hold test expectation must be replaced with absence at EOF; never accept frozen PIP output as passing.

Manual review covers SVG small-size legibility, all four tracks, very short intervals, long filenames, simultaneous overlays, keyboard-only upload-to-render flow, screen-reader labels/status, 320px mobile, desktop, short-height windows and 200% zoom. Preserve current data cleanup and source-file ownership behavior throughout. No stored-project migration is required because project state remains in memory; reload retains current reset semantics.

## Acceptance criteria

- Opening `/` displays AVStudio's editing workspace with the timeline present, without a demo-entry action or separate merge page.
- Header, browser metadata and active accessible product labels say AVStudio; both locally served logo variants meet the approved monogram direction.
- All timeline intervals derive from actual project data. Empty projects contain no sample clips, fabricated waveforms, invented FPS or playable storyboard.
- Video 1, Video 2, Audio 1 and Audio 2 reflect the supported sequential, overlay and audio models and share the same project frame scale.
- Browser preview and final FFmpeg-rendered MP4 both make PIP transparent/absent when its source video reaches EOF, including when its scheduled interval extends beyond EOF. Neither holds or freezes the final PIP frame; regression tests verify this rule while the base composition continues.
- Existing upload, button reorder, trim, supported speed, overlay position/size/range, audio settings, preview and MP4 render/download functions remain reachable and validated.
- Render stays inside the workspace and preserves the current manifest, backend pipeline, job readiness and error behavior.
- Silent approximate browser preview and authoritative rendered MP4 are clearly identified.
- Desktop/mobile layouts and keyboard/assistive access meet the behavior specified above; migrated tests and screenshots document the new default workflow.
- No excluded feature or operational change is introduced.

## Explicitly out of scope

- Drag-and-drop timeline editing, trim handles, free positioning, resize gestures, arbitrary tracks, gaps, overlaps on Video 1, user-controlled layer order, and nested/multiple sequences.
- Transitions, effects, filters, keyframes, fades, opacity, crop/rotation, text editing, titles, captions, templates, stock-media services and brand-kit management.
- Additional image/PIP slots; PIP source trim/speed/loop/audio controls; waveform analysis; final-mix browser audition; new audio effects or additional music files.
- MOV export or any additional export format, resolution/aspect-ratio choices, encoding/quality presets, proxy media and new processing capabilities. Existing MOV input support is retained; it does not imply MOV output.
- Database, persistence/autosave, undo/redo, authentication, accounts, collaboration and cloud storage.
- Deployment, infrastructure, package installation, settings changes, repository/workspace renaming, configuration-variable migration, commits and pushes.

## Review gate

Review this written specification before any implementation. Requested revisions remain specification-only work. Approval of this specification does not override the user's instruction to stop here or authorize application changes, package installation, settings changes, commits, pushes or deployment; subsequent work requires a separate request.
