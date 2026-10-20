# AVStudio continuation checkpoint — 2026-10-18

Implementation is blocked at Issue 1 reproduction. No application, test, package, configuration, branding, or existing documentation changes were made. No elevated permission was requested and no permission workaround was attempted. This report is the only tracked-file addition. No release readiness is claimed.

## Preserved baseline and inspection

Branch: `backup/avstudio-oct16`. HEAD: `85f8025` (`WIP: AVStudio professional workspace UI`). Initial `git status --porcelain=v1` was empty. Previous commits include `1c7777c` (playback/audio regression work) and `1e689c6` (timeline/audio/export development).

Inspected existing verification and failure-investigation reports, the professional-workspace design and implementation plan, playback-continuity E2E and media fixtures, preview/audio hooks, workspace component, frontend ownership resolver, backend render-plan resolver, and frontend/backend/real-media ownership coverage. Retained historical logs and traces were read without modification.

The existing continuity fixture is `generateContinuityVideo`: six seconds, 360 frames at 60 FPS, 320×180 testsrc2, H.264/AAC, 48 kHz tone or chirp. Split tests exercise project FPS 25 and speeds 1, 0.75, and 0.5. Existing instrumentation records media play/pause/currentTime writes and stacks; split coverage also observes source mutations, presented frames, native media state, and timeline position. No thresholds or instrumentation were changed.

## Issue 1: reproduction blocked, no speculative fix

Fresh command, from `frontend`:

```text
npm.cmd run test:e2e -- playback-continuity.spec.ts --grep "same-source split preserves decoder and presented frames at speed 1$" --output=../var/continuation-continuity
```

Exit 1 before browser reproduction: Vite/esbuild reported `Cannot read directory "../../../..": Access is denied.` and could not resolve `frontend/vite.config.ts`. No fresh boundary timing or uninterrupted-versus-split comparison was obtained. No runtime correction is justified by this attempt. Permission was not escalated; the command was not retried through an alternate loader/server/configuration.

Historical evidence remains historical: `var/verification-investigation/split-summary.json` records native time 0.711615→1.369408 s over wall time 7915.8→8633.6 ms, a 60.007 ms residual against the unchanged 40 ms gate, with the same node and no new seek/source/event in that window. Another retained trace shows picture/audio pause followed by seek before the pre-split sample. The prior report records a seek from approximately 0.66 to 1.064967 s through preview sync/position. These observations do not establish a single root cause of all visible jumps.

Historical logs show gate/token, prepared-resume positioning, and mapping corrections, with some focused tests passing afterward while browser gates remained open. They do not establish three failed fixes to one confirmed boundary root cause; no precise attempt count is inferred. No additional fix attempt was made.

The investigation still needs synchronized internal readiness-gate, live-clock, picture mapping, audio mapping, source-switch, and browser play-rejection evidence around uninterrupted/split/replacement playback. Whether the current shared readiness/clock architecture needs changing remains unresolved; this checkpoint does not prescribe an architectural rewrite.

## Issues 2 and 3

Neither implementation was started because the requested sequence requires diagnosing and verifying Issue 1 first.

The prior investigation establishes a narrower audio defect: `useProjectAudio.currentTargets` selects ownership using rendered `transport.frame` but computes offsets using live `captureAnchor().projectSeconds`. At rendered frame 24/live time 1.01 s at 25 FPS, it can select an expired interval and release valid adjacent audio. The existing failing regression is retained. This does not prove unwanted simultaneous original-audio mixing or explain every playback failure.

Frontend and backend ownership resolvers already select the visible picture owner, with independent-audio precedence and a separate music bus. Existing tests cover exposed replacement ranges, detached silence, independent masking, gains, and PIP sound exclusion. Passing existing real-media tests below is not new proof of the exact requested replacement-range MP4/MOV behavior. No new regression or targeted fix was claimed.

The current approved UI documents describe presentation-preservation constraints and existing Inspector/Delivery ownership fallbacks. The new Cinematic Console request remains unimplemented; the previous UI commit is preserved.

## Fresh checks

Commands use existing installed tools only. Frontend commands run from `frontend`; Python commands run from the repository root.

| Command | Result |
| --- | --- |
| `npm.cmd test -- --maxWorkers=1` | Exit 1 at startup, before tests: same esbuild ancestor-directory access denial as E2E. |
| Focused continuity E2E command above | Exit 1 at dev-server startup; no test assertion ran. |
| `npm.cmd run lint` | Exit 0. |
| `npm.cmd run format:check` | Exit 1: existing formatting failures in `e2e/playback-continuity.spec.ts`, `src/hooks/usePreviewMedia.test.tsx`, `src/hooks/usePreviewMedia.ts`, `src/hooks/useProjectAudio.test.tsx`. |
| `npm.cmd run build` | Exit 0: TypeScript and Vite, 1783 modules. This succeeded despite the separate test/dev-server startup failures; no configuration was changed. |
| `.venv/Scripts/python.exe -m pytest tests/backend -q` | Exit 1: 177 passed, 2 opt-in skips, 1 failed. `test_merge_accepts_one_clip` did not observe completion within its existing two-second limit. |
| `.venv/Scripts/python.exe -m pytest tests/backend/test_api.py::test_merge_accepts_one_clip -q` | Exit 0: 1 passed. Does not replace the failed full-suite result or establish its cause. |
| `.venv/Scripts/python.exe -m pytest tests/integration/test_v3_audio_invariants.py -q`, process-local `RUN_FFMPEG_TESTS=1` | Exit 0: 12 passed, 75.07 seconds. Prior environment value restored in `finally`. |
| `.venv/Scripts/python.exe -m ruff check backend tests` | Exit 0. |
| `.venv/Scripts/python.exe -m ruff format --check backend tests` | Exit 0: 39 files already formatted. |
| `git diff --check` | Exit 0 before report creation; rerun after creation. |

The Python checks emitted existing Starlette/httpx and AnyIO deprecation warnings. Nothing was installed or updated.

The complete real-FFmpeg integration suite and full browser suite were not run: this checkpoint stops implementation at the failed reproduction prerequisite, after the unaffected checks above. No passing full frontend/browser, full real-media, continuity, or A/V-alignment result is claimed. No manual visual/audible acceptance was performed.

## Final state

Files changed: this new report only. Existing work remains intact. Final status should contain only `?? docs/avstudio-continuation-2026-10-18.md`; HEAD and branch are unchanged. Playback continuity, exact replacement-audio acceptance, and the requested UI redesign remain outstanding.
