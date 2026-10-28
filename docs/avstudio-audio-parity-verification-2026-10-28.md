# AVStudio audio/export parity — 2026-10-28

**Status: preview parity remains failing. No new production fix was retained in the latest resume.** The accepted UI and all existing work remain preserved. No timing or signal thresholds were relaxed.

## Workspace and scope

Resumed the dirty working tree on `backup/avstudio-oct16`, HEAD `59b5333`. Inspected this report, the October 21 audio execution ledger, approved audio design/plan, October 28 UI verification and existing source/test changes before attempting further fixes. No checkout, reset or cleanup of existing changes was performed.

The latest resume retained changes only to `frontend/e2e/audio-edit-parity.spec.ts` and this report, plus ignored diagnostic artifacts under `var/`. The source files remain dirty from earlier work; the latest output-gate experiment was removed with a targeted patch, preserving earlier changes. There are no new CSS, layout, backend, schema, editing, playback or render changes from this resume.

No packages were installed. No configuration, commit, push or deployment was made. The reserved preview-status space and accepted UI were not changed.

The pre-existing pnpm files were neither created nor edited in this audio pass. Earlier evidence places their creation in the installed pnpm workspace on October 22; the exact creating command is not established. Final SHA-256 hashes still match:

- `frontend/pnpm-lock.yaml`: `BB593D9B305D6B4C08B54F73053F391F03ABBE04CB0279A70ACBAC045A8AB03B`
- `frontend/pnpm-workspace.yaml`: `D6D0C24446D91EF762D37C6BA801BB516E65D7055AA9F8027FCD457409A97CE1`

## Results inspected before the latest experiment

The complete browser matrix finished **24 passed / 5 failed** (`var/avstudio-audio-complete.log`). Preview failures were:

- 60 FPS music split: coverage distance 0.942185 s, limit 0.05 s; exports were not reached.
- Independent split and music split: preview power ratio 0.530677, minimum 0.7.
- Detached split: coverage distance 0.397835 s, limit 0.05 s.
- Music end-trim: coverage distance 0.799936 s, limit 0.05 s.

All **84 MP4/MOV/WAV/MP3 exports from the 21 edit journeys** passed. These cover independent, detached and music lanes with split, move, start/end trim, ripple delete, lift delete and replacement. Another 12 exports passed for 24/30/50 FPS split cases. This was 96 checked exports; the failing 60 FPS preview did not establish an export failure.

The latest resume changed the FPS test so preview failures are retained while all four exports are still checked. It also saves native picture-clock history and `parity-results.json`. Assertions and thresholds are unchanged.

The focused **pre-experiment retained-code** rerun (`var/avstudio-audio-resume-splits.log`, artifacts `resume-splits/`) then recorded:

| Case | Preview | MP4 | MOV | WAV | MP3 |
| --- | --- | --- | --- | --- | --- |
| 60 FPS music split | PASS | PASS | PASS | PASS | PASS |
| Independent split | FAIL: power ratio 0.530677 < 0.7 | PASS | PASS | PASS | PASS |

The variability of the missing-start failure is not evidence of a stable fix. The retained production implementation is the same as in this rerun.

## Diagnosis and rejected experiment

Independent split PCM near project 1.9 s contains an early transition from 660 Hz to 990 Hz. Retimestamping the raw capture against saved picture-clock history did not remove it. One retained observation had picture at approximately 1.894 s, native audio at 2.011 s and device render-ahead near 32 ms. Device render-ahead alone does not explain the mismatch. Complete root cause and a safe correction remain open.

The missing-start evidence showed picture at 0.65–1.35 s while audio context/voice clocks had only just begun. Inspection found that wall-time extrapolation of a stale device-output timestamp can satisfy the readiness gate without confirmed device progress. A regression with a valid stale timestamp and advancing performance clock failed before an experimental correction (`avstudio-audio-stale-output-red.log`). Requiring confirmed output-context progress passed that regression and all 66 focused hook tests (`avstudio-audio-stale-output-green.log`).

**That experiment was not retained.** End-to-end verification (`avstudio-audio-resume-final-browser.log`, artifacts `resume-final/`) finished **4 passed / 4 failed**:

- All three running audio-split continuity cases and 60 FPS split preview passed; both split cases' eight exports passed.
- Independent split still failed, this time with incorrect tone energy (0.00122545 versus minimum 0.006).
- Native 1× / 0.75× / 0.5× sync failed at 114.843 / 213.564 / 192.501 ms against 50 ms.

The stricter gate lets native sound advance while picture is still starting; improving an isolated readiness assertion did not establish synchronized playback. Saved the experimental source/test copies under `var/avstudio-audio-parity-2026-10-28/stale-output-experiment-*`, then restored only those experimental lines. No fixed timing offset, delay or repeated continuous seeks were added.

The native 1× control also failed with the prior gate, so the experiment is not an isolated explanation for all failures. Existing independent native clocks, picture startup and readiness holds need further investigation together. Earlier isolated chirp controls showed that native slow-speed pitch-preserving sound can also differ from FFmpeg's normalized output; this is diagnostic evidence, not a tolerance waiver.

