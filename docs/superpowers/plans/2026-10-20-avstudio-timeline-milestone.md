# AVStudio browser gate and timeline editing Implementation Plan

> Native sequential execution using superpowers:executing-plans and test-driven-development. The user selected continuous execution in this workspace. No worktree or Git write steps.

**Goal:** Clear browser gate, then implement Video 1 ripple movement and chosen-playhead audio splitting.
**Architecture:** Extend existing occurrence/audio edit, history and source ownership paths; preserve manifest/project compatibility.
**Tech Stack:** React/TypeScript, Vitest, Playwright Edge, existing Python/FFmpeg.
**Spec:** docs/superpowers/specs/2026-10-20-avstudio-timeline-milestone-design.md

## Global constraints
No weakened assertions, increased thresholds/deadlines, skips, packages/config/system changes, unrelated deletion, commits/push/deploy. Preserve Save/Open, preview and audio ownership. Complete each phase gate before the next. Backend production edits require demonstrated final-output necessity.

## Review focus
Deferred play rejection across generations; callback-based FPS fallback; slow diagnostic collection exhausting short source windows; split-piece drag to occupied zero; audio boundary cuts, exact 48 kHz offsets and shared music source replacement. Tests below exercise these conditions.

### Task 1: browser gate
Files: frontend/src/hooks/useProjectAudio.test.tsx/useProjectAudio.ts; frontend/src/lib/clips.test.ts/clips.ts only after FPS reproduction; frontend/e2e/playback-continuity.spec.ts, advanced-timeline.spec.ts and mediaFixtures.ts only for proven collection/setup faults.
Interfaces: useProjectAudio({snapshot,sources,projection,transport}), existing generation/positionRevision/session/token ownership, detectFrameRate(video): Promise<number>.
- [ ] Read original exact errors/traces and working readiness examples.
- [ ] Add/run RED deferred-play tests: cancellation during preparation cannot fail/pause newer intent; stale generation/source/clear completions cannot affect successor; explicit pause wins; real NotAllowedError/decode failure remains visible.
- [ ] Fix only proven readiness/ownership cause, run focused hook/integration tests GREEN, then affected original browser tests with unchanged assertions/tolerances.
- [ ] Investigate FPS fallback, old residual collection, repeat eligibility and native analyser separately; prove any measurement/setup correction at its collection boundary with literal sample tests. No retry/deadline workaround or assertion removal.
- [ ] Run npm.cmd run test:e2e -- --output=../var/avstudio-timeline-milestone/browser-phase1 from frontend. Expected zero failures/skips before Task 2. Record exact errors and stop on a real preservation conflict.
- [ ] git status --short checkpoint and evidence ledger.

### Task 2: Video 1 ripple insertion
Files: frontend/src/components/ProjectTimeline.tsx/ProjectTimeline.test.tsx; frontend/src/App.tsx/App.advanced.test.tsx; frontend/src/lib/clips.ts/clips.test.ts or new video1Move.ts/video1Move.test.ts for frame-to-boundary mapping; frontend/src/hooks/useEditHistory.test.tsx; frontend/e2e/timeline-editing-milestone.spec.ts (new).
Interfaces: retain onMove(from:number,to:number):void and reorder action; boundary helper consumes original TimelineProjection and dragged ID and yields final list index or typed invalid result. Never call overwriteVideo1 for an occurrence move.
- [ ] Write/run RED tests: first/middle/last and split-piece drag to zero, inter-clip boundaries, append, self no-op, stale/locked no-op; unequal durations, lane-background and occupied-card drops. Assert literal order, stable IDs/trims/speed/outputWindow/audio flags and unchanged total frames.
- [ ] Implement boundary routing through existing reorder/history. Test selected ID, playhead source anchor, linked audio follows picture, independent lanes fixed, one Undo/Redo action.
- [ ] Add projectFileCompatibility.test.ts/App.projectFiles.test.tsx round-trip and post-relink manifest order tests. Browser actual drag-to-zero/between, split-piece move, undo/redo, export readiness.
- [ ] Focused tests GREEN; git status --short.

### Task 3: chosen-playhead audio split
Files: frontend/src/lib/audioTimeline.ts/audioTimeline.test.ts, positionedEdits.ts/positionedEdits.test.ts; components/EditingWorkspace.tsx/EditingWorkspace.test.tsx, IndependentAudioTrack.tsx/IndependentAudioTrack.test.tsx; hooks/useEditHistory.test.tsx; App.advanced.test.tsx/App.projectFiles.test.tsx; e2e/timeline-editing-milestone.spec.ts; tests/integration/test_v3_audio_invariants.py/test_timeline_audio_exports.py where relevant.
Interfaces: retain AudioSegmentEdit and AudioRecipe, IndependentAudioActions.onEdit, splitPositioned. Right offset uses normalized 48 kHz samples. Inspect musicSourceId/project and backend manifest source rules before per-piece music replacement; document compatible extension and render necessity before backend changes.
- [ ] Write/run RED tests for Ctrl+L detached, independent file and music splits: start 10,duration 30,cut 22 -> [10,22),[22,40), right offset +12*48000/fps. Cover supported FPS/frozen speeds, boundaries/outside/fractional rejection, unchanged picture/history/owners on rejection.
- [ ] UI/history/browser tests for right selection and unchanged cut playhead; move/trim/replace either half; own-lane ripple Delete/Backspace and explicit Lift; Undo/Redo, source bounds/counts and no cut to Video 1.
- [ ] Implement missing behavior only; retain existing correct split functions. A passing characterization is evidence, not a rewrite instruction.
- [ ] Save/relink both halves and verify exact source identity/sample offsets in manifests. Existing FFmpeg integration exports verify actual tones/picture and MP4/MOV/WAV/MP3. Stop only if a demonstrated constraint conflict blocks a correct compatible implementation.
- [ ] Focused tests GREEN; git status --short.

### Task 4: final verification/review
- [ ] frontend: npm.cmd test -- --pool=threads --maxWorkers=1. Expected all tests pass, zero skips.
- [ ] root: .venv/Scripts/python.exe -m pytest tests/backend tests/integration. Record exact counts and FFmpeg requirements.
- [ ] frontend: npm.cmd run test:e2e -- --output=../var/avstudio-timeline-milestone/browser-final. Expected all pass, zero skips.
- [ ] frontend: npm.cmd run lint; npm.cmd run format:check; npm.cmd run build. Format only touched files using installed Prettier; report unrelated baseline failures honestly.
- [ ] root: git diff --check; git status --short. Review full diff against spec, list files changed, exact counts, manual visual/listening gaps and any blockers. No commit/push/deploy.
