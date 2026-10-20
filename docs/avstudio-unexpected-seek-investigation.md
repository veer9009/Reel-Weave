# Unexpected same-source preview seek investigation

Checkpoint: 2026-10-18, Asia/Calcutta. Phase 1 is incomplete. No production fix is justified yet; Phase 2 audio acceptance and Phase 3 UI work remain gated. Existing working-tree audio changes were preserved. No configuration, package, threshold, assertion, Git history, or system setting was changed.

## Exact supplied reproduction and evidence

The supplied local run used `npm.cmd run test:e2e -- playback-continuity.spec.ts --grep "same-source split preserves decoder and presented frames at speed 1$"` from `frontend`. Its artifacts remain in `frontend/test-results/playback-continuity-same-s-4e5f8-presented-frames-at-speed-1/` and were not overwritten.

The test generates the existing six-second 60-FPS H.264/AAC regression clip, imports it with take-a.mp4, sets project FPS 25 and speed 1, selects the base preview, starts playback, waits for video time above 0.3 seconds, samples, clicks Split at playhead, and samples again. It asserts stable decoder/source, no additional seek or pause, and progress within the existing 40 ms limit. No assertion was changed.

Read the supplied boundary records, split-media-events, error context and trace archive, plus playback/audio hooks, ProgramMonitor, history/transport mapping, split/version-replacement paths, and existing synthetic preview tests. Searched every frontend currentTime assignment. Main program-video positioning writes through usePreviewMedia.position; other video writes belong to PIP, source probing or trim preview. Audio positioning writes through useProjectAudio.syncVoice.

Supplied trace, ordered by browser performance.now():

| Time (ms) | Observation |
| --- | --- |
| 11950.6 | Pre-split sample: picture 4.377362 s, rendered frame 109, zero seeks/source writes. |
| 12432.3 | `usePreviewMedia.sync → position → currentTime` writes **4.657154 → 4.637539999994041 s**, frame 115, playing, not seeking, readyState 4. |
| 12434.8 | Application pauses picture after the write; seeking=true, readyState=1. |
| 12475.6 | Application pauses audio at 4.451137 s, frame 116, readyState 4. |
| 12486.6–12487.1 | Browser dispatches seeking, waiting and pause for the picture. |
| 12519.2 | Picture play requested at 4.637539 s. |
| 12520.0 | Audio play requested at 4.491171 s. |
| 12623.3 | Post-split sample: same picture node, picture 4.700887 s, frame 116, one seek, no source writes. |

The picture write is a backward correction of 19.614 ms. Picture play follows approximately 86.9 ms later. The immediate sample window has 323.525 ms native progress over 672.7 ms wall time (349.175 ms residual). These are supplied-run measurements, not fresh verification here. The first explicit disruptive operation in this boundary sequence is the video seek; pause/buffering follows it. There is no preview pause recorded immediately before that write. Earlier historical pause-then-seek explanations therefore cannot simply be assigned to this run.

The failing assertion is exactly zero expected seeks versus `[4.637539999994041]`. The later error snapshot also reports an audio play failure, but records no underlying exception. It is not proof of the initiating cause.

## Guard analysis and remaining uncertainty

The writer is proven by the recorded stack. `position()` writes when the element/source/duration are valid and native versus requested time differs by more than 1 ms. The observed 19.614 ms difference satisfies that guard. The open causal question is **why sync set or retained request.needsPosition**.

In sync, needsPosition can originate from source/mapping/position-revision changes, a retained pending request, or the readiness-resume correction. A generation change makes a fresh request but does not alone mandate repositioning. The same node/source rules out a URL swap as the direct cause. The observed pre-write native delta is below the speed-1 resume threshold of 40 ms, which makes assuming that guard unsafe; the values at the earlier decision point were not recorded.

The source snapshot shows browser-estimated source FPS 59.998800023999515, left source trim 0–278, right trim 279–359, and project windows 0–115 and 116–149. Legacy split rounding and request mapping transitions deserve tracing, but those facts alone do not prove a mapping defect. The source/projection, live clock, rendered frame and revision values must be captured at the actual decision.

No single cause is established for replacement handoffs, slow-speed failures, genuine buffering, and native A/V divergence. Prior reports contain gate, mapping and resume fixes, but do not prove three failed fixes to one established architectural cause. No rewrite or fourth speculative correction is recommended.

## Temporary test-only diagnostics

Added `frontend/e2e/previewSeekDiagnostics.ts`, installed by the existing continuity beforeEach. Playwright instruments only test-served JavaScript responses for the three hooks. It records decision flags, old request mapping, requested/live project time, generation/revision/token state, edit actions, readiness transitions, picture clock observations, native media states, before/after seek values and stack, and audio play-rejection details. Existing media-call logging remains intact. The afterEach writes `seek-diagnostics.json` beside existing artifacts.

No production file, guard, media operation, test assertion or timing bound is changed. Missing instrumentation markers fail explicitly. Diagnostic capture can affect scheduling; an instrumented run establishes causal evidence, not final uninstrumented visual/timing acceptance. Remove the temporary instrumentation when the investigation is complete, under the applicable file-preservation instructions.

Next diagnostic command, from frontend:

```text
npm.cmd run test:e2e -- playback-continuity.spec.ts --grep "same-source split preserves decoder and presented frames at speed 1$" --output=../var/preview-seek-investigation-instrumented
```

Compare `picture-position-request` and its preceding `picture-decision`/`transport-edit`/`audio-gate` records to identify the first guard that requests positioning. Reproduce that exact condition in a focused failing regression before any production correction. Then validate uninstrumented split/replacement, slow speeds, buffering and A/V alignment before proceeding to Phase 2.

## Checks and blocker

The fresh existing E2E attempt (before adding diagnostics) used the command above with output `../var/preview-seek-investigation`. Exit 1 before browser execution: Vite/esbuild reported `Cannot read directory "../../../..": Access is denied.` and could not resolve frontend/vite.config.ts. No escalation or loader/server/configuration workaround was attempted.

The focused synthetic hook command `npm.cmd test -- src/hooks/usePreviewMedia.test.tsx src/hooks/useProjectPlayback.test.tsx --maxWorkers=1 --pool=threads` also exited 1 at the same configuration-loading failure. Zero tests executed; no test pass/fail counts are available from those commands. The supplied 19/19 audio result remains user-reported local evidence, not a rerun here.

TypeScript `tsc -b --pretty false` and targeted ESLint passed. New-helper formatting was corrected after its first check; its final Prettier check passed. `git diff --check` passed. The static harness `node ../var/check-preview-diagnostics.mjs` validated injection markers and generated-JavaScript syntax for all three hooks using TypeScript-transpiled source; 3/3 modules passed. This does not establish that instrumentation ran in Vite or a browser. An earlier stdin-piped version of that optional static harness stalled and was interrupted, with no result claimed. Full frontend/backend/FFmpeg/browser/UI acceptance is not claimed and later phases were not run with Phase 1 unverified.

New work in this checkpoint: temporary E2E diagnostics and this report only. Pre-existing modified audio files and the earlier untracked continuation report remain intact. No commit, push, installation or deployment occurred.
