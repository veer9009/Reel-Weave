# AVStudio professional workspace UI design

Date: 2026-10-17  
Status: design specification for review; implementation is not authorized

## Purpose and scope

Make AVStudio feel like a focused professional desktop video editor through compact copy, coherent spacing, clear workspace hierarchy, and restrained use of the existing dark theme. Draw on familiar non-linear editing conventions without reproducing Premiere Pro branding, panel chrome, or its exact layout.

The user requests a specification only. This document is the sole deliverable. Do not implement application code or modify tests, packages, configuration, backend, branches, commits, pushes, or deployment. Validation described below is acceptance coverage for a separately authorized future UI milestone, not work performed by this specification task. This document does not authorize an implementation plan or application changes.

The current playback verification work remains unresolved and independent. Preserve current timeline behavior, rendering, exports, controls, and their availability exactly. A cleaner screenshot is not evidence that playback is verified.

## Read-only findings and design decision

The current repository already provides the main workspace regions:

| Existing file or asset | Observation relevant to this design |
| --- | --- |
| `frontend/src/App.tsx` | Composes the header, media, inspector content, render readiness, export choices, job state, results, and error recovery. |
| `frontend/src/components/EditingWorkspace.tsx` | Coordinates selection, edit actions, timeline tools, playback/audio hooks, inspector content, and result region. Presentation and behavior coexist here. |
| `frontend/src/components/MediaBin.tsx` | Imports reusable video/audio sources and exposes placement, PIP reuse, removal, and drop-zone behavior. Images currently use the overlay workflow rather than a reusable image-bin model. |
| `frontend/src/components/Inspector.tsx` | Uses existing Clip, Video 2 replacement, Overlay/PIP, Audio, and Delivery disclosures. Selection opens and reveals the relevant section. |
| `frontend/src/components/ProgramMonitor.tsx` | Owns media slots and overlay presentation, transport, approximate-preview notice, preparing/failure messages, and Resume Audio. |
| `frontend/src/components/ProjectTimeline.tsx` and `.css` | Provide the ruler, timeline position input, fixed track headings, track content, and Timeline Tools. The timeline inner area currently has a 760px minimum width. |
| `frontend/src/components/ExportOptions.tsx`, `MergeSummary.tsx`, `JobResult.tsx` | Provide mandatory MP4, capability-gated MOV/WAV/MP3, submission/readiness, per-export results, and the existing reset workflow. |
| `frontend/src/styles.css`, `components/EditingWorkspace.css` | Define existing dark neutrals, typography, brand accent, and responsive workspace presentation. |
| `frontend/public/branding/avstudio-wordmark.svg`, `avstudio-icon.svg` | Existing local brand assets to reuse unchanged. |

These are source observations, not a claim that the application or its tests pass. Older specs describe earlier capabilities, including silent preview and MP4-only delivery; they must not override current controls or restore obsolete limitations.

Three approaches were considered:

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Refine the existing workspace with presentation changes | Achieves hierarchy and text cleanup with the smallest behavioral surface | Selected |
| Introduce a new docking/tabbed workspace system | Adds panel state, focus, lifecycle, and interaction risks | Excluded |
| Replace the editor shell and editing architecture | Broadens scope into functional migration and playback risk | Excluded |

Use existing components and control instances. Prefer scoped CSS and copy changes over component extraction or reparenting. If a proposed visual improvement requires a behavior change, omit that improvement from this milestone and record the constraint.

## Functional preservation contract

The following requirements take precedence over every layout, density, and copy recommendation:

- Preserve trim, split, ripple delete, undo/redo, version replacement, Video 2, PIP source-EOF behavior, independent audio, music, source reuse, and current drag/drop work in progress. Keep existing button, keyboard, form, context-menu, and dialog alternatives.
- Preserve the distinction between Video 1 version replacement and positioned Video 2 replacement. Keep their inputs, terminology, eligibility, and consequences distinct.
- Preserve existing Delete/Backspace behavior and the Ripple Delete button behavior, including any track-specific difference. Do not make them equivalent as part of icon or label cleanup.
- Preserve selection, playhead, source/project frame mapping, inclusive/exclusive range semantics, FPS, duration, track order, stacking, trim hit areas, drag coordinates, drop eligibility, and gesture transactions. No timeline scaling or new zoom behavior.
- Preserve history entries, history limits, resource ownership, object URLs, pending probes, media element identity, effect dependencies, and transport bindings. No new remounts caused by layout or responsive breakpoints.
- Do not edit playback/audio hooks, media event wiring, source probes, decoder handling, synchronization, seeking, resume behavior, EOF logic, or unresolved playback verification assertions. Do not hide a playback failure behind loading chrome.
- Preserve all render predicates, locks, active/completed-job restrictions, retry paths, reset behavior, requests, manifests, capability checks, and export/download behavior. MP4 remains mandatory; MOV, WAV, and MP3 retain their current optional availability and final-mix semantics.
- Preserve the program image's aspect ratio, letterboxing, overlay placement/size calculations, visibility, and composition. Style the monitor's surrounding chrome; do not change its internal media or overlay geometry.
- Presentation changes must never commit an edit, clear history, move the playhead, change selection, pause/resume media, or submit a job by themselves.

