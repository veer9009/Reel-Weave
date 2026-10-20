# AVStudio presentation clock ownership patch

**Status:** Rejected by manual acceptance. After the final checks below, the user reported: "Still jump in pausing and playing" for the latest clock-ownership/readiness-boundary candidate. The defect remains unresolved. Passing automated checks and absence of recorded preview seeks do not establish visible continuity.

Continuation: the user clarified both picture and timeline playhead jump. See [resume readiness coordination](avstudio-resume-readiness-2026-10-19.md) for the subsequent real-audio integration regression and minimal startup-gate candidate. This document retains the earlier rejected candidate's evidence; it is not a final acceptance report.

Further production changes are paused while reassessing clock ownership across the transport, decoder presentation, and audio readiness. A separate test-only trace, `frontend/e2e/pause-resume-display.spec.ts`, records rendered DOM positions, actual pause call/return boundaries, and delivered video-frame metadata. It preserves the earlier diagnostics and does not claim physical-display capture or use a native-time/wall-clock residual as acceptance.

## Investigation after manual rejection

The separate display trace completed (1 diagnostic journey, exit 0). This means the trace was collected, not that playback passed acceptance. Evidence is retained in `var/pause-resume-display-rejected-2026-10-19/pause-resume-display-trace-55baf-sume-before-and-after-split/display-diagnostics.json`.

It records 409 observations and no backward DOM-position transition. It does reproduce an unnecessary video start/pause/start sequence at each resume, with a forward rendered-position discontinuity:

| Boundary | Video start | Native pause return | Preparing position | Second video start |
| --- | --- | --- | --- | --- |
| Resume before split | 12607.8 ms, frame 67, source 2.709988 s | 12610.6 ms, source 2.761673 s | 12637.3 ms, frame 69 | 12805.0 ms, frame 69 |
| Resume after split | 21302.8 ms, frame 202, source 8.106810 s | 21303.9 ms, source 8.160347 s | 21325.3 ms, frame 204 | 21479.9 ms, frame 204 |

These are native call boundaries and actual DOM publications. Frame-delivery metadata is retained separately and is not used to infer continuously sampled display pixels. A callback gap is not classified as a freeze.

The traced ordering agrees with the call path: EditingWorkspace's resume handler calls resumeAudio without awaiting it, then toggle changes transport directly to playing. ProgramMonitor's child layout effect can start native video before the parent's audio synchronization suspends it for readiness. Pausing video synchronously on suspension prevents the prior backward seek but does not prevent this premature first start. The mocked integration regression did not include the real audio readiness participant, so it could not detect this startup ordering.

Architectural direction for discussion: resume should establish readiness for the same generation before native video starts; a ready local source should start once from its held presentation position. First add an integration regression with real transport/preview/audio readiness ordering, then change the smallest resume-coordination boundary. Preserve audio ownership, existing seek thresholds, explicit seeks, and structural mapping semantics. This is not implemented or claimed to explain every symptom of the user's actual project; clarification of whether the picture, playhead, or both jump remains pending.

After multiple rejected candidates, the [systematic-debugging skill](C:/Users/DELL/.codex/plugins/cache/openai-curated-remote/superpowers/6.4.2/skills/systematic-debugging/SKILL.md) explicitly instructs: "Discuss with your human partner before attempting more fixes" after three or more failed fixes. That is why this turn gathers evidence and raises the readiness-ownership issue instead of adding another production correction.

Local command from frontend: `npm.cmd run test:e2e -- pause-resume-display.spec.ts --output=../var/pause-resume-display-local`.

Checks for this diagnostic-only continuation: browser trace completed exit 0; frontend lint exit 0; new spec Prettier check exit 0; diff check exit 0. Original four diagnostic hashes still match the preservation baseline. No further production changes, commit, push, or deployment were made. The previous 354-test/build results apply to the unchanged production candidate and do not override the user's rejection.

## Scope and investigation

Read useProjectPlayback, usePreviewMedia, ProgramMonitor, and ProjectTimeline completely, plus the split planners, EditingWorkspace split/toggle handlers, App.splitAtPlayhead/commitClips, and history capture/apply mapping. Subsequently read useProjectAudio to trace the reported Preparing Preview state; its code remains unchanged.

The split toolbar passes the rendered playhead frame to App.splitAtPlayhead. The existing planner creates inclusive source trims or output windows; commitClips preserves child source lineage. useEditHistory.apply captures the live transport anchor before constructing the before/after projections, then calls useProjectPlayback.applyEdit.

## Proven conflicts

