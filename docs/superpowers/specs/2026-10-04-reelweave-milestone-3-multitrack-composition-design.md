# ReelWeave Milestone 3: Multi-Track Composition Design

## Intent and success criteria

Milestone 3 turns the existing four-track timeline into a focused, real ad-assembly workflow. Video 1 remains the ordered sequence of uploaded clips. Video 2 can contain at most one image/logo overlay and at most one video/PIP overlay, and both may be active at the same time. Audio 1 remains the original clip audio. Audio 2 remains the single background-music file with the existing volume and mute controls.

A successful implementation produces an MP4 whose Video 1 order, inclusive source-frame trims, speeds, project FPS, original audio, background music, and visible Video 2 overlays match the submitted project. It continues to use the existing FastAPI job, FFmpeg processing, status polling, preview, download, deletion, and retention-cleanup flow. This is a constrained assembly tool, not a general non-linear editor.

## Existing behavior that must remain intact

- `POST /api/merge` remains the only render submission endpoint and multipart upload remains the transport.
- Video 1 contains every primary clip exactly once in the explicit manifest order.
- Video 1 source trims remain inclusive: `start_frame` and `end_frame` both select source frames.
- Speeds remain limited to `1`, `0.75`, and `0.5` and are applied before clips are concatenated.
- Project FPS remains one of `24`, `25`, `30`, `50`, or `60`, including the current frontend Auto resolution to a supported value.
- The existing original-audio and background-music volume/mute semantics remain unchanged.
- Jobs still move through queued, processing, completed, or failed state and expose the existing MP4 preview and download URLs.
- Uploads and outputs continue to use generated server-side names, safe storage roots, size limits, restricted FFmpeg protocols/demuxers, timeouts, terminal-job deletion, and scheduled cleanup.
- Output stays H.264/AAC MP4. MOV export is not exposed anywhere in Milestone 3.

## Chosen architecture

Extend the current merge plan and job with two optional overlay descriptors and paths. The frontend owns the editable overlay state and sends the overlay files as named multipart parts beside the existing primary clips and optional background audio. The backend validates the manifest/file pairing, stores all inputs under the generated job directory, probes the media, and rejects invalid project-frame schedules before queueing.

The renderer remains a staged `MediaPipeline.merge` operation:

1. normalize each Video 1 clip and concatenate the primary sequence with Audio 1;
2. if Video 2 is populated, composite the video/PIP first and the image/logo second in one FFmpeg filter graph while copying Audio 1 unchanged;
3. if Audio 2 is populated, run the existing duration-bounded background-music mix while copying the already-composited video.

This approach is preferred over per-clip overlaying because overlay ranges use continuous project frames and may cross Video 1 edit boundaries. It is preferred over a single monolithic filter graph because it preserves the tested Video 1 normalization/concat and audio-mix boundaries and keeps failures diagnosable.

## Data and manifest contract

### Frontend model

`App` continues to own project state. It gains two nullable overlay values:

```ts
type OverlayPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'centre';

type OverlaySize = 'small' | 'medium' | 'large';

type OverlaySchedule = {
  startFrame: number;
  endFrame: number; // inclusive project frame
  position: OverlayPosition;
  size: OverlaySize;
};

type ImageOverlay = OverlaySchedule & {
  kind: 'image';
  file: File;
  url: string;
  metadataStatus: 'loading' | 'ready' | 'error';
};

type VideoOverlay = OverlaySchedule & {
  kind: 'video';
  file: File;
  url: string;
  metadataStatus: 'loading' | 'ready' | 'error';
  duration?: number;
};
```

The two object URLs follow the same ownership rules as primary clip and background-audio URLs: revoke on replacement, removal, reset, and component unmount. Overlay state survives switching between the merge and timeline views, but “Start a new merge” clears it with the rest of the project.

### Project frame count

Overlay schedules use the zero-based frame clock of the rendered project, not any source media frame clock. After backend probing and trim clamping, each Video 1 clip contributes:

```text
selected_source_frames = end_frame - start_frame + 1
clip_seconds = selected_source_frames / source_fps / speed
clip_project_frames = max(1, round_half_up(clip_seconds * output_fps))
total_project_frames = sum(clip_project_frames)
```