Before future implementation, capture the then-current source baseline, including any intervening playback work. Behavioral equivalence is measured against that baseline. Do not revert newer work to match this document's observations.

## Desktop composition

At widths of 1280px and above, use one compact application bar, a three-column upper workspace, and a full-width timeline beneath it. The timeline is the primary editing surface, not a card below marketing content.

```text
AVStudio | Sequence 01 | existing project actions | status | Render MP4
--------------------------------------------------------------------
Media Bin         | Program                           | Inspector
Import + reuse    | existing picture/overlay canvas   | Clip / Video 2
Clips/audio/image | Play/Pause + time/frame + status   | Overlay / Audio
entry points      |                                   | Delivery
--------------------------------------------------------------------
Sequence 01 / FPS / duration / current contextual messages
Tools | fixed track labels | horizontally scrollable ruler and lanes
      | Overlay/PIP        | existing image and PIP sublanes
      | Video 1 / Video 2  | existing picture occurrences
      | audio / music     | existing audio ownership and placements
--------------------------------------------------------------------
Existing render status / per-format results / downloads / New project
```

The grouped track rows above are schematic. Preserve the actual existing lane order and conditional visibility; do not reorder tracks or merge audio lanes to match the sketch.

Desktop targets: 56px application bar, 12px outer workspace padding, 8px panel gaps, approximately 240px Media Bin and 300px Inspector, with the monitor taking remaining width. Allow side columns to grow modestly on large displays; use available window width instead of a narrow centered marketing-page maximum. These are shell targets, not permission to change time-to-pixel mapping or media composition.

Aim for approximately 40% of usable height for the timeline at 1440x900, while allowing existing lane heights and all track access. Preserve timeline lane and handle geometry. Use scrolling rather than squeezing tracks to meet the percentage. Avoid panel resizing handles, docking, fullscreen modes, and layout persistence. Short windows may scroll vertically; no fixed footer or overlay may obscure the last track or downloads.

### Top bar

Use the existing wordmark, a compact project identifier, current service status, and existing project/render actions. Do not add Save, Open, autosave, or project persistence controls. Keep New project available only under its current conditions and with its current reset semantics.

Place the existing Render MP4 submission control at the right when feasible without changing its owner or mounting lifecycle. It must retain the same callback, busy/disabled state, and associated readiness reason. There is one submission control, not a new Export action with different behavior. Keep export-format settings in Inspector Delivery and downloads in the existing result region. If moving the submission control cannot preserve these contracts, retain its current location for this milestone and flag the top-bar target as unmet rather than adding a second action.

### Media Bin

Use a small `Media Bin` title, compact import labels, and rows with media type, filename, meaningful metadata/status, and existing reuse/removal controls. Keep import-and-append distinct from import-for-reuse: a shared label must not conceal their different effects. Preserve existing limits and accepted file types.

Group existing clip, music/audio, and image-overlay entry points visually in the left media area. Reusable video/audio remain the existing bin model; image import remains the existing overlay action. Do not imply reusable image placement, new categories/filters, or image drag/drop support. Keep overlay configuration in Inspector and preserve the image upload's existing state and handler even if its label is visually grouped with media entry points.

Use existing thumbnails only. Do not add fabricated thumbnails, waveform imagery, metadata, or sample assets. Truncate long filenames visually where necessary and expose the full name in the accessible name and tooltip. Keep placement, PIP reuse, removal, and non-drag alternatives reachable without hover.

### Program Monitor