## Latest checks on the retained production code

| Check | Result | Evidence |
| --- | --- | --- |
| Native 0.75× audible sync | **PASS**, max 36.700 ms | `avstudio-audio-retained-slow.log`, `retained-slow/` |
| Native 0.5× audible sync | **FAIL**, max 145.829 ms > 50 ms | Same log/artifacts |
| Repeated native 1× audible sync | **FAIL twice**, max 104.056 / 146.448 ms | `avstudio-audio-retained-control.log`, `retained-control/` |
| Same-source picture split, 1× | **FAIL twice**: decoder identity changed; second attempt timed out waiting for additional presented frames | Same control log, lines 24–99 |
| Uninterrupted picture control, 1× | **1 pass / 1 fail**; failed status was `preparing` instead of `playing` | Same control log |
| Combined repeated control run | **1 passed / 5 failed** | Same control log |
| Focused audio/picture/transport hooks | **66 passed**, exit 0 | `avstudio-audio-retained-hooks.log` |
| Production build | **PASS**, exit 0, TypeScript + Vite, 1,795 modules | `avstudio-audio-retained-build.log` |
| Lint | **PASS**, exit 0 | `avstudio-audio-retained-lint.log` |
| Formatting of restored hooks and changed FPS test | **PASS** | `avstudio-audio-retained-format.log` |
| Whitespace check | **PASS**, exit 0 | `avstudio-audio-resume-diff-check.log` |

The broad frontend run during the rejected experiment finished **534 passed / 2 failed (15-second timeouts)**, 536 tests in 58 files (`avstudio-audio-resume-frontend.log`). Both timed-out App tests passed in isolation with their original timeout (`avstudio-audio-resume-app-retest.log`). This is not a single clean full-suite pass. No complete frontend-suite rerun was performed after removing the experiment; the focused hook suite was rerun.

Earlier retained-code running audio-split verification passed all three lanes twice (**6/6**, `avstudio-audio-continuity-browser.log`). The complete 29-test browser matrix was not repeated after the experiment was removed. Detached/music split and music end-trim failures from that matrix remain open, not implicitly resolved.

## Real MP4, MOV, WAV and MP3 output

The focused FFmpeg run reported **56 passed / 54 deselected**, covering **224 output checks**: split, move, start/end trim, delete and replacement on independent/detached/music lanes at 25/50/60 FPS, plus frozen detached split recipes at 0.75× and 0.5×. WAV is checked against exact independent stereo PCM (within one sample value); lossy outputs retain the existing power/correlation requirements. MP4/MOV also check picture/frame counts. No export assertion failed in the completed summary.

**The verification process nevertheless exited abnormally with Windows status `0xC0000005` after its passing summary.** This is not a clean command pass; its cause remains unverified. Log: `var/avstudio-audio-render-focused.log`. The larger 110-test run was interrupted to focus verification and is not a completed result.

An isolated slow-export recheck used Python fault diagnostics and recorded the child-process status directly:

Process status: `0x0` (return code `0`). See `var/avstudio-audio-slow-export-recheck.log` and `var/avstudio-audio-slow-export-process.json`. **2 passed / 108 deselected**, all eight slow-speed MP4/MOV/WAV/MP3 outputs checked with a clean exit.

Both preview sync and rendered output have been checked separately. Passing output checks do not turn a preview failure into a pass. No MP4/MOV/WAV/MP3 format was unavailable in the focused runs.

## Preserved earlier audio work

Existing changes retained from before the latest experiment include final readiness-token release ordering, bounded spare-voice preloading at exact boundaries, native picture clock binding, freezing holds at mounted picture position, output readiness staging, and inspector-disclosure test setup corrections. Continuous native seeks were previously rejected because they caused decoder thrashing. No such correction was reintroduced.

Those earlier dirty audio-related files remain in the working tree:

- `frontend/src/hooks/useProjectAudio.ts` and `.test.tsx`
- `frontend/src/hooks/useProjectPlayback.ts` and `.test.tsx`
- `frontend/src/hooks/usePreviewMedia.ts` and `.test.tsx`
- `frontend/src/components/ProgramMonitor.tsx` (nonvisual clock binding)
- `frontend/e2e/audioParityFixtures.ts`
- `frontend/e2e/playback-continuity.spec.ts`
- `frontend/src/App.test.tsx`

Other pre-existing UI/source/test/report changes and untracked files remain preserved. Latest-resume retained changed-file list: **`frontend/e2e/audio-edit-parity.spec.ts` and `docs/avstudio-audio-parity-verification-2026-10-28.md`**. Ignored diagnostic scripts, raw PCM, picture-clock history, traces, screenshots and output media remain under `var/avstudio-audio-parity-2026-10-28/`.

The full audio/export regression is **not passing**. The 40 ms positioning bound, 50 ms sync/coverage limit, 0.7–1.3 power ratio, channel/correlation checks and silence thresholds remain unchanged.