1. applyEdit replayed a captured/source-remapped position and reset elapsed-time accounting at apply time. That loses time spent constructing the edit. Legacy fragments also have independently rounded project durations, so their source-to-project inverse is not necessarily the original presentation position.
2. The decoder can keep playing while a structural split changes the projection origin. Converting its subsequent frames with the edited origin can shift the project clock even though the source did not move.
3. The transport extrapolated picture timestamps using wall time. The actual decoder may already be stationary before its waiting event or next frame callback reaches JavaScript. The published clock can then get ahead of the picture, and the existing readiness-resume guard seeks the picture to that prediction.
4. An unrelated React render could publish the older stored frame from a delayed picture callback even after native clock sampling had been introduced.
5. Audio readiness could freeze the transport before React paused native video. The latest browser rerun independently reproduced video progressing from 2.058075 to 2.103770 s during that boundary, followed by a seek back to 2.058075 s. The same sequence occurred after splitting. Native-clock ownership alone therefore did not eliminate the resume defect.

The lightweight browser journey reproduced a post-split resume VIDEO currentTime write from 3.720 s to 3.827758 s, followed by Preparing Preview. The stack points to usePreviewMedia.position through sync. This is evidence of the native positioning operation and its readiness transition, not physical-screen capture or proof of a displayed freeze.

## Current correction

Production changes are limited to three files:

- useProjectPlayback.ts: preserve live position through a running split, distinguish continuous presentation from intentional project remapping, accept a picture-clock adapter, and publish the current clock frame consistently. Pause the bound picture synchronously before sampling manual-pause or readiness-suspension anchors.
- usePreviewMedia.ts: retain the decoder's presentation origin through continuous edits and pause/resume; transform it by the mapping delta for intentional relocations without native positioning. Supply a native picture-clock reader after a genuine requestVideoFrameCallback observation and a synchronous pause operation. Retire interrupted play attempts when that operation runs. Explicit positioning establishes a new origin.
- ProgramMonitor.tsx: connect that clock adapter. The earlier button-specific pause wrapper was removed; the transport owns the boundary for all pause/suspend callers.

The existing fallback remains when native video-frame observation is unavailable. No split planner, source trim, output window, export/render, backend, history policy, FPS policy, audio ownership, audio hook, package, configuration, or system-setting code was changed. Existing readiness/seek thresholds and existing assertions remain unchanged.

## Focused TDD evidence

New regression: frontend/src/components/SplitPlayback.test.tsx. It uses the real split planner, advanced projection, transport, Program Monitor, and ProjectTimeline at speeds 1, 0.75, and 0.5. jsdom supplies controlled native media state and frame observations at the browser boundary.

| Contract | Observed failure before the relevant correction | Expected result |
| --- | --- | --- |
| Split commit preserves time through capture/apply | Frame 25 after a commit crossing the frame boundary | Frame 26 |
| Next presented picture preserves the running origin | Frame 26 at 1x | Frame 27 |
| Pause/resume preserves presentation mapping | Frame 28 at 1x | Frame 29 |
| Stationary native clock cannot advance the display through wall time | Frame 31 at all three speeds | Frame 29 |
| Delayed frame callback plus unrelated render cannot publish an old frame | Frame 28 at all three speeds | Frame 29 |
| Native pause happens before delayed React work | Frame 31 at all three speeds after resume | Frame 29 |
| Readiness suspension freezes picture before delayed React work | Frame 31 at all three speeds after ready | Frame 29 |
| Intentional reorder remains a project relocation | Frame 4 rebased to frame 3 at 1x | Hold frame 4 until native progress |

The latest focused run passed 43/43 tests in five files after reducing repeated DOM queries in the new test. Its assertions and five-second timeout were preserved. Earlier isolated runs sometimes hit that timeout; those runs are not counted as passes.

This is deterministic rendered-state coverage, not physical display acceptance. No native-currentTime/wall-clock residual is used by the new regression to infer a visible freeze.

## Browser evidence

A new independent test-only journey, frontend/e2e/pause-resume-readiness.spec.ts, records native media calls/events and Preparing Preview transitions before and after a running split. It leaves production callbacks intact and avoids per-frame runtime snapshots. Records are saved at action boundaries and retained on failure. Its longer fixture is a test-only stream-copy repetition of the existing continuity source.

Artifacts retained in distinct directories:

- var/split-playback-clock-2026-10-19/: the three existing split cases ran against an earlier candidate and failed their unchanged native-time residual assertion. These failures are not used as visual acceptance signals.
- var/pause-resume-readiness-2026-10-19/: initial six-second attempt reached EOF before the intended Pause action and timed out; its empty diagnostic JSON is not useful readiness evidence.
- var/pause-resume-readiness-long-2026-10-19/: instrumented-hook journey completed; it records readiness/seek interactions and two audio AbortError rejections after pause interrupted play. Runtime snapshot instrumentation can affect scheduling.
- var/pause-resume-readiness-light-2026-10-19/: lightweight journey completed without hook rewriting. It independently records the 3.720 to 3.827758 s preview seek above. This predates the native-clock ownership candidate.
- var/pause-resume-readiness-native-clock-retry-2026-10-19/: completed with exit 0; recorded preview seeks during both pre-split and post-split resume. This rejected the native-clock-only candidate and led to the readiness-boundary regression above.
- var/pause-resume-readiness-boundary-2026-10-19/: same journey completed with exit 0 after the boundary correction. Of 148 event records, zero VIDEO currentTime writes originated in usePreviewMedia. Preparing Preview still appeared during audio readiness (six transitions including initial preparation); it no longer induced the recorded preview seek. This journey runs at 1x and does not establish physical-display smoothness or clip-change acceptance.