Use a compact `Program` heading, neutral dark surround, and the existing canvas. Place transport and the existing time/frame output together below it. Play/Pause may use its familiar icon with the existing state-specific accessible name. Do not add transport functions or shortcuts.

Keep preparing, stopped, decode-error, unavailable-source, and audio-resume messages and actions visible at the monitor. Retain the truthful approximate-preview and sound-availability information. A small notice can occupy one line in a ready state; errors may wrap. No promise of frame-exact or complete audio preview is introduced.

### Contextual Inspector

Keep the existing disclosure sections and selection-driven opening behavior. Express context using the selected section's heading, a compact selected filename, aligned label/value rows, and section spacing. Do not replace disclosures with exclusive tabs, automatically close sections, remove chooser controls, or hide unselected settings.

Preserve every existing trim, speed, replacement, overlay, audio, placement, and Delivery control with its current apply/save/cancel semantics. Keep field units and constraints explicit. Retain the exact useful distinctions between source frames, project frames, durations, offsets, and samples. Export settings stay reachable with no selection. Validation associated with another section remains visible through the existing alert/review path.

### Timeline and Timeline Tools

Retain one compact sequence header with FPS, effective FPS, duration, and current validation/context messages. Avoid displaying the same oversized sequence title twice; keep its semantic heading structure.

Keep Timeline Tools as the existing compact rail beside the tracks on desktop. Use current undo, redo, split, and delete icons with accurate tooltips and accessible names. Do not add decorative inactive tools or global shortcuts. Retain keyboard hints in accessible descriptions/tooltips and existing contextual guidance where needed.

Fixed track labels must remain readable while scrolling horizontally. Retain the ruler, shared lane alignment, and current content minimum width; all lanes scroll together. Use text plus a small type accent to distinguish Video 1, Video 2, Original/Replacement Audio, Music, and Overlay/PIP. Retain image/PIP sublane distinctions and linked/detached audio indicators. Do not change conditional tracks into permanent empty tracks.

Use existing blue/cyan picture and green audio families. Video 2 may use a restrained existing purple accent; overlay/PIP may use an existing muted contrasting accent. Labels and state marks carry meaning independently of color. Selection uses a clear border; focus uses a separate outer ring. Invalid ranges and drop errors remain distinguishable from selection. Never enlarge a short clip's timeline width to fit its text; preserve inspector/list access to very short occurrences.

## Text-removal rules

Classify text by purpose before removal. Remove redundancy, not information required to predict or recover from an action.

| Text type | Required treatment |
| --- | --- |
| Marketing heading, tagline, decorative introduction | Remove from the editor workspace. Keep the AVStudio identity. |
| Oversized or repeated panel title | Keep one compact visible region title and appropriate semantic/accessibility names. |
| Repetitive generic helper sentence | Remove only if it adds no unique instruction, limitation, state, or consequence. |
| Essential input/action label, unit, value, track identity | Keep visible; familiar unambiguous actions may use icons with complete names/tooltips. |
| Status, error, validation, disabled reason, capability limitation, recovery | Keep visible and associated with its control or affected region. Never tooltip-only. |
| Keyboard hint | Keep in an accessible description and hover/focus tooltip; retain contextual visible hints when necessary for discovery. Do not invent shortcuts. |
| Unique editing consequence or non-obvious instruction | Keep concise visible text beside the control. Do not discard or conceal it solely to meet density targets. |
| Accessibility label or relationship | Preserve meaning, IDs, descriptions, state announcements, and unique control identification. Never remove because it is not visible. |

Examples grounded in current UI:

- `Project media bin` becomes `Media Bin`; retain its region name and all import/reuse controls.
- The repeated bin introduction about dragging or choosing Place on Track can be omitted when both routes remain clearly discoverable. Keep placement validation and errors.
- `Use [long filename] as PIP` may display `Use as PIP` beside that filename; the accessible name still identifies the source. Keep this action textual because its placement consequence is less universal than Play.
- The ready-state render sentence may be removed when readiness is clear. Keep every blocking reason and the message that MP4 is included; optional format availability remains explicit.
- Condense source metadata into aligned values, retaining dimensions, FPS, browser-estimate qualification, source ranges, and speed.
- The replacement explanation must retain the strict-inside-playhead constraint, cut-frame ownership, matching donor source time, donor consumption, and preserved order of other Video 1 clips. It may wrap into concise sentences; it cannot become a generic replace tooltip.
- Preserve approximate preview, PIP EOF guidance, independent-audio/drop warnings, render-includes-overlays/audio information, and keep-tab-open processing guidance. A repeated copy may be removed only when the same information remains visible at the relevant point of use.