The frontend uses the same formula with its available clip metadata. `round_half_up(x)` means `floor(x + 0.5)` for these non-negative values; JavaScript and Python helpers must implement that rule explicitly rather than relying on language-specific tie behavior. A valid project has project frames `0` through `total_project_frames - 1`.

### JSON manifest

The existing manifest gains an optional `overlays` object. Omitting `overlays` is equivalent to both entries being `null`, preserving Milestone 2 clients and no-overlay renders.

```json
{
  "output_fps": 30,
  "order": ["clip-b", "clip-a"],
  "clips": [
    {
      "client_id": "clip-a",
      "start_frame": 0,
      "end_frame": 89,
      "speed": 1,
      "trim_saved": true
    },
    {
      "client_id": "clip-b",
      "start_frame": 15,
      "end_frame": 74,
      "speed": 0.75,
      "trim_saved": true
    }
  ],
  "overlays": {
    "image": {
      "start_frame": 0,
      "end_frame": 149,
      "position": "top-right",
      "size": "small"
    },
    "video": {
      "start_frame": 45,
      "end_frame": 119,
      "position": "bottom-left",
      "size": "medium"
    }
  },
  "audio": {
    "original_volume": 1,
    "original_muted": false,
    "music_volume": 0.3,
    "music_muted": false
  }
}
```

Each overlay descriptor is either `null`/absent or exactly one object with `start_frame`, `end_frame`, `position`, and `size`. Frames are inclusive. The image and video schedules are independent and may overlap. Array-based arbitrary layers are deliberately not introduced.

### Multipart parts and job model

The request keeps repeated `files` parts for Video 1, `manifest`, and optional `background_audio`. It adds:

- `overlay_image`: zero or one PNG, JPG, or JPEG file;
- `overlay_video`: zero or one MP4, MOV, WebM, or MKV file.

A file must be present if and only if its manifest descriptor is non-null. Duplicate parts, an orphan file, or a descriptor without its file are invalid. Primary `files` remain in manifest `clips` catalog order; neither overlay file enters `clips` or `order`.

The backend model gains immutable `OverlaySettings(start_frame, end_frame, position, size)` values in `MergePlan` and corresponding `image_overlay_path/settings` and `video_overlay_path/settings` fields on `Job`. Stored names are generated, such as `overlay-image.png` and `overlay-video.mp4`; user filenames never become paths or command fragments.

Configuration and the health response gain explicit overlay limits:

- image overlay: 20 MiB maximum;
- video overlay: the existing per-video limit, 200 MiB by default;
- image/video dimensions: at most 8192 pixels on either axis and at most 40 megapixels.

The total request-body calculation and multipart `max_files` account for all Video 1 clips plus background audio plus both overlays. These are limits within the existing settings pattern, not new dependencies.

## Frontend interaction model

### Professional workspace header

The normal page uses one compact workspace header containing only the ReelWeave product name, the neutral project label `Sequence 01`, the merge/timeline workspace navigation, and local/backend availability state. It contains no hero, slogan, campaign copy, or decorative marketing block.

The following strings and their containing marketing/tagline blocks are removed from every normal application view and are not replaced by paraphrased slogans:

- `Ad Assembly Timeline`
- `SMALL CLIPS. BIGGER STORIES.`
- `Bring your favorite moments together in one seamless video.`
- `Upload, arrange, and let your story unfold.`
- `Your clips. Your story.`

Operational labels such as “Video 1,” “Video 2,” “Program preview,” “Delivery settings,” and status/error guidance remain because they explain the workspace rather than market it.

### Video 1 and timeline clock

Video 1 continues to show only real uploaded clips when a real project exists, in their render order and at their calculated project-frame widths. Existing reorder, trim, speed, FPS, and clip-preview behavior stays available. Sample storyboard items never enter the manifest or a real render.

The visible project duration and playhead use `total_project_frames / output_fps`. All displayed ranges use zero-based inclusive project frame numbers. Changing clip order alone does not change total frames; changing a trim, speed, source metadata, or project FPS recalculates the total.

### Video 2 editor

Video 2 replaces its visual-only placeholder with two clearly labeled slots: “Image / logo” and “Video / PIP.” Each slot has a choose/replace control, filename and media-status display, remove control, inclusive start/end project-frame fields, position selector, and size selector.