A completed diagnostic journey does not establish smooth playback.

## Verification

Latest focused command, from frontend:

```powershell
npm.cmd test -- src/components/SplitPlayback.test.tsx src/hooks/useProjectPlayback.test.tsx src/hooks/usePreviewMedia.test.tsx src/components/ProgramMonitor.test.tsx src/lib/transportMapping.test.ts --maxWorkers=1
```

Result after the readiness-boundary correction: 5 files, 43 tests passed, exit 0 (44.87 seconds).

A fresh full frontend run against the final readiness-boundary correction passed **43 files and 354 tests, exit 0**, in 600.25 seconds. Command: `npm.cmd test -- --maxWorkers=1` from frontend.

The previous native-clock candidate run reported the same passing count in 521.95 seconds but returned **-1073741819** after the summary. That earlier abnormal runner exit is preserved here; its cause was not established. It is superseded for final-patch test verification by the clean run above.

Final boundary-correction checks: lint exit 0; changed/new code Prettier check exit 0; diff check exit 0; `npm.cmd run build` exit 0 (TypeScript and 1,783-module Vite bundle). Repository format check exits 1 only for the three unchanged files listed below. Earlier npm build attempts printed success but exited -1073741819; the latest final-patch build completed normally. No system or configuration adjustment was made.

Previous full run: 39 files passed and 4 failed; 343 tests passed and 11 failed. This run loaded the earlier candidate before the final pause condition/native-clock changes. Ten failures were timeouts, whose baseline cause was not established:

- App.test.tsx: one-clip timeline handle shrinks the visible width during dragging.
- App.test.tsx: timeline handle source frames respect speed and explicit FPS and reach the Trim editor and manifest.
- App.test.tsx: drops one PIP through existing controls and safely validates replacement.
- App.test.tsx: structural overlay edits preserve preview intent without changing schedules.
- App.test.tsx: validates, edits, and submits one image and one PIP overlay.
- App.test.tsx: edits an inclusive frame range with one-frame controls and preserves it across speed changes.
- EditingWorkspace.test.tsx: audio_keyboard_lift_stays_distinct_from_explicit_ripple.
- EditingWorkspace.test.tsx: Split toolbar disables invalid cuts and exposes the nearby helper without invoking split.
- OverlayTrack.test.tsx: renders one labeled image slot and one labeled PIP slot.
- OverlayTrack.test.tsx: exposes inclusive schedule, position, size, metadata, and remove controls.

The eleventh failure was the earlier SplitPlayback 1x pause/resume assertion (28 instead of 29), subsequently corrected and rerun in the focused suite. Earlier successful lint/build checks do not substitute for final checks after the ownership change.

The first ordinary focused Vitest command stopped at esbuild's ancestor-directory access denial. Running the same existing configuration with approved filesystem access allowed TDD execution. No alternate configuration, loader, installation, or system-setting workaround was used.

Repository formatting previously failed on unchanged usePreviewMedia.test.tsx, useProjectAudio.test.tsx, and useProjectAudio.ts. Those files were preserved.

Independent read-only review found no confirmed regression in the clock patch or readiness-boundary delta. Remaining coverage limitations include a real second-source handoff, split undo/redo and FPS changes in the new integration journey, and deferred play-promise rejection during readiness. Existing relevant suites remain part of the full run; review is not a substitute for manual acceptance.

## Required manual acceptance

After the final checks and a page reload, play and use Split at Playhead strictly inside the selected Video 1 clip at each of 1x, 0.75x, and 0.5x. Check Program Monitor picture, displayed time/frame, and timeline playhead during split and pause/resume. All three manual results must be smooth before calling the defect fixed.

Existing local frontend and backend development commands were started for this manual check at http://127.0.0.1:5173. This does not deploy or modify backend code.

Local lightweight diagnostic command, from frontend:

```powershell
npm.cmd run test:e2e -- pause-resume-readiness.spec.ts --output=../var/pause-resume-readiness-local-2026-10-19
```

All pre-existing uncommitted diagnostic files remain intact; their four recorded SHA-256 values were rechecked unchanged. HEAD remains 4d2c849. No commit, push, or deployment was performed.
