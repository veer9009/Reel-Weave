from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Literal

from .config import Settings
from .storage import Storage, UnsafePathError

JobStatus = Literal["queued", "processing", "completed", "failed"]


@dataclass(frozen=True, slots=True)
class ClipEdit:
    start_frame: int
    end_frame: int
    speed: float
    trim_saved: bool = True


@dataclass(frozen=True, slots=True)
class AudioMixSettings:
    original_volume: float = 1.0
    original_muted: bool = False
    music_volume: float = 0.3
    music_muted: bool = False


@dataclass(slots=True)
class Job:
    id: str
    upload_dir: Path
    intermediate_dir: Path
    output_dir: Path
    result_path: Path
    input_paths: list[Path] = field(default_factory=list)
    clip_edits: list[ClipEdit] = field(default_factory=list)
    background_audio_path: Path | None = None
    audio_mix: AudioMixSettings = field(default_factory=AudioMixSettings)
    status: JobStatus = "queued"
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @classmethod
    def create(cls, storage: Storage, job_id: str) -> Job:
        upload, intermediate, output = storage.prepare_job(job_id)
        return cls(job_id, upload, intermediate, output, output / "merged.mp4")

    def response(self) -> dict[str, str | None]:
        return {"job_id": self.id, "status": self.status, "error": self.error}


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = RLock()

    def add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def remove(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.pop(job_id, None)

    def active_ids(self) -> set[str]:
        with self._lock:
            return {job.id for job in self._jobs.values() if job.status in {"queued", "processing"}}

    def known_ids(self) -> set[str]:
        with self._lock:
            return set(self._jobs)

    def cleanup_expired(self, storage: Storage, retention_seconds: int, now: float) -> None:
        with self._lock:
            expired = [
                job.id
                for job in self._jobs.values()
                if job.status in {"completed", "failed"}
                and now - job.updated_at > retention_seconds
            ]
        for job_id in expired:
            try:
                storage.remove_job(job_id)
            except (OSError, UnsafePathError):
                continue
            self.remove(job_id)


class QueueIsFullError(RuntimeError):
    pass


class JobManager:
    def __init__(
        self,
        settings: Settings,
        storage: Storage,
        registry: JobRegistry,
        merge_executor: Callable[[Job], None],
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.registry = registry
        self.merge_executor = merge_executor
        self.queue: asyncio.Queue[Job] = asyncio.Queue(maxsize=settings.queue_size)
        self._worker: asyncio.Task[None] | None = None
        self._cleaner: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self.storage.cleanup_orphans(active_job_ids=set())
        self._worker = asyncio.create_task(self._worker_loop(), name="reelweave-worker")
        self._cleaner = asyncio.create_task(self._cleanup_loop(), name="reelweave-cleanup")

    async def stop(self) -> None:
        if self._cleaner is not None:
            self._cleaner.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cleaner
        if self._worker is not None:
            await self.queue.join()
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker

    def submit(self, job: Job) -> None:
        try:
            self.queue.put_nowait(job)
        except asyncio.QueueFull as exc:
            raise QueueIsFullError from exc

    async def _worker_loop(self) -> None:
        while True:
            job = await self.queue.get()
            job.status = "processing"
            job.updated_at = time.time()
            try:
                await asyncio.to_thread(self.merge_executor, job)
            except Exception:
                job.status = "failed"
                job.error = "Video processing failed. Check that each clip is readable."
            else:
                job.status = "completed"
                job.error = None
            finally:
                job.updated_at = time.time()
                self.queue.task_done()

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(self.settings.cleanup_interval_seconds)
            now = time.time()
            self.registry.cleanup_expired(self.storage, self.settings.retention_seconds, now)
            self.storage.cleanup_orphans(self.registry.known_ids(), now)