- Image selection accepts `.png`, `.jpg`, and `.jpeg`.
- Video selection accepts `.mp4`, `.mov`, `.webm`, and `.mkv`.
- Position choices are top-left, top-right, bottom-left, bottom-right, and centre.
- Size choices are Small (20%), Medium (30%), and Large (40%). The percentage is the maximum width and maximum height relative to the 1280×720 output canvas; aspect ratio is preserved.
- A newly ready overlay defaults to frames `0` through `total_project_frames - 1`, position `top-right` for images or `bottom-right` for video, and `small` for images or `medium` for video.
- If no valid Video 1 duration exists, files may be selected but schedule controls and rendering stay disabled until a project frame range exists.
- Later Video 1 edits do not silently rewrite a user-edited overlay range. A now-out-of-range schedule is marked inline and blocks rendering until corrected or removed. Increasing the project duration likewise does not extend an existing overlay automatically.
- Replacing a file preserves that slot’s valid schedule, position, and size. Removing it clears both its file and descriptor.

Start/end number fields are the authoritative accessible controls. Timeline handles may mirror those values but are not required for correctness. Fake lock, visibility, mute, waveform, or trim controls must be removed or clearly disabled; the UI must not present non-functional controls as working editor features.

### Preview and submission

The program preview layers Video 2 over the current Video 1 clip at the playhead. It uses the same position and percentage bounding boxes as the renderer. The image appears only inside its inclusive range. The PIP is muted and its preview time is `(project_frame - start_frame) / output_fps`; after its source ends, its last decodable frame remains visible through `end_frame`. Preview differences caused by browser decoding, color handling, or frame-rate conversion are disclosed as approximate; FFmpeg output is authoritative.

The existing render action submits Video 1 files, manifest, optional Audio 2 file, and populated Video 2 file parts through the same `submitMerge` call and switches to the existing job/result UI. It is disabled when either selected overlay has unreadable metadata or an invalid schedule. A no-overlay submission behaves exactly like Milestone 2.

Audio 1 stays represented by the primary clips. Audio 2 stays represented by the existing background-audio control. Video-overlay audio is never previewed or rendered.

## Backend validation rules

Validation is split between manifest/file structure before queueing and authoritative media preflight after safe storage but before queue submission. Any failure removes the partial job directory and registry entry and closes every multipart upload through the existing cleanup path.

### Structural and pairing validation

- `overlays`, when present, must be an object containing no keys other than `image` and `video`.
- Each non-null descriptor must be an object containing only the four required fields.
- `start_frame` and `end_frame` must be JSON integers, not booleans; both must be non-negative and start must be less than or equal to end.
- `position` must be exactly `top-left`, `top-right`, `bottom-left`, `bottom-right`, or `centre`.
- `size` must be exactly `small`, `medium`, or `large`.
- At most one multipart part of each overlay type is accepted.
- Descriptor/file presence must match exactly for each type.
- Image extensions are limited to `.png`, `.jpg`, and `.jpeg`; video-overlay extensions use the existing `.mp4`, `.mov`, `.webm`, and `.mkv` list.
- Empty overlays are rejected. Each is streamed in bounded chunks and rejected immediately on exceeding its configured limit.
- Existing primary clip, order, FPS, trim, speed, and audio validation remains in force.

Manifest-shape/range errors use the existing structured 422 contract with specific codes such as `invalid_overlay`, `invalid_overlay_range`, and `invalid_overlay_count`. Unsupported extensions return 415. Size failures return 413. Storage failures remain sanitized 500 responses.

### Media preflight and project bounds

- FFprobe must identify exactly one usable still-image video stream for `overlay_image`; decoded codec must be PNG or JPEG-compatible. Animated images are not accepted.
- FFprobe must identify a usable video stream for `overlay_video`. Its audio stream, if any, is ignored.
- Width and height must be positive, no axis may exceed 8192, and decoded dimensions may not exceed 40 megapixels.
- The PIP must have a finite positive duration and at least one decodable video frame. Variable-frame-rate input is accepted and converted to the project FPS during composition.
- After primary clips are probed and current untouched-trim clamping is applied, the backend calculates `total_project_frames` with the shared formula. Every non-null overlay must satisfy `end_frame < total_project_frames`.
- Backend values are authoritative. A browser-valid project that disagrees with decoded metadata receives the existing preflight-style 422 response and is not queued.

