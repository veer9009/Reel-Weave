# Ordinary playback regression recovery

Scope: restore ordinary Play before any further split work. No Split journey runs as part of recovery. No backend, layout/style, package, configuration, system-setting, commit, push, or deployment changes.

## Exact cause

The latest uncommitted resume preparation API created a readiness gate synchronously against the live generation before the asynchronous audio resume path had adopted that generation in its React options. The existing audio sync treated the stale options as another generation change and cleared its gate reference. The transport retained that token in its readiness set.

The new Play-only browser regression failed on the pre-recovery tree. All collected progression samples were `{time: 0, frame: 0, paused: true, preparing: true}`. Its transition trace proves the following sequence:

1. `prepareAudio` sees audio generation 4 and live transport generation 5; it adopts 5 and suspends token -1.
2. An asynchronous sync still receives transport generation 4, records the transition 5 to 4, and clears gate -1 locally.
3. React's current sync receives generation 5 and creates gate -2. Transport readiness now contains both -1 and -2.
4. Once the audio graph is ready, audio releases only -2. Token -1 remains pending with no owner that can release it. Intent stays true; status stays preparing; video and frame stay at zero.

The presentation origin stayed 0 and presentation revision stayed 2 throughout this failure. No repeated picture-mapping change was needed to reproduce the deadlock. Therefore the proven recovery target is the newly added preparation gate, not a guessed presentation-origin correction.

Before evidence: `var/normal-playback-before-recovery-2026-10-19/normal-playback-recovery-r-8f5aa-ays-continuously-at-speed-1/normal-playback.json` and its retained Playwright trace.

## One correction

Manually removed only the new preparation API and its Play-handler invocation:

- `frontend/src/components/EditingWorkspace.tsx:617`: restore the original resumeAudio-before-toggle handler; remove explicit prepareAudio call.
- `frontend/src/hooks/useProjectAudio.ts:441` and `:540`: remove prepareAudio implementation/export; preserve the committed audio lifecycle, ownership, gains, and thresholds.

`git diff --exit-code 4d2c849 -- frontend/src/components/EditingWorkspace.tsx frontend/src/hooks/useProjectAudio.ts` exits 0: both files now exactly match the committed baseline. No Git reset/checkout, unrelated restoration, or file deletion was used.

The three earlier split-clock production diffs in useProjectPlayback, usePreviewMedia, and ProgramMonitor were inspected and remain unchanged by this correction. In particular, no new fix was layered onto their presentation origin/revision or seek behavior. The original split defect remains unresolved and deferred.

## Focused verification

New independent test-only regression: `frontend/e2e/normal-playback-recovery.spec.ts` at 1x, 0.75x, and 0.5x. It uses one ready Video 1 source, clicks Play, waits for playing/native time/rendered frame advancement, then checks five further joint progression checkpoints and rejects re-entry into Preparing during the steady observation period. It never splits or pauses playback. It does not infer displayed-frame freezes from a wall-clock/native-time residual.

Test-only served-response instrumentation records readiness tokens, generations, intent, origin/revision and UI readiness transitions without editing production files. The same regression is used before/after; no acceptance assertion or threshold was weakened.

After evidence: `var/normal-playback-after-recovery-2026-10-19/`, with separate retained JSON for each speed. Final results are recorded below.

Manual acceptance remains separate: reload http://127.0.0.1:5173, import one clip, click Play and let it run at 1x, 0.75x, and 0.5x without splitting. Initial preparation may complete once; picture and playhead must then continue together without repeated Preparing. Report each speed before resuming split work.

Local command from frontend:

```powershell
npm.cmd run test:e2e -- normal-playback-recovery.spec.ts --output=../var/normal-playback-local
```

All pre-existing diagnostic/test files and earlier artifacts remain intact. Earlier split/readiness candidate tests are preserved as investigation artifacts; they are not run or rewritten to imply the split defect is solved.


Final recovery results: initial ordinary-Play browser run passed 3/3 with exit 0. The stronger all-samples browser run reported 3/3 passed at 1x, 0.75x, and 0.5x, then returned -1073741819 after its summary. Its six/eight/seven steady samples respectively showed forward native/DOM progress with no observed pause, Preparing transition, or rollback. Five focused readiness unit tests passed (27 skipped), exit 0. Lint, recovery-spec formatting, and diff checks passed. Direct TypeScript and direct Vite builds exited 0; npm build printed success but returned -1073741819 afterward. Experimental split/start-gate tests were preserved and not run as recovery acceptance; a full suite is not claimed green. Manual ordinary playback confirmation is pending. Both local services returned HTTP 200. The two corrected production files still match 4d2c849 exactly.
