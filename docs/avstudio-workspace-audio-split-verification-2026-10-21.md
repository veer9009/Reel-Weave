# AVStudio workspace/audio-split execution ledger

Plan: `docs/superpowers/plans/2026-10-21-avstudio-workspace-audio-split.md`.
Spec: `docs/superpowers/specs/2026-10-21-avstudio-workspace-audio-split-design.md`.
User approved native sequential execution, test-first, preserving features/playback. No Git writes, deployment, installation or configuration changes.
Baseline HEAD: `fdefe56861813ecc027a6d99041a7b1d061d71fd`, branch `backup/avstudio-oct16`. Only the approved spec/plan were untracked initially.

## Execution decisions

- Ruling: Work in the current checkout, as the user explicitly requested this workspace/branch and native execution; no new worktree, packages or Git operations. Skill setup/install/commit suggestions yield to those instructions. Cost if wrong: changes share this checkout; diff/status and retained evidence track them.
- Ruling: Use this durable Markdown ledger and `var/avstudio-workspace-audio-split` evidence directly in PowerShell instead of shell bookkeeping helpers. Keep evidence because there will be no commits to recover it from. Cost if wrong: manual task tracking; each gate is recorded here.
- Ruling: V4 is the approved plan's selected export route, not a frontend audio compiler. Backend edits are limited to necessary per-source music contracts/rendering. Cost if wrong: small additional schema surface; legacy requests remain covered.
- Ruling: `replaceAudioPiece` returns the existing metadata probe's `SourceToken | null`, not a Promise. Completion stays event-driven through `sourceReady`/`sourceError`, with revision/target guards. Cost if wrong: callers observe completion through existing probes rather than await it. This preserves the decoder/metadata architecture.

## Pre-flight interfaces

| Producer → consumer | Contract checked |
| --- | --- |
| 1 → 5/7 | Typed audio split target/result; shared eligibility and commit revalidation. |
| 2 → 3/4 | V4 uses per-piece music source IDs; legacy V3 retains shared-source validation. |
| 3/4 → 10 | Same existing audio master for every export, original files rather than compiled browser WAV. |
| 4 → 5/6/8 | Each piece's source reference is authoritative and retained across history/Open. |
| 5/6 → 7/10 | Right-piece IDs, atomic history and V2 persistence retain exact offsets. |
| 7/8 → 9 | Stable media identities and protected timeline geometry. |
| all → 11 | Full suites plus independent preview/export and visual acceptance; no relaxed gates. |

## Task status