FFprobe and FFmpeg keep `-nostdin`, argument-list execution, generated paths, process timeout, `file,pipe` protocol whitelist, and narrow demuxer whitelists. Still-image probing/composition adds only the required `image2`, `png_pipe`, and `jpeg_pipe` demuxers; overlays do not enable network protocols.

## Exact FFmpeg composition strategy

### 1. Build the frame-exact Video 1 base

Keep the existing source-frame `trim`, speed `setpts`/`atempo`, 1280×720 letterbox normalization, `yuv420p`, 48 kHz stereo normalization, and concat order. For each clip, use the shared calculation to determine `clip_project_frames`, run the project-FPS conversion, and bound the normalized intermediate to exactly that many video frames and `clip_project_frames / output_fps` seconds. Missing source audio still receives stereo silence. This makes the concatenated base exactly `total_project_frames` long on the project clock while retaining the existing one-frame rounding inherent in CFR conversion.

If neither overlays nor background audio exist, the concatenated H.264/AAC MP4 may continue to be the final result. Otherwise it is a generated intermediate. Encoding remains `libx264`, medium preset, CRF 23, `yuv420p`, constant project FPS, AAC 192 kbps, 48 kHz stereo, and `+faststart` on the final MP4.

### 2. Compose Video 2 in one filter graph

The composition command takes the Video 1 base as input 0, then the PIP input if present, then the image input if present. Static images are supplied as a project-FPS looped input. Input indices are built by code and never interpolated from user data.

For an overlay with inclusive frames `S..E`:

```text
D_frames = E - S + 1
D_seconds = D_frames / output_fps
```

The size enum maps to these 1280×720 bounding boxes:

| Size | Maximum box | Canvas percentage |
| --- | ---: | ---: |
| `small` | 256×144 | 20% |
| `medium` | 384×216 | 30% |
| `large` | 512×288 | 40% |

`scale=<box-width>:<box-height>:force_original_aspect_ratio=decrease:force_divisible_by=2` preserves aspect ratio and produces encoder-safe even dimensions. PNG processing retains alpha through the overlay filter; JPEG and video inputs are opaque. Inputs may be upscaled to the selected box, with the quality limitation documented below.

Positions use a fixed 24-pixel safe margin:

| Position | FFmpeg overlay coordinates |
| --- | --- |
| `top-left` | `24:24` |
| `top-right` | `W-w-24:24` |
| `bottom-left` | `24:H-h-24` |
| `bottom-right` | `W-w-24:H-h-24` |
| `centre` | `(W-w)/2:(H-h)/2` |

The PIP chain is conceptually:

```text
[pip:v]
fps=output_fps,
scale=<selected-box>:force_original_aspect_ratio=decrease:force_divisible_by=2,
tpad=stop_mode=clone:stop_duration=D_seconds,
trim=duration=D_seconds,
setpts=PTS-STARTPTS+S/(output_fps*TB)
[pip-ready]
```

The `tpad` followed by `trim` means a long PIP is cut at the scheduled duration and a short PIP holds its final decoded frame. It is not looped. Its audio is not mapped.

The still-image chain loops the single image at `output_fps`, scales it to its selected box, trims it to `D_seconds`, and offsets its PTS by `S / output_fps`. `format=rgba` is used before overlaying so PNG alpha survives.

Starting from `[0:v]setpts=PTS-STARTPTS[base]`, apply the video/PIP first and image/logo second. Each overlay filter uses the corresponding coordinates, `shortest=0`, no implicit repeat beyond the prepared input, and the frame guard `enable='between(n,S,E)'` (with commas escaped in the actual argument). Applying the image second makes a logo remain above PIP where their rectangles overlap. The final chain ends with `fps=output_fps,format=yuv420p,setsar=1` and is limited to `total_project_frames`.

