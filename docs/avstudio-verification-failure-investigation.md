# AVStudio verification failure investigation

Date: 2026-10-18 (Asia/Calcutta).

Both failures predate the professional workspace UI cleanup. The audio ownership failure has a deterministic source-level cause. The browser failure reproduces without the UI changes, with multiple playback symptoms; the evidence identifies the pause/resume/seek path but does not establish one underlying cause for every timing failure. No UI regression is confirmed and no application or test correction is made. This is not release acceptance.

## Comparison and evidence

The working branch and backup baseline are `backup/avstudio-oct16`, HEAD `1c7777c829369840a6bd8bc8afd76a837d948584`. The earlier standing-gate report starts at `1e689c6`; it is historical context, not the immediate pre-UI baseline. The later backup commit already contains the failing ownership test and playback work.

Read the UI verification report, current diff, protected test implementation/output, continuity browser implementation/output, playback/audio hooks, audio ownership resolver, history/transport mapping, and earlier gate records. Relevant historical evidence:

- `var/professional-workspace-ui/baseline-unit-expanded.log`: ownership test already failed before UI edits; this was an incomplete broad run, not a passing baseline suite.
- `var/playback-focused-fixes.log`: pre-UI speed-1 split failed with 199.439 ms residual against 40 ms.
- `var/professional-workspace-ui/final-e2e/...speed-1/split-media-events.json` and `boundary-records.json`: UI verification's speed-1 failure had an extra video seek to 1.064967 s, with the same video node and no source-attribute replacement.
- `var/AVStudio-verification-2026-10-17.md`: seven standing gates, retained below.

Fresh evidence is isolated in ignored `var/verification-investigation/`. `git archive HEAD frontend` was extracted there, with a junction to the already installed frontend dependencies. No checkout, branch change, package installation or configuration edit occurred. The archive's original Vite configuration served the backup frontend on the existing port. The current unchanged Playwright test/configuration ran against that server; the backend was the same existing test backend. The served monitor module was checked for its old `Program preview` heading and absence of the new icon import. The backup server was stopped before returning to the current frontend.

`protected-audit.json` compares ten relevant implementation/test/configuration files with Git HEAD and the extracted archive. All match after CRLF normalization. The UI diff changes presentation, labels and icons; playback hooks, mapping, event handlers and media ownership remain unchanged. The earlier AST contract audit covers 51 handlers, 29 hook calls and two video subtrees. Static equivalence alone would not exclude a layout-dependent scheduling effect; the fresh backup browser failures provide the runtime comparison. These runs do not measure whether UI density affects failure frequency.

## Audio ownership: confirmed root cause

`useProjectAudio.ts:61` constructs targets from two different positions:

1. `transport.frame` selects the ownership interval (`:66`, `:97`).
2. `transport.captureAnchor().projectSeconds` supplies the live offset (`:69`).
3. The protected test creates adjacent linked video trims 0..24 and 25..149 at 25 FPS, then supplies rendered frame 24 and live time 1.01 s.
4. Frame 24 selects the first ownership interval, whose recipe ends at `(24 + 1) / 25 = 1.00 s`. The live offset yields target time 1.01 s.
5. `original.time >= original.end` clears the target (`:123`). `sync()` sees no target (`:397`) and calls `release()` (`:127`), which pauses, removes `src`, loads and releases the lease.
6. The test therefore receives `null` instead of `blob:base.mp4`. Live ownership should already refer to the adjacent second segment; the current code uses the previous segment's end to discard it.

This is not CSS, icon rendering, a monitor remount, test order pollution or an export failure: the hook test imports no changed UI component, fails alone, and fails identically from the backup archive. Existing tests where rendered and live positions agree pass, including same-file discontinuous audio/music mappings.