Do not use blanket paragraph hiding, truncation of errors, global heading suppression, or CSS that removes screen-reader content. When uncertain whether copy is redundant, retain it until its semantics are verified.

## Visual system and states

Reuse current fonts, installed icon library, and local SVG brand assets without new assets, fonts, packages, or remote requests. Use the existing background `#0b0d16`, panel `--card: #131622`, text `#f1f1f7`, muted `#a5a7bc`, line `#292c3f`, and accent `--purple: #ad9bff` as the starting palette. Muted panel separators are decorative; meaningful control/focus boundaries require stronger contrast. Keep brand artwork unchanged. Reduce the existing broad decorative page glow in the future shell; no new decorative gradients, glass panels, metric cards, oversized rounding, or heavy shadows.

Use a 4px spacing rhythm: 8px control gaps, 12px panel padding, 16px section separation. Target 13px body/control text, 12px metadata, and 13-14px semibold region headings. Keep existing timeline target sizes and gesture geometry; typography must not reduce hit areas. Existing 44px primary and timeline-tool targets remain at least that size. Other compact controls need at least 24x24px targets with adequate separation; prefer 32px for non-timeline icon actions and 44px when space permits.

| State | Presentation contract |
| --- | --- |
| Default/hover | Neutral surfaces; subtle hover border/background without layout shift. |
| Active/selected | Persistent accent border and explicit state semantics; selection does not masquerade as keyboard focus. |
| Disabled | Legible label, unavailable styling, unchanged disabled predicate, visible relevant reason. Do not rely on opacity alone. |
| Empty | One short context-specific instruction and existing available actions; no illustrations or tutorial paragraphs. Keep real track empty states. |
| Metadata/loading | Existing source-specific status, stable row space where possible, no fabricated completion value. |
| Preview preparing/failure | Current truthful status and recovery actions; never imply playback success from elapsed time. |
| Upload/queued/rendering | Existing actual stage/status and edit locks; indeterminate indicator unless real progress is already available. No invented percentage, ETA, Cancel, or unlock. |
| Partial/complete exports | Preserve each format's independent readiness, failure/retry, playback/download links, and reset availability. Do not label all exports ready when only MP4 is ready. |
| Error | Readable wrapping text, affected control/region, existing recovery action; never color alone. |

## Responsive and short-window behavior

Desktop remains the intended professional workflow. These are layout accommodations using the same components, controls, state, and media instances; no alternate editor route or mode.

| Available CSS width | Layout |
| --- | --- |
| 1280px and above | Three-column upper workspace and full-width timeline; compact bar actions remain visible. |
| 900-1279px | Media plus monitor columns; Inspector full-width beneath them, followed by timeline and results. Header actions wrap if required. |
| 320-899px | Single-column media, monitor, Inspector, timeline, results. Header wraps into visible action rows. Use existing disclosures; do not introduce drawers or hide settings/actions. |

Use wrapping or stacked field rows rather than clipping. Compact branding may use the existing icon and AVStudio text. Do not move required actions into an overflow menu. Keep format choices, disabled explanations, reset/retry, and downloads reachable at all widths.

Only the timeline's own content scrolls horizontally; preserve its existing 760px minimum inner width and fixed headings. No page-level horizontal overflow at 320px. Timeline Tools may wrap above the scroller on narrow widths using the same control instances. Do not scale lanes to fit, change frame mapping, or intercept touch/pointer events differently.

At heights below 800px or at 200% zoom, favor ordinary vertical page scrolling over rigid viewport locking. Independent panel scrolling on spacious desktop screens must leave panel headings and focused controls reachable. Sticky elements cannot cover focus, error messages, the ruler, or the last lane. Media stays mounted across reflow; no breakpoint-specific duplicate monitor or inspector.

## Component and file boundaries for a future UI change

All paths below describe ownership, not files changed by this task.