Map `[composited]` as video and map `0:a:0` from the Video 1 base. Re-encode only video with the existing H.264 profile and copy the base AAC audio during this pass. Add `-t total_project_frames/output_fps`, `-r output_fps`, and `-fps_mode cfr`. If only one overlay type exists, omit the other input and chain without changing semantics.

### 3. Mix Audio 2 and finalize MP4

When background music exists, use the composited intermediate (or the no-overlay Video 1 intermediate) as input 0 and the looped background-audio file as input 1. Preserve the existing filter behavior:

```text
[0:a] volume=<effective-original-volume> [original]
[1:a] atrim=duration=<project-duration>, asetpts=PTS-STARTPTS,
      volume=<effective-music-volume> [music]
[original][music] amix=inputs=2:duration=first:
                  dropout_transition=0:normalize=0 [mixed]
```

Muted tracks use effective volume zero. Copy input 0 video without another video encode, encode mixed audio as AAC 192 kbps/48 kHz/stereo, bound output to the exact project duration, and write `merged.mp4` with `+faststart`. If no background music exists, the composition pass writes `merged.mp4` directly. This preserves the existing MP4 preview and download contract.

## Error handling, cleanup, and observability

- User-correctable manifest, pairing, and media-preflight failures are returned before queueing with the existing structured API error body.
- Runtime FFmpeg failures produce the existing safe failed-job message; raw paths, filenames, arguments, and stderr are not returned to clients.
- Server logs may record the failing processing stage (`normalize`, `concat`, `overlay`, or `audio_mix`) and sanitized failure category, but not user media contents.
- A failure or cancelled upload at any point deletes all primary, overlay, audio, intermediate, and output files for the partial job.
- Completed and failed multi-track jobs follow the same retention and explicit-delete behavior as current jobs. Overlay inputs require no separate cleanup mechanism because they live inside the job directory.
- Preview and download endpoints remain unavailable until the job is completed and continue to serve `video/mp4`.

## Edge cases and quality limitations

- Both overlay types may overlap in time and position. PIP is underneath the image/logo by design; there is no user-controlled z-order.
- Start equal to end is valid and renders the overlay for one project frame.
- An overlay may start on frame 0 or end on the final project frame.
- A schedule that becomes invalid after Video 1 edits blocks submission; it is never silently clipped by the backend or frontend.
- A short PIP freezes on its last decoded frame until its scheduled end. A long PIP is truncated. PIP source trim, speed, loop, and audio are not editable.
- VFR PIP is converted to the selected constant project FPS. Frame duplication or dropping is expected.
- All output is 1280×720 SDR `yuv420p`. HDR/wide-gamut metadata, 10-bit precision, and exact source color appearance are not preserved.
- Scaling preserves aspect ratio but can soften low-resolution overlays, especially at Large. There is no crop, sharpen, or supersampling control.
- PNG alpha is supported; animated PNG/GIF, SVG, HEIC, WebP, masks, blend modes, and opacity controls are not.
- The 24-pixel margin is fixed. Centre ignores that margin. Users cannot drag to arbitrary coordinates.
- The browser preview is an interaction aid. Browser seeking, VFR decoding, fonts/colors, and alpha compositing may differ slightly from FFmpeg output.
- Rounding source duration onto a CFR project clock can change a clip by at most roughly half a project frame relative to the mathematical duration; the shared frame-count rule keeps UI, validation, and render placement consistent.
- If an overlay has corrupt later frames that probing does not discover, the job may pass preflight and fail safely during processing.

## Test strategy

### Frontend unit and component tests

- Manifest construction includes independent nullable image/video descriptors with inclusive frames, position, and size while retaining Video 1 order, trims, speeds, FPS, and audio settings.
- Multipart submission sends each overlay under the correct named part exactly once and omits absent parts.
- Selection accepts only the specified extensions, rejects empty/oversized inputs against health limits, and reports unreadable metadata.
- The shared frame-count helper uses explicit half-up rounding and produces identical Video 1 slot boundaries and total project frames across supported FPS and speed values.
- New overlays receive the documented defaults. Replacements preserve valid settings; removal and reset revoke object URLs and clear descriptors.
- One-frame, first-frame, final-frame, overlapping, and out-of-range schedules receive the expected enabled/error state.
- Video 1 edits that invalidate an overlay visibly block render without silently changing its range.
- The preview shows/hides overlays on inclusive boundaries, uses the selected placement/size, synchronizes PIP relative time, and mutes PIP audio.
- Audio 1 and Audio 2 controls keep their current manifest behavior.
- The real timeline render action uses uploaded Video 1 clips and Video 2 overlays only; sample content never enters submission data.
- Exact assertions verify all five prohibited marketing/tagline strings are absent while the compact professional header and operational navigation remain.

