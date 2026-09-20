# ReelWeave approved design

Approved in conversation on 2026-09-18. Updated on 2026-09-19 for the approved
version-1 trim-editor scope. Build the application layer locally; do not commit,
push, install global packages, change system settings, or deploy.

## Scope

ReelWeave remains a local-only MVP for combining short video clips into one MP4.
Version 1 adds frame-accurate clip trimming, per-clip speed, and one background
audio track. It does not add login, database persistence, saved projects,
transitions, cloud services, payments, or AI features.

React, TypeScript, and Vite provide one responsive editor screen. FastAPI exposes
health, merge creation, job status, video, download, and deletion endpoints. An
in-memory registry and bounded queue run one FFmpeg job at a time. Job states are
queued, processing, completed, and failed. Restart loses job status.

## Existing merge behavior to preserve

Files remain local in the browser until Merge is pressed. Accept video clips in
MP4, MOV, WebM, and MKV. Require 2-10 clips and default to 200 MiB per clip.
Show names, sizes, source duration when available, ordering controls, and removal
controls. Provide drag/drop upload and accessible movement buttons. Show honest
upload and job states, friendly errors, an HTML5 preview, download, delete, and
new-merge actions.

Normalize output to 1280x720, 30 fps, square pixels, H.264/yuv420p, and AAC
stereo 48 kHz. Preserve aspect ratio with black padding and supply silence for
missing original audio. Concatenate processed clips in submitted order. Reject
unreadable clips and clips with no video stream.

## Trim editor

Every clip in the clip list has a visible Trim button. Opening Trim shows a modal
or focused editor panel with:

- the selected clip preview;
- a thumbnail timeline;
- draggable trim start and trim end handles;
- a draggable or scrub-able playhead;
- Previous Frame and Next Frame controls;
- exact timestamp and frame number for playhead, trim start, and trim end;
- Save and Cancel controls.

Frame numbers are zero-based source-frame indices for the decoded video stream.
The trim range is inclusive: `start_frame` and `end_frame` are both included in
the final video. The editor must validate `0 <= start_frame <= end_frame <
total_frames` and require at least one selected frame.

Previous Frame and Next Frame move exactly one frame within the clip bounds. The
playhead timestamp is derived from the frame index and the detected source frame
rate. The UI rounds display timestamps to a stable human-readable format while
preserving exact frame indices in state and in the API manifest.

The thumbnail timeline may use browser-generated frames. If thumbnail generation
fails for a clip, trimming still works with a clear fallback timeline and frame
controls. Metadata loading failure for one clip must not break the rest of the
selection flow, but that clip cannot be merged until required trim metadata is
known or the backend can derive it successfully.

Only selected frames are included in the merged output.

## Per-clip speed

Each clip has a Speed selector with exactly these choices:

- `1` - 1x Normal;
- `0.75` - 0.75x Slow;
- `0.5` - 0.5x Slow motion.

Processing order is trim first, then speed. Preview duration and summary duration
reflect the selected trim range after speed is applied. For example, 90 selected
frames at 30 fps are 3 seconds before speed; at 0.5x they preview and render as 6
seconds.

Audio from the original clip is trimmed to the same selected range, then slowed
to match the selected speed. Missing original audio remains valid and is replaced
with silence for the processed clip.

## Background audio track

The editor adds a visible Background audio timeline track below the video track.
The track supports uploading one MP3, WAV, AAC, or M4A file for the entire final
video. The uploaded music appears from `00:00` with its duration and a
waveform-style placeholder. A real waveform is optional for version 1; the
placeholder must still communicate track length and placement.

The original video audio remains enabled by default. Background music is mixed
over the full final video. Controls:

- original-audio volume defaults to `100%`;
- music volume defaults to `30%`;
- mute option for original audio;
- mute option for music audio.

If background music is longer than the final video, trim it at the final-video
end. If it is shorter, loop it until the final-video end. If no background audio
is uploaded, the merge behaves like the existing video-only workflow with original
clip audio preserved.