Boundary trace: `EditingWorkspace` supplies history snapshot, sources, projection and playback to `useProjectAudio`; `useProjectPlayback` exposes a rendered frame and a continuously sampled `captureAnchor`; `resolveAudioOwnership` produces correct half-open intervals; the consumer mixes their time bases. No fix is applied because the confirmed defect is pre-existing playback work, rather than a UI-caused regression.

## Speed-1 split: pre-existing playback failure, separate symptoms

The editing path is unchanged: the Timeline Tools click invokes the existing split action; `useEditHistory.apply` captures the live anchor before applying the snapshot; `mapTransportAnchor` maps the source position; `useProjectPlayback.applyEdit` advances generation and preserves intent. `ProgramMonitor` resolves the current source using the live project position and passes it, generation, position revision and playing state to `usePreviewMedia`. Presented video frames feed back through `observePicture`; audio and picture readiness both gate the transport.

The original UI-run extra seek is application-driven, not a new video element or URL: recorded stacks go through `usePreviewMedia.sync -> position -> currentTime`. Immediately beforehand, the picture and audio were paused through their existing sync functions. On a false-to-true playing transition, the existing preview code marks `needsPosition` when native time differs from the requested position by more than `0.04 * speed`; `position` then writes `currentTime`. In the recorded UI failure, native picture time was 0.66 s and the requested seek was 1.064967 s, a 404.967 ms discrepancy. This is an existing readiness/resume correction path. The old recording does not expose the gate token or internal `resumed`/`needsPosition` values, so it cannot alone prove which earlier event initiated that transition.

Fresh backup evidence independently reproduces the same pause/seek stack, without the cleanup:

- Backup run 1: video pauses 198.3 ms before the pre-split sample, then seeks from about 0.52431 to 0.715667 s, 155.6 ms before that sample. The sample window spans 322.2 ms while native time remains 0.715667 s. The residual assertion fails although there is no *new* seek inside the measured split window. Thus this failure is not evidence that the Split click initiated the interruption.
- Backup run 2: immediate post-split residual is 30.403 ms, within 40 ms, with the same node and no new seek. Later, existing picture/audio sync pauses both voices and picture seeks to 1.545433 s. The final page reports `Sound preview cannot play base60.mp4. Use Resume Audio or check browser decoding.` The audio play rejection path publishes failure and pauses transport; the expected Pause control consequently disappears. The rejection's underlying browser exception was not recorded, so its cause is not asserted.
- Backup run 3: 120.567 ms residual, with the same video, no source writes and no new pause/seek events within the measured window.
- Current isolated run: native time advances 657.793 ms while wall time advances 717.800 ms, yielding 60.007 ms residual. Same node, no source writes, no new seek and no new media events in that window. This is a clock-progress assertion failure, not a reproduced extra-seek assertion.
- Final current-UI recheck: the same residual assertion fails at 40.309 ms against the unchanged 40 ms limit. Its process exits normally with code 1.

`split-summary.json` retains the sample values, residuals, stacks and timing relative to each pre-split sample. The test observes native media progress against wall time across a Playwright click and can encounter readiness interruptions that began before that click. Its current preconditions do not guarantee uninterrupted playback at the exact pre-split sample. No assertion, tolerance, timeout or test is changed on that basis: the failures remain failures.

Conclusion: the speed-1 continuity failure is pre-existing playback/readiness/clock verification work, not introduced by the UI cleanup. The evidence does **not** establish that the stale-frame audio ownership bug causes every browser symptom, or that all timing variance is environmental. The precise origin of the decoder/wall-clock divergence and earlier readiness transitions remains unresolved; an isolated playback investigation would need internal gate/mapping and browser rejection diagnostics before proposing a runtime repair.

## Fresh verification

Commands run with installed dependencies, unchanged configuration and thresholds. Frontend command paths are relative to `frontend` unless indicated otherwise.