| Boundary | Permitted future presentation responsibility | Protected boundary |
| --- | --- | --- |
| `App.tsx` header and composed markup | Compact brand/status/project actions; reuse existing submission presentation if safe | State, predicates, callbacks, probes, polling, manifests, resets, source ownership |
| `EditingWorkspace.tsx` and `.css` | Workspace shell, spacing, region chrome, copy | Selection effects, shortcuts, edit handlers, history, transport/audio bindings, mounted identities |
| `MediaBin.tsx`, `UploadCard.tsx`, `ClipList.tsx` | Compact existing rows, labels, current upload/reuse affordances | Import/append distinction, source model, validation, drag/drop wiring, file accepts |
| `Inspector.tsx` and existing editor/control components | Aligned fields, compact sections, clear selected context | Disclosure and selection behavior, all fields, transactions, save/cancel semantics |
| `ProgramMonitor.tsx` | Outer title, transport chrome, state typography only | Media subtree, refs, keys, events, effects, audio/EOF/synchronization and canvas geometry |
| `ProjectTimeline.tsx`, `.css`, track/trim components | Label chrome, tool styling, track state contrast | Lane order/geometry, time calculations, ruler mapping, drop bounds, trim/gesture hit targets |
| `ExportOptions.tsx`, `MergeSummary.tsx`, `JobResult.tsx` | Compact current settings, submission/readiness, per-format status/result presentation | Export choices/defaults/capabilities, job lifecycle, retry/download/reset logic |
| `styles.css` | Scoped shell typography, spacing, colors, focus and responsive rules | Avoid broad selectors that alter dialogs, timeline metrics, or media visibility |

No new stateful workspace framework, generalized design-system migration, component renaming campaign, or internal behavioral refactor. Do not split components containing playback effects merely to make files smaller. If a small presentational wrapper is eventually necessary, it receives current display values and callbacks; it owns no editor, transport, source, history, or job state. Do not add files preemptively.

Leave `frontend/src/hooks/*`, `frontend/src/lib/*`, source-probe components, backend, package/config files, tests, and existing playback verification work unchanged in this design-only task. A later presentation change must also leave behavior-owning hooks, helpers, probes, and backend untouched.

## Accessibility expectations

- Retain one main landmark and named Media Bin, Program, Inspector, Sequence timeline, and Render result regions. Compact visual headings retain a logical semantic order.
- Keep native controls, explicit labels/units, unique per-source action names, and appropriate selected/expanded/disabled states. Decorative icons are hidden from assistive technology.
- Icon-only actions have accurate accessible names and tooltips available on hover and keyboard focus. Preserve existing shortcut definitions and input/modal exclusions. Native title text alone is insufficient for essential instruction or unavailable reasons; keep those in associated visible text.
- Preserve current focus movement and dialog dismissal/containment. Responsive reflow does not steal focus; context selection retains existing behavior. Every action remains operable without dragging or hover.
- Normal text meets 4.5:1 contrast; large text and meaningful controls/state boundaries meet 3:1. Focus indicators are visible on every surface. Type, text, and state marks supplement lane colors.
- Status changes use existing polite announcements; blocking errors remain clear. Do not announce every playback frame or pointer movement. Preserve the time/frame output's non-live behavior.
- At 200% zoom and with long/localized text, allow wrapping and scrolling without obscuring required actions. Respect reduced motion; no decorative animation or flashing render feedback.

Accessibility fixes requiring new keyboard behavior or changed control semantics must be identified separately for authorization, rather than silently folded into visual cleanup.

## Future visual regression coverage

Use existing installed tools and fixtures in a separately authorized implementation task. Do not modify or generate tests, baselines, screenshots, or packages now. Existing behavior/E2E assertions must not be weakened to approve a cleaner layout. If additional screenshot automation requires test changes, obtain separate authorization then; manual comparison can document the design meanwhile.

Capture before/after at 1440x900 and 1920x1080, plus 1280x720, 1024x768, 768x1024, 320x800, and a 1440x600 short window. Include desktop 200% zoom and reduced-motion review. Compare the same source files, project values, frame, selection, job fixture, and export capabilities. Stable fixtures may control clocks/network in existing test infrastructure; never add product delays or change media behavior to stabilize screenshots.

Required state coverage:

1. Empty workspace; media loading and metadata error; long source names and populated reusable sources.
2. Video 1 selected, Video 2 selected, image/PIP selected, independent audio selected, and music selected; include one-frame/short intervals and horizontal scrolling with fixed labels.
3. Inspector disclosures, replacement guidance, trim/placement dialogs, visible validation and disabled reasons; keyboard focus distinct from selection.
4. Monitor ready, preparing, picture failure, audio resume required, and PIP before/after EOF using the same existing behavioral fixtures. Static images assess presentation only.
5. Current valid/invalid drag ghosts, drop warning, and render-locked state; no claim that screenshots verify placement correctness.
6. Upload, queued, rendering, render failure, polling failure/retry, partial export availability, per-format completion/failure, downloads, and New project under existing conditions.

