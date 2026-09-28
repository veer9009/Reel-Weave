# ReelWeave Milestone 2: Timeline Sequential Render Design

## Intent

Make the current Video 1 timeline plan drive ReelWeave's existing FastAPI and FFmpeg merge pipeline. A user arranging 10–20 uploaded advertising clips can render one sequential MP4 whose clip order, inclusive source-frame trims, speed, project FPS, and audio settings match the visible plan.

Milestone 2 does not render sample storyboard cards, Video 2 overlays, or any other visual-only timeline control. It does not add MOV export, deployment, dependencies, persistence, authentication, or a second rendering workflow.

## Existing Behavior to Preserve

- Uploaded clips remain in React state and are submitted as multipart files to `POST /api/merge`.
- Inclusive source-frame trim ranges and speeds of `1`, `0.75`, and `0.5` are applied before concatenation.
- Original-audio volume/mute and optional background-audio volume/mute settings continue through the existing audio mix.
- The current queued job, status polling, MP4 preview, download, cleanup, and failure behavior remain the sole result flow.
- The Timeline Demo notice continues to state that multi-track processing is in development.

## Manifest Contract

The existing merge manifest gains:

- `output_fps`: one of `24`, `25`, `30`, `50`, or `60`.
- `order`: an array containing each submitted clip's unique `client_id` exactly once, in Video 1 timeline order.

The existing `clips` array remains the clip-edit catalog. Each item retains `client_id`, inclusive `start_frame` and `end_frame`, `speed`, and `trim_saved`. Existing audio fields remain unchanged.

The frontend submits multipart video files in the same catalog order as `clips`. The backend maps stored uploads to their catalog `client_id`, validates `order` as a complete permutation, and then builds the job's input paths and edits in timeline order. This makes the requested order explicit and independently validated without adding an upload or merge endpoint.

Only real uploaded clips appear in `clips` and `order`. The twelve-card sample storyboard remains display-only and cannot enter the manifest.

## Frontend Data Flow

`App` continues to own uploaded clips, edits, audio settings, submission state, and job state. It additionally owns the selected project FPS so changing views does not discard the choice.

`TimelineDemo` receives the project FPS and its setter, the existing readiness/busy state, and the existing merge callback. Its Video 1 render plan consists only of uploaded clips. Sample cards can remain visible as prototype placeholders, but they are labeled and excluded from the render action and manifest.

A clear `Merge current timeline` action appears in the timeline delivery area. It is enabled only when the existing merge prerequisites are satisfied. Activating it calls the same merge function used by the merge workspace, switches back to the existing result/status UI, and creates no parallel job flow.

The format display remains MP4-only for the real action. The prototype notice and text explaining that overlays and multi-track controls are visual-only remain visible.

## Backend Validation and Job State

Manifest parsing rejects:

- missing or unsupported `output_fps`;
- absent, duplicate, blank, or otherwise invalid clip IDs;
- an `order` value that is not a list of strings;
- unknown, missing, or duplicate IDs in `order`;
- clip-count mismatches;
- non-integer, negative, reversed, or decoded-media-out-of-range frame ranges;
- speeds outside `1`, `0.75`, and `0.5`;
- invalid existing volume or mute fields.

The parsed FPS is stored on the existing `Job`. Upload paths and `ClipEdit` objects are reordered together only after the manifest order is validated. Probe-based validation continues to clamp only untouched browser-derived end frames as currently designed; explicitly saved ranges outside decoded media are rejected by the existing preflight rules.

## FFmpeg Rendering

The current `MediaPipeline.merge` remains the only renderer. For each ordered job clip it:

1. trims the inclusive source-frame selection;
2. resets timestamps and applies the selected speed to video and audio;
3. normalizes resolution, pixel format, sample rate, and channel layout using the selected project FPS;
4. concatenates normalized intermediates in timeline order;
5. applies the existing original/background-audio mix when background audio is present.

Both intermediate normalization and final concatenation use the job's selected FPS with constant-frame-rate output. Encoding remains H.264 (`libx264`, medium preset, CRF 23, `yuv420p`) and AAC (192 kbps, 48 kHz stereo) in an MP4 with fast-start metadata. This preserves the project's current quality profile while removing the hardcoded 30 FPS.

## Errors and Results

Invalid manifests return the existing structured 422 API errors before queueing. Invalid decoded frame ranges continue to return the existing `invalid_media` preflight response and clean partial job storage. Processing failures continue through normal failed-job status.

Successful renders use the existing job status, `/video` preview, and `/download` MP4 endpoints. No new result type or endpoint is introduced.

## Testing

Frontend focused tests cover:

- manifest `output_fps`, explicit order, inclusive trims, speeds, and audio fields;
- the timeline merge action using real uploaded clips only;
- sample cards never appearing in render data;
- project FPS persistence and MP4-only real rendering text.

Backend focused tests cover:

- accepted supported FPS and complete reordered clip permutation;
- rejected unsupported FPS, duplicate/unknown/missing order IDs, duplicate clip IDs, and invalid frame/speed values;
- job input paths and edits reordered together;
- selected FPS in normalization and concat FFmpeg arguments while preserving H.264/AAC settings.

Verification runs the complete backend suite, complete frontend unit suite, frontend lint, and frontend production build. The opt-in real FFmpeg integration test is run only when the environment has the required media tools; otherwise the report states that a real-video manual/integration verification remains required.

## Explicitly Deferred Milestone 3 Work

- Video 2 overlay rendering
- multi-track visual-control rendering
- MOV export
- deployment or infrastructure changes
- databases, authentication, or unrelated redesigns
