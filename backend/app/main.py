from __future__ import annotations

import asyncio
import contextlib
import json
import math
import shutil
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings
from .errors import (
    ApiError,
    ContentSizeLimitMiddleware,
    RequestBodyTooLarge,
    api_error_handler,
    http_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
from .jobs import AudioMixSettings, ClipEdit, Job, JobManager, JobRegistry, QueueIsFullError
from .media import InvalidMediaError, MediaPipeline
from .storage import Storage, UnsafePathError

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".aac", ".m4a"}


def _parse_manifest(raw: object, file_count: int) -> tuple[list[ClipEdit], AudioMixSettings]:
    if not isinstance(raw, str):
        raise ApiError(422, "invalid_manifest", "A JSON edit manifest is required.")
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ApiError(422, "invalid_manifest", "The edit manifest is not valid JSON.") from exc
    if not isinstance(value, dict) or not isinstance(value.get("clips"), list):
        raise ApiError(422, "invalid_manifest", "The edit manifest must include a clips array.")
    if len(value["clips"]) != file_count:
        raise ApiError(422, "invalid_manifest", "Manifest clips must match uploaded file order.")
    edits: list[ClipEdit] = []
    for index, item in enumerate(value["clips"]):
        if not isinstance(item, dict):
            raise ApiError(422, "invalid_manifest", f"Clip {index + 1} edit is invalid.")
        client_id = item.get("client_id")
        if not isinstance(client_id, str) or not client_id.strip():
            raise ApiError(422, "invalid_manifest", "Each clip needs a valid client ID.")
        start, end, speed = item.get("start_frame"), item.get("end_frame"), item.get("speed")
        trim_saved = item.get("trim_saved", True)
        if (
            isinstance(start, bool)
            or isinstance(end, bool)
            or not isinstance(start, int)
            or not isinstance(end, int)
        ):
            raise ApiError(422, "invalid_manifest", "Trim frames must be whole numbers.")
        if start < 0 or end < start:
            raise ApiError(
                422, "invalid_trim_range", "Each clip needs at least one selected frame."
            )
        if (
            isinstance(speed, bool)
            or not isinstance(speed, (int, float))
            or float(speed) not in {1.0, 0.75, 0.5}
        ):
            raise ApiError(422, "invalid_speed", "Speed must be 1, 0.75, or 0.5.")
        if not isinstance(trim_saved, bool):
            raise ApiError(422, "invalid_manifest", "Trim saved flags must be booleans.")
        edits.append(ClipEdit(start, end, float(speed), trim_saved))
    audio = value.get("audio")
    if not isinstance(audio, dict):
        raise ApiError(422, "invalid_manifest", "The manifest must include audio settings.")
    volumes = (audio.get("original_volume"), audio.get("music_volume"))
    if any(
        isinstance(v, bool)
        or not isinstance(v, (int, float))
        or not math.isfinite(float(v))
        or not 0 <= float(v) <= 1
        for v in volumes
    ):
        raise ApiError(422, "invalid_manifest", "Audio volumes must be between 0 and 1.")
    mutes = (audio.get("original_muted"), audio.get("music_muted"))
    if not all(isinstance(v, bool) for v in mutes):
        raise ApiError(422, "invalid_manifest", "Audio mute settings must be booleans.")
    return edits, AudioMixSettings(float(volumes[0]), mutes[0], float(volumes[1]), mutes[1])


def _tool_available(command: str) -> bool:
    path = Path(command)
    return path.is_file() if path.is_absolute() else shutil.which(command) is not None