Verify layout, clipping, spacing, readable labels/errors, contrast, tooltips, action reachability, lane distinction, fixed labels, and absence of decorative filler. Mask changing timecodes only for static layout comparisons; never use masking to conceal a playback failure in behavioral evidence. Do not overwrite known-failing playback evidence or bless unresolved failures as new expected behavior.

## Manual UI acceptance checklist for later implementation

- [ ] At desktop size, the hierarchy reads as top bar, media/monitor/Inspector, then primary timeline; no marketing introduction or oversized duplicate title remains.
- [ ] Inventory every existing control before and after. Match handler, value, availability, accessible name, shortcut, and recovery route; account for each copy removal using the rules above.
- [ ] Import-and-append, reusable imports, image overlay upload, PIP reuse, Place on Track, removal, and existing drag/drop retain their current distinct results and non-drag alternatives.
- [ ] Trim, split, ripple delete, Delete/Backspace, undo/redo, version replacement, Video 2, independent audio, and music preserve their current behavior. Compare project state/history before and after equivalent actions.
- [ ] Observe current playback and audio behavior at source/Video 2 boundaries, PIP EOF, seeking, edits, and responsive reflow without changing playback code. Record any unresolved baseline behavior separately; a screenshot does not close verification work.
- [ ] Fixed track labels, ruler alignment, scroll position, short-item access, trim handles, and drop coordinates remain correct; no shell change shifts placement to another frame.
- [ ] Canvas proportions, overlay positions/sizes, and EOF visibility remain unchanged. No responsive duplicate/remount interrupts media or pending work.
- [ ] MP4 remains mandatory and optional MOV/WAV/MP3 retain capability gating, selection, submission, per-format results, downloads, errors, retries, and current job locks. Use existing rendering verification evidence/workflows; do not change exports to satisfy UI acceptance.
- [ ] Empty/loading/disabled/error/partial-result states remain truthful and actionable. No fabricated progress, hidden warning, or unavailable action looks enabled.
- [ ] Keyboard-only access, focus restoration, dialogs, visible tooltips, screen-reader names/statuses, contrast, long text, 200% zoom, short windows, and narrow layouts pass review. Required actions remain reachable and the timeline scrolls within its region.
- [ ] Review the eventual diff for accidental behavior edits. Leave unresolved playback verification explicitly open; any new regression blocks UI acceptance and must not be repaired through an unreviewed functional change.

## Explicitly out of scope

New editing features; new track types; image-bin reuse; new import/placement semantics; timeline scaling/zoom; docking/resizing/persistence; new transport controls or shortcuts; playback fixes or verification resolution; audio/EOF/decoder changes; backend/API/schema changes; rendering or export changes; new output formats or presets; project save/load; new packages/fonts/assets; configuration changes; deployment; branches, commits, pushes; and a mobile/beginner editor mode.

No application, test, configuration, or backend implementation is part of this deliverable. No test suite, live playback, or render is claimed as verified by writing this specification.

## Self-review

Reviewed for contradictions, accidental functional changes, and ambiguous text removal:

- Presentation goals yield to the preservation contract. Desktop density cannot change timeline/frame geometry, media composition, or current hit targets.
- Top-bar submission is a relocation target for the existing control, conditional on unchanged ownership and lifecycle; it does not add a new export workflow or a duplicate button.
- Contextual Inspector styling preserves disclosures and all controls rather than adding exclusive tabs or hiding settings.
- Media grouping does not imply new reusable image support. Version replacement and Video 2 replacement stay distinct.
- Text reduction explicitly protects status/errors, disabled reasons, unique editing consequences, keyboard hints, preview limitations, and accessibility information. Only verified redundancy can disappear.
- Narrow layouts reflow the same instances and preserve required actions, internal timeline scrolling, and focus. No separate mobile editor is introduced.
- Current MP4/MOV/WAV/MP3 semantics take precedence over historical MP4-only documents. No export or playback behavior is redesigned.
- Visual regression and manual checks are future acceptance requirements, not test changes or verification claims made in this task. Unresolved playback work remains open.
- Scope is limited to this specification; no implementation, test changes, package/configuration changes, backend work, or version-control mutation is authorized.