- Task 0: baseline backend 178 passed/2 existing FFmpeg opt-in skips; frontend 453 passed/3 failed (456 total), failures named in `baseline-frontend.log`; browser 45 passed/13 failed (58 total), names/traces retained under `baseline/` and `baseline-browser.log`. These failures predate the relevant product changes and are not waived. FFmpeg/FFprobe 8.1.2 available. Existing checkout uses `.git` for both git/common directories.
- Task 1: core planner RED (missing module), then GREEN: 53 tests in 3 files. Corrected an invalid 24 FPS replacement fixture (30-frame window valid at every FPS); production validation retained. Further frozen/repeated-cut edge coverage remains for final review.
- Task 2: parser RED: 2 failed/11 passed (V4 unsupported, duplicate contract rejection missing); GREEN: 48 passed across V4/V3 parser and V3 API. Added V4 multipart characterization for catalog binding/atomic cleanup; verification pending.
- Task 3: RED tests for missing V4 resolver/graph and real renderer's shared-source AttributeError. GREEN: 65 focused backend tests (including V4 multipart binding/cleanup), and 1 real FFmpeg stereo PCM test, maximum 1 sample-unit quantization difference against direct fixture windows. V4 reuses existing V3 picture/ownership resolution and modern job routing through inheritance; legacy contract stays strict. No playback hooks changed.
- Task 4: RED: 3 new tests failed on missing multi-source validation/V4 builder. GREEN: 46 tests across 8 manifest/API/source/placement/model files. Added App V4-first request selection; App-level end-to-end coverage follows persistence/UI tasks. Existing source/context collectors already enumerate every music piece; retained that behavior. No frontend-generated audio asset.
- Task 5: initial RED 6 missing-API cases; all 48 focused history assertions then passed, although a runner teardown returned native access-violation status. Additional earlier-first/latest-replacement race reproduced RED in both lanes; superseded candidates are now removed and both UI replacement flows use the guarded event-based API. Full recheck pending.
- Task 6: RED 3 missing-migration tests; V2 round-trip tests pass. V1 parsing remains strict, restoration migrates only validated V1, serialization emits V2. Live shared musicSourceId removed. Old future-version fixture updated from 2 to 99 because version 2 is now supported. Candidate probe check passed in isolation with its original timeout after a grouped timing failure.
- Task 7: dedicated UI RED 2 missing-control cases; GREEN 2 focused cases (audio-only routing, enabled state and visible reason). Explicit Split Video selectors retained in old picture tests; music tests now use Split Audio without removing their assertions.
- Task 8: both new native voice continuity checks pass; no playback hook implementation changes.
- Task 9: permanent feedback RED in component and real browser; component and desktop geometry checks passed. A 320px setup measurement raced initial health/fonts; unchanged one-pixel tolerance passes after waiting for those initial states. Reference density refined further; recheck/captures pending.
- Task 10: real different-file music replacement journey passed with captured preview sound, Undo/Redo, V2 Save/Open and MP4/MOV/WAV/MP3 downloads. Independent all-FPS/lane/edit PCM/delivery matrix and remaining browser journeys in progress.
- Task 11: first full frontend regression 503 passed/2 failed (505 total): one unchanged 5s shell test timeout, and one old single-music-source restriction assertion. The latter is replaced with positive per-piece source/placement/picture-preservation assertions required by the approved spec. Clean serial/full verification and final review remain pending.

## Additional execution rulings

- Ruling: use scoped native Python file writes when apply_patch rejects OneDrive cloud-file reparse attributes; inspect after errors because the patch helper can leave a partial first-file edit. No filesystem settings are changed. Cost if wrong: accidental duplicate text; compiler checks found and removed one duplicate import/prop block.
- Ruling: retain original test timeouts and serialize final broad suites after observed host contention/native runner teardown errors. Log assertion results separately from process exit status; no failure is labelled a pass solely from a green test summary. Cost if wrong: longer verification, not weaker coverage.
- Ruling: the approved per-piece music model supersedes the old placement test requiring Change Music for any different source. Keep explicit detach validation and assert both source IDs/positions plus unchanged picture and input snapshot. Cost if wrong: newly permitted music placements; covered by per-lane overlap/source validators and V4 export tests.

## Final verification in progress

- Top-bar single render-action regression: 1 passed, 45 filtered; exit 0, original 5s deadline retained.
- Real running split: independent, detached and music all passed; exit 0. Test-injected native audio spies reported zero seeks, loads or pauses while the playing snapshot split and advanced beyond the cut.
- Visible bus-wide volume/mute explanation: missing-text RED (3 cases), then GREEN 3/3; existing pointer/keyboard/cancel transaction assertions retained.
- Changed Python files: Ruff format and lint passed.
- Corrected independent frozen-recipe PCM oracle decodes the untouched source through its declared normalization recipe before applying authored event windows. The prior failing run used raw-container samples, not the recipe's sample domain; its log is retained as failed evidence. Exact one-unit PCM quantization bound remains unchanged. Chirps replace periodic pure-tone sources in the backend matrix to expose incorrect sample offsets.
- Ruling: the single existing export action lives in the application bar, retaining the same callback, lock, readiness and result flow; the delivery summary retains its description without a duplicate action. This matches the approved reference hierarchy. Cost if wrong: different action location; accessible name/one-action/header tests cover discoverability.