def _job_id(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ApiError(400, "invalid_job_id", "The job ID is not a valid UUID.") from exc
    if parsed.version != 4 or str(parsed) != value.lower():
        raise ApiError(400, "invalid_job_id", "The job ID is not a valid UUID.")
    return str(parsed)


def create_app(
    settings: Settings | None = None,
    merge_executor: Callable[[Job], None] | None = None,
) -> FastAPI:
    config = settings or Settings.from_env()
    storage = Storage(config)
    registry = JobRegistry()
    pipeline = MediaPipeline(config)
    executor = merge_executor or pipeline.merge
    uses_builtin_pipeline = merge_executor is None
    manager = JobManager(config, storage, registry, executor)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await manager.start()
        try:
            yield
        finally:
            await manager.stop()

    app = FastAPI(title="ReelWeave API", version="0.1.0", lifespan=lifespan)
    app.state.settings = config
    app.state.storage = storage
    app.state.registry = registry
    app.state.job_manager = manager
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unexpected_error_handler)
    app.add_middleware(ContentSizeLimitMiddleware, max_bytes=config.max_request_size_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.allowed_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    def find_job(raw_id: str) -> Job:
        job = registry.get(_job_id(raw_id))
        if job is None:
            raise ApiError(404, "job_not_found", "No job exists with that ID.")
        return job

    @app.get("/api/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "ffmpeg_available": _tool_available(config.ffmpeg_path),
            "ffprobe_available": _tool_available(config.ffprobe_path),
            "limits": {
                "max_file_size_mb": config.max_file_size_mb,
                "max_clips": config.max_clips,
                "max_audio_file_size_mb": config.max_audio_file_size_mb,
            },
        }

    merge_openapi = {
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["files", "manifest"],
                        "properties": {
                            "files": {
                                "type": "array",
                                "minItems": config.min_clips,
                                "maxItems": config.max_clips,
                                "items": {"type": "string", "format": "binary"},
                            },
                            "manifest": {"type": "string"},
                            "background_audio": {"type": "string", "format": "binary"},
                        },
                    }
                }
            },
        }
    }

    @app.post("/api/merge", status_code=202, openapi_extra=merge_openapi)
    async def create_merge(request: Request) -> dict[str, str | None]:
        form = None
        job_id: str | None = None

        def cleanup_partial_job() -> None:
            if job_id is None:
                return
            registry.remove(job_id)
            with contextlib.suppress(OSError, UnsafePathError):
                storage.remove_job(job_id)

        try:
            if uses_builtin_pipeline and not (
                _tool_available(config.ffmpeg_path) and _tool_available(config.ffprobe_path)
            ):
                raise ApiError(
                    503,
                    "media_tools_unavailable",
                    "FFmpeg and FFprobe must be available to create a merge.",
                )
            try:
                form = await request.form(
                    max_files=config.max_clips + 1,
                    max_fields=10,
                    max_part_size=64 * 1024,
                )
            except RequestBodyTooLarge as exc:
                raise ApiError(
                    413, "request_too_large", "The upload request is too large."
                ) from exc
            except StarletteHTTPException as exc:
                raise ApiError(
                    400, "invalid_multipart", "The multipart upload is invalid."
                ) from exc

            files = form.getlist("files")
            if not config.min_clips <= len(files) <= config.max_clips:
                raise ApiError(
                    422,
                    "invalid_file_count",
                    f"Upload between {config.min_clips} and {config.max_clips} clips.",
                )
            if not all(isinstance(item, UploadFile) for item in files):
                raise ApiError(422, "invalid_files", "Each files field must contain a file.")
            extensions = [Path(item.filename or "").suffix.lower() for item in files]
            if any(extension not in ALLOWED_EXTENSIONS for extension in extensions):
                raise ApiError(
                    415,
                    "unsupported_media_type",
                    "Supported formats are MP4, MOV, WebM and MKV.",
                )
            clip_edits, audio_mix = _parse_manifest(form.get("manifest"), len(files))
            background_audio_parts = form.getlist("background_audio")
            if len(background_audio_parts) > 1:
                raise ApiError(
                    422,
                    "invalid_audio_count",
                    "Upload at most one background-audio file.",
                )
            background_audio = background_audio_parts[0] if background_audio_parts else None
            if background_audio is not None and not isinstance(background_audio, UploadFile):
                raise ApiError(422, "invalid_files", "Background audio must contain one file.")
            audio_extension = (
                Path(background_audio.filename or "").suffix.lower()
                if isinstance(background_audio, UploadFile)
                else None
            )
            if audio_extension is not None and audio_extension not in ALLOWED_AUDIO_EXTENSIONS:
                raise ApiError(
                    415,
                    "unsupported_audio_type",
                    "Supported audio formats are MP3, WAV, AAC and M4A.",
                )

            job_id = str(uuid.uuid4())
            try:
                job = Job.create(storage, job_id)
            except OSError as exc:
                cleanup_partial_job()
                raise ApiError(500, "upload_failed", "The clips could not be stored.") from exc
            registry.add(job)
            job.clip_edits = clip_edits
            job.audio_mix = audio_mix
            for index, (upload, extension) in enumerate(zip(files, extensions, strict=True)):
                destination = job.upload_dir / f"{index:03d}{extension}"
                size = 0
                with destination.open("xb") as target:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        if size > config.max_file_size_bytes:
                            raise ApiError(
                                413,
                                "file_too_large",
                                f"Each clip must be at most {config.max_file_size_mb:g} MiB.",
                            )
                        target.write(chunk)
                if size == 0:
                    raise ApiError(422, "empty_file", "Clips cannot be empty.")
                job.input_paths.append(destination)
            if isinstance(background_audio, UploadFile) and audio_extension is not None:
                destination = job.upload_dir / f"background{audio_extension}"
                size = 0
                with destination.open("xb") as target:
                    while chunk := await background_audio.read(1024 * 1024):
                        size += len(chunk)
                        if size > config.max_audio_file_size_bytes:
                            raise ApiError(
                                413,
                                "audio_too_large",
                                "Background audio must be at most "
                                f"{config.max_audio_file_size_mb:g} MiB.",
                            )
                        target.write(chunk)
                if size == 0:
                    raise ApiError(422, "empty_audio", "Background audio cannot be empty.")
                job.background_audio_path = destination
            if uses_builtin_pipeline:
                try:
                    await asyncio.to_thread(pipeline.validate_job, job)
                except InvalidMediaError as exc:
                    raise ApiError(422, "invalid_media", str(exc)) from exc
            manager.submit(job)
            return job.response()
        except QueueIsFullError as exc:
            cleanup_partial_job()
            raise ApiError(503, "queue_full", "The merge queue is full. Try again later.") from exc
        except ApiError:
            cleanup_partial_job()
            raise
        except OSError as exc:
            cleanup_partial_job()
            raise ApiError(500, "upload_failed", "The clips could not be stored.") from exc
        except asyncio.CancelledError:
            cleanup_partial_job()
            raise
        finally:
            if form is not None:
                with contextlib.suppress(OSError):
                    await form.close()

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str) -> dict[str, str | None]:
        return find_job(job_id).response()

    def completed_result(job_id: str) -> Job:
        job = find_job(job_id)
        if job.status != "completed" or not job.result_path.is_file():
            raise ApiError(409, "job_not_completed", "The merged video is not ready.")
        return job

    @app.get("/api/jobs/{job_id}/video")
    async def stream_video(job_id: str) -> FileResponse:
        return FileResponse(completed_result(job_id).result_path, media_type="video/mp4")

    @app.get("/api/jobs/{job_id}/download")
    async def download_video(job_id: str) -> FileResponse:
        return FileResponse(
            completed_result(job_id).result_path,
            media_type="video/mp4",
            filename="reelweave-merged.mp4",
        )

    @app.delete("/api/jobs/{job_id}", status_code=204)
    async def delete_job(job_id: str) -> Response:
        job = find_job(job_id)
        if job.status in {"queued", "processing"}:
            raise ApiError(409, "job_active", "An active job cannot be deleted.")
        try:
            storage.remove_job(job.id)
        except UnsafePathError as exc:
            raise ApiError(
                500, "unsafe_storage_path", "The job could not be removed safely."
            ) from exc
        registry.remove(job.id)
        return Response(status_code=204)

    return app


app = create_app()