## Frontend state and data model

Each selected clip keeps browser-local state:

- `id: string`;
- `file: File`;
- `url: string`;
- source metadata: duration seconds, frame rate, total frames, width, height, and
  whether metadata came from browser probing or backend validation;
- `trim: { startFrame: number; endFrame: number }`;
- `speed: 1 | 0.75 | 0.5`.

The editor computes derived values:

- selected frame count: `endFrame - startFrame + 1`;
- selected source duration: `selectedFrameCount / sourceFps`;
- output clip duration: `selectedSourceDuration / speed`;
- final video duration: sum of output clip durations.

Background audio state:

- optional `file: File`;
- optional `url: string`;
- duration seconds when known;
- `musicVolume: number` from `0` to `1`, default `0.3`;
- `musicMuted: boolean`, default `false`;
- `originalVolume: number` from `0` to `1`, default `1`;
- `originalMuted: boolean`, default `false`.

The Merge button is disabled when there are fewer than two valid clips, any clip
has invalid trim metadata, a file violates limits, tools are unavailable, upload
or processing is active, or the job has completed.

## API design

`GET /api/health` continues returning `status`, tool availability, and limits.
Add audio limits:

```json
{
  "limits": {
    "max_file_size_mb": 200,
    "max_clips": 10,
    "max_audio_file_size_mb": 100
  }
}
```

`POST /api/merge` remains multipart but now accepts:

- repeated `files` video parts in display order;
- optional `background_audio` file part;
- required `manifest` JSON string field.

The manifest shape:

```json
{
  "clips": [
    {
      "client_id": "local-clip-id",
      "start_frame": 0,
      "end_frame": 89,
      "speed": 1,
      "trim_saved": false
    }
  ],
  "audio": {
    "original_volume": 1,
    "original_muted": false,
    "music_volume": 0.3,
    "music_muted": false
  }
}
```

The `clips` array length must exactly match the number of video files. Clip
manifest order is the same as multipart `files` order. `client_id` is for client
correlation only; the backend never uses it as a path or command argument.

Existing job response shape is preserved:

```json
{
  "job_id": "UUID",
  "status": "queued|processing|completed|failed",
  "error": null
}
```

Structured API errors remain:

```json
{
  "error": {
    "code": "invalid_trim_range",
    "message": "Each clip needs at least one selected frame."
  }
}
```

## Secure backend validation

The backend validates both upload files and manifest before queueing a job.

Video validation:

- accepted extensions are `.mp4`, `.mov`, `.webm`, and `.mkv`;
- file count remains 2-10;
- per-video size remains 200 MiB by default;
- each file must be non-empty, readable by FFprobe, and contain a video stream;
- FFprobe determines source frame rate and frame count when possible;
- if exact frame count is unavailable, derive a conservative count from duration
  and frame rate;
- the decoded FFprobe frame count is authoritative when browser duration-based
  metadata differs for mobile or variable-frame-rate media.

Trim validation:

- `start_frame` and `end_frame` must be integers;
- `start_frame >= 0`;
- `end_frame >= start_frame`;
- selected frames must be at least one;
- `trim_saved` must be a boolean; it is `false` for the browser-generated
  full-clip default and `true` after the user saves a trim;
- an unsaved trim is normalized to frames `0..source_total_frames - 1`;
- a saved or stale `end_frame` beyond the decoded count is clamped to
  `source_total_frames - 1`;
- a saved trim is rejected only if its `start_frame` is beyond the clamped final
  frame, leaving no selected decoded frames;
- malformed or missing trim metadata returns `422 invalid_manifest` or
  `422 invalid_trim_range`.

Speed validation:

- speed must be exactly `1`, `0.75`, or `0.5`;
- unknown values return `422 invalid_speed`.

Background audio validation:

