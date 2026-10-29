# AVStudio slow-speed preview follow-up — 2026-10-29

This follow-up preserves checkpoint `89ce9e9`, all earlier uncommitted audio/replay fixes, the manual-playback browser coverage, existing report edits and both untracked pnpm files. No package installation, persistent configuration change, commit, push or deployment was performed.

## Reproduction and cause

Used an existing portrait upload: `backend/var/reelweave/uploads/b01f7c1d-2d00-425e-973e-7f95d6c1f54d/000.mp4`. FFprobe reports H.264 video, 478×850, 169 video frames at approximately 29.816455 FPS and 5.668011 seconds; stereo AAC/container duration is 5.784063 seconds. The browser estimates video frame bounds from container duration and sampled FPS. In the failing session it imported 172 frames, including frames that do not exist in the video stream.

Before application changes, imported this clip into the actual editor, played normally, paused, selected 0.75× and pressed Play. Normal picture/sound advanced. The slow preview briefly showed Preparing, then `POST /api/preview-audio` returned **422** with **“Frozen audio source trim is unavailable.”** The browser sent the estimated inclusive trim `[0, 171]`; decoded video ends at frame 168. Transport intent became false, picture and sound remained paused, and the existing status displayed **“Sound preview preparation failed: Frozen audio source trim is unavailable.”** This was a confirmed application error, not a browser launch failure. The baseline stopped at 0.75×, so it did not independently reach the 0.5× branch before correction. Evidence: `var/avstudio-slow-preview-session/baseline/`, especially `session.json` and trace.

Ordinary render validation already clamps untouched video to decoded source frame bounds. Slow preview instead constructs a strict frozen audio recipe from browser metadata. This explains how rendered output can succeed while preview rejects the same imported clip. Earlier successful checks used short CFR fixtures with matched video/audio extents; they did not cover this source-metadata mismatch.

## Retained correction

- Added `POST /api/video-metadata`, using existing FFprobe/video validation helpers, existing upload limits, temporary job storage and bounded serial preparation. It returns actual video FPS, frame count, dimensions and video duration; temporary files are cleaned after success, failure or probe cancellation. It does not queue a render or encode video.
- Video 1 imports await that metadata before initializing the default clip range. UI markup/styles and controls are unchanged. Import now makes a temporary metadata upload to the configured backend; this is separate from starting a render job. A 404/unavailable backend retains the existing local browser fallback. A live probe timeout does **not** silently publish inaccurate frame bounds: it uses the existing metadata-error state. The new metadata request uses the existing 15-second media-reading bound.
- Pending metadata completes for sources retained by Undo after a visible occurrence is deleted. Component teardown cancels requests. Earlier audio-clock/replay fixes, saved edit/history operations, preview normalization, canonical export graphs and strict frame validation remain retained.

Focused regressions failed before correction: the component published 174 estimated frames instead of 169; the new endpoint initially returned 404; timeout handling returned a browser fallback; and an already-cancelled source still attempted a request. The new endpoint/component checks subsequently passed. Existing App/history checks also exposed an initial cancellation incompatibility after deletion; metadata now finishes for Undo-retained sources, and that existing regression passes.

## Browser and rendered-output evidence

| Check | Result |
| --- | --- |
| Original portrait clip, same session 1× → 0.75× → 0.5× → 1× | **PASS**, one test, exit 0, 46.0 seconds total. Both slow preview requests returned 200; all four phases reached playing intent with no pending readiness tokens and advancing picture/sound cursors. |
| Final original-clip check with explicit readiness and mixer energy assertions | **PASS**, one test, exit 0, 27.0 seconds total. All four phases had `status=playing`, intent true, pending null, sound status ready, advancing picture/audio and non-silent actual mixer output. Original-bus energy at final samples was approximately 0.00854 / 0.01337 / 0.00779 / 0.00651; no page errors. |
| Reproducible portrait fixture, 169 frames at 30 FPS, AAC/container longer than video | **PASS** for the same session speed changes. |
| That fixture rendered at 0.75× | **PASS**, real MP4, 225 frames at 30 FPS; decoded audio present and non-silent. |
| That fixture rendered at 0.5× | **PASS**, real MP4, 338 frames at 30 FPS; decoded audio present and non-silent. |