### Backend API and validation tests

- Requests accept zero overlays, image only, video only, and both together without changing the endpoint or job response.
- Descriptor/file mismatches, duplicate parts, unknown overlay keys, non-object descriptors, booleans/floats for frames, reversed/negative ranges, invalid enum values, unsupported extensions, empty files, and oversized files return the documented structured status/code and leave no job data.
- Multipart file-count and total-body limits include both overlays and background audio.
- Generated overlay paths ignore hostile filenames; multipart files are closed on every success/failure path.
- Preflight rejects wrong decoded media type, no-video PIP, animated/non-still image, missing duration/frames, excessive dimensions/pixels, and ranges beyond the backend-calculated final project frame.
- Existing manifest/order, trim clamp, speed, FPS, audio, queue-full, cancellation, cleanup, job lookup, preview, download, and deletion tests continue to pass.

### Media pipeline unit tests

- Video 1 normalization uses the shared project-frame count and preserves trim-before-speed ordering, CFR, codecs, audio padding, and clip order.
- Argument-list assertions verify overlay input indices, restricted protocols/demuxers, project FPS, selected scale box, all coordinate expressions, exact PTS offset, inclusive `between(n,S,E)`, PIP `tpad`/`trim`, image alpha path, video-first/image-second z-order, output frame bound, and ignored PIP audio.
- No-overlay jobs retain the shortest existing path. Overlay-only jobs copy Audio 1. Overlay-plus-music jobs compose video before the unchanged Audio 2 mix and copy video during the mix.
- Subprocess timeout and sanitized failure behavior are covered for overlay probing and composition.

### Real FFmpeg integration and end-to-end tests

- Generate or check in tiny deterministic fixtures: colored Video 1 clips with audio, a transparent PNG logo, a short colored PIP with an audio track that must be ignored, and background music.
- Render both overlays across a Video 1 edit boundary. Probe the result for 1280×720 H.264 video, selected constant FPS, AAC stereo audio, exact expected frame count, MP4 container, and playable duration.
- Extract frames immediately before, at, and after each inclusive overlay boundary and assert expected pixels/regions; include simultaneous overlays at the same position to prove image-over-PIP z-order and PNG transparency.
- Inspect/meter audio to prove original/background settings still apply and PIP audio is absent.
- Exercise the browser flow for selecting, configuring, previewing, submitting, polling, playing, downloading, deleting/resetting, and confirming no MOV option or marketing blocks appear at desktop and mobile sizes.

Verification runs the complete backend suite, frontend unit suite, lint, production build, Playwright suite, and opt-in real FFmpeg integration suite. If FFmpeg/FFprobe are unavailable, only the real-media suite may be reported as skipped; unit coverage does not replace a real composition check before release.

## Explicitly out of scope

- MOV or any export format other than MP4; MOV remains Milestone 4.
- More than one image/logo or more than one video/PIP overlay.
- Additional video tracks, arbitrary layer stacks, user-controlled z-order, nested sequences, or multiple projects.
- Arbitrary drag positioning, keyframes, motion, transitions, fades, crop, rotation, opacity, masks, blend modes, chroma key, or effects.
- Text/title generation, captions/subtitles, templates, stock media, or brand-kit management.
- PIP source trimming, speed changes, looping, audio mixing, or independent color correction.
- Changes to Video 1’s supported speeds, transition-free sequential model, or inclusive source-frame trim semantics.
- More than one background-music file, waveform analysis, voice-over recording, or new audio effects.
- Resolution selection, portrait/square canvases, HDR, 4K output, hardware encoding, proxy media, or render-quality presets.
- Persistent project storage, undo/redo history, autosave, collaboration, authentication, databases, cloud uploads, deployment, or infrastructure changes.
- Package installation, system configuration, or a general Premiere Pro-style editing surface.