- accepted extensions are `.mp3`, `.wav`, `.aac`, and `.m4a`;
- at most one `background_audio` file is accepted;
- the audio file must be non-empty, within `max_audio_file_size_mb`, readable by
  FFprobe, and contain an audio stream;
- music controls are accepted only when a background audio file exists, otherwise
  they are ignored except original-audio controls;
- volume values must be finite numbers from `0` to `1`;
- mute values must be booleans.

Storage and process safety:

- keep job source, audio, intermediate, and result files within the dedicated
  working root;
- configured upload and output roots must be descendants of that working root;
- generated paths and filenames are used for all uploaded files;
- user filenames, client IDs, and raw manifest text are never inserted into
  command arguments or logs;
- every subprocess uses an argument list, no shell, `-nostdin`, a timeout, and
  local protocol and format whitelists;
- structured logs and errors do not expose full local paths;
- cleanup runs periodically and on startup, removes terminal jobs after 60
  minutes by default, skips active jobs, and refuses symlink or path escapes.

## FFmpeg processing order

For each clip:

1. FFprobe source metadata and normalize the requested inclusive range against
   the decoded frame count.
2. Decode the source video and audio.
3. Select video frames with `trim=start_frame=N:end_frame=M+1`.
4. Reset video timestamps with `setpts=PTS-STARTPTS`.
5. Apply speed after trim with `setpts=(PTS-STARTPTS)/speed`.
6. Normalize video to 1280x720, 30 fps, yuv420p, square pixels, and black padding.
7. Trim original audio to the same source time range.
8. Reset audio timestamps.
9. Apply speed after trim using `atempo` for the allowed speed.
10. Resample to AAC stereo 48 kHz, or generate silence when missing.
11. Encode each processed clip as an intermediate MP4.

Then concatenate processed intermediate clips in submitted order and create one
final timeline.

If no background audio is uploaded, encode the final video with processed original
audio only. If background audio exists:

1. concatenate processed video clips with their processed original audio;
2. loop the background audio when shorter than the final timeline;
3. trim background audio when longer than the final timeline;
4. apply original and music volume or mute controls;
5. mix original and background audio with `amix`;
6. encode final MP4 with H.264 video and AAC stereo 48 kHz audio.

The final output duration must equal the processed video timeline duration. Music
must never extend the final MP4 beyond the merged video end.

## Edge cases

- One selected frame is valid and renders as one frame before speed expansion.
- Start frame greater than end frame is rejected.
- End frame equal to total frame count is rejected.
- Dragging handles across each other clamps or rejects without corrupting state.
- Frame-step buttons clamp at first and last selected source frame.
- A speed change after trimming preserves trim frame indices and recalculates
  output duration.
- Muting original audio keeps background music when provided.
- Muting music keeps original clip audio.
- Muting both tracks renders a valid silent AAC track.
- Removing background audio resets music duration and disables music-specific
  preview state without changing clip trims.
- Browser metadata disagreement with backend probing is resolved by backend
  validation; backend errors tell the user which clip failed by 1-based position.
- Active jobs cannot be deleted.
- Completed and failed jobs can be deleted and cleaned up.

## Tests, documentation, and verification

Use Pytest and Vitest for validation, state, failure cases, path safety,
subprocess behavior, and UI interactions. Add browser E2E coverage for trimming,
frame stepping, speed selection, background audio upload, volume/mute controls,
merge completion, playback, download, reset, and deletion.

Add real FFmpeg integration tests when FFmpeg is available:

- trim selected frames only;
- preserve submitted clip order;
- apply 0.75x and 0.5x speed after trimming;
- preserve or synthesize original audio;
- mix background music at the requested volume;
- loop short music and trim long music at final-video duration;
- reject invalid manifests and unsupported background audio.

Update README with local run commands, API contract, trim and audio behavior,
limits, test commands, known limitations, and the existing DevOps roadmap notes.
Record verification commands and results in `docs/verification.md`.