The fixture three-case command finished **3 passed**, exit 0, approximately 2.5 minutes. Individual test times were 34.4/48.6/54.5 seconds. Artifacts: `var/avstudio-slow-preview-session/audio-tail-final/`, including session snapshots, downloaded MP4 files and `render-result.json`. Original-clip artifacts: `var/avstudio-slow-preview-session/real-clip-allowed-origin/`.
Final strengthened original-clip artifacts: `var/avstudio-slow-preview-session/real-clip-final-ready-audible/`. A preceding strengthened-test attempt had a test-only variable-name error (`after` instead of `state`) and is excluded from application results; it was corrected and lint passed before the final run.

All browser/FFmpeg checks ran sequentially with one Playwright worker and zero retries. Existing 120-second test timeout, 15-second expectations, 40 ms positioning and 50 ms acoustic bounds were not raised. The new source-specific browser checks establish playback/cursor advancement and output frame counts/non-silent audio; they do not claim a new acoustic-offset measurement on the portrait clip.

## Other verification and limitations

- Focused backend metadata/preview endpoint checks: **5 passed**, exit 0.
- Focused component/frame-rate/preview-recipe checks: **23 passed**, exit 0.
- Seven identified App/history failures: **7 passed** after fixture/readiness updates and the Undo source-lifetime correction. The initial broader run was interrupted after exposing outdated asynchronous metadata fixtures; it is not a completed pass. A later two-file intermediate run had **64 passed / 7 failed**, before those seven corrections.
- Final full frontend suite: **550 passed / 60 files**, one worker, exit 0, 498.28 seconds.
- Final backend suite: **201 passed / 2 skipped**, exit 0, 5.45 seconds. The two skips are opt-in backend export tests; separate real slow MP4 outputs were checked above.
- Final lint: **PASS**, exit 0.
- Final production build: **PASS**, exit 0, TypeScript + Vite, 1,797 modules. CSS output hash/name is unchanged from the preceding build.
- Final whitespace check: **PASS**. Both pnpm file hashes retain their previously recorded values.

Resource preflight: CPU 90.4% busy, 93% physical RAM occupied with 0.49 GiB available, approximately 87.80 GiB disk free. Existing Vite (5173) and non-reloading Uvicorn (8000) were preserved. A temporary backend on 8001 isolated verification of the new endpoint and was stopped after the checks. After explicit user approval (Restart only backend), only the backend on 127.0.0.1:8000 was restarted on 2026-10-29. Fresh /api/health returned status ok, FFmpeg/FFprobe available and all four export capabilities true; /openapi.json confirmed the /api/video-metadata POST is active. The original frontend processes remain running. Restart logs: var/avstudio-slow-preview-session/backend-restart-20261029-223116.stdout.log and .stderr.log. Browser/export results above were obtained before activation against the isolated updated backend; no additional browser or FFmpeg job was started for this restart. Clips already imported using browser estimates retain those estimates until re-imported; saved-project/relink metadata migration was not implemented or verified.

Two intermediate verification harness failures are retained: a request-proxy route omitted multipart file bytes, causing an empty-file 422 before import; direct cross-origin requests from 127.0.0.1 were then blocked by the existing CORS policy. The working harness uses direct browser uploads from the already-allowed `http://localhost:5173` origin and overrides only test-served API module responses. No repository or persistent server configuration was changed. Neither setup failure was counted as a preview result.

The earlier independent-audio split preview power-ratio failure (0.363 < 0.7) remains open and was not rerun here. This follow-up does not establish full audio/edit/export parity or claim all formats were freshly checked; its new rendered-output checks cover slow-speed MP4 with decoded audio.

Application changes in this follow-up: `backend/app/main.py`, nonvisual metadata loading in `frontend/src/components/ClipList.tsx`, and `frontend/src/lib/videoMetadata.ts`. Added focused client/backend tests and `frontend/e2e/slow-preview-session.spec.ts`, plus the audio-tail fixture generator. Updated existing App test mocks/readiness waits for asynchronous metadata; the edit/history assertions and all timeouts remain intact. The prior audio/playback hook changes were preserved without further modification.