| Check | Exact result | Evidence under `var/verification-investigation/` |
| --- | --- | --- |
| Current isolated ownership test | Exit 1; 1 failed, 15 filtered/skipped; 13.94 s | `current-ownership-expanded.log` |
| Archived backup isolated ownership test | Exit 1; same 1 failed, 15 filtered/skipped; 8.13 s | `backup-ownership.log` |
| Current speed-1 browser test | Reporter: 1 failed, 46.1 s test duration; 60.007 ms > 40 ms | `current-split.log`, `current-split/` |
| Archived backup speed-1 browser, three serial repetitions | Exit 1; 3 failed; test durations 24.5/39.1/43.6 s; failures detailed above | `backup-split.log`, `backup-split/` |
| Final current-UI speed-1 browser recheck | Exit 1; 1 failed; 34.1 s test duration; 40.309 ms > 40 ms | `current-split-recheck.log`, `current-split-recheck/` |
| Affected frontend tests, eight files | Exit 1; 110 passed, 1 failed; 76.52 s | `affected-unit.log` |
| Protected source/archive equivalence | Exit 0; ten files match HEAD after CRLF normalization | `protected-audit.json` |

The initial sandboxed ownership attempt failed before running tests because esbuild could not read an ancestor directory. It remains in `current-ownership.log`; the expanded-permission rerun above reached the actual assertion. The first current browser runner reported its assertion failure and wrote trace artifacts, then its process exited with Windows code `-1073741819`; this is recorded separately from the reporter result and is not a normal exit-1 claim.

Ownership command: `npm.cmd test -- --maxWorkers=1 src/hooks/useProjectAudio.test.tsx -t audio_ownership_uses_the_live_position_when_the_rendered_frame_precedes_a_split` (also run from the extracted backup frontend).

Browser command: `npm.cmd run test:e2e -- playback-continuity.spec.ts --grep 'same-source split preserves decoder and presented frames at speed 1$' --output=../var/verification-investigation/current-split`. Backup comparison adds `--repeat-each=3` and uses its own output path. Repetitions gather evidence; they are not retries that turn failures into passes.

Affected frontend command selects `useProjectAudio.test.tsx`, `useProjectPlayback.test.tsx`, `usePreviewMedia.test.tsx`, `useEditHistory.test.ts` (Vitest's substring filter also selects the actual `.tsx` file), `audioTimeline.test.ts`, `transportMapping.test.ts`, `EditingWorkspace.test.tsx` and `ProgramMonitor.test.tsx`, with `--maxWorkers=1`. All eight files ran.

No targeted correction was warranted and the affected tests remain red. The requested condition for rerunning the full frontend suite after passing targeted fixes is not met, so no fresh full-suite result is claimed. The prior 347-pass/1-fail full-suite result remains historical evidence in the UI verification report.

## Remaining standing gates and scope

All seven standing gates remain open, with their historical measurements unchanged:

1. Same-source split at 0.75: 42.117 ms residual > 40 ms.
2. Repeated split at 0.5: unexpected pause.
3. Video 2 decoder handoff: base URL sampled where replacement expected; cause unresolved.
4. Genuine buffering resume: Preparing Preview persists after release; 15 s assertion timeout.
5. Native audio alignment at 1: 58.168 ms > 50 ms.
6. Native audio alignment at 0.75: 191.281 ms > 50 ms.
7. Native audio alignment at 0.5: 259.174 ms > 50 ms.

The ownership test and speed-1 continuity failure are additional unresolved findings. No standing gate is closed, relaxed, skipped, hidden or reclassified as passed. Existing manual audible/visual acceptance remains outstanding.

This investigation adds only this report and ignored local evidence/scripts/archive. Existing UI changes and documents are preserved. No application code, tests, backend, package or configuration files were changed; no branches, commits, pushes or deployment operations were performed.

Final Git whitespace check exits 0 (existing LF/CRLF notices only). HEAD remains `1c7777c829369840a6bd8bc8afd76a837d948584`. The only new non-ignored file from this investigation is this report; the 14 existing modified frontend files and prior untracked UI evidence/specification/plan/browser test remain in the working tree.
