"""In-memory job store and the worker pool that runs downloads."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..config import Settings
from ..schemas import JobRequest, JobStatus, JobView
from . import extractor

log = logging.getLogger("rewatch.jobs")


class QueueFull(Exception):
    pass


# --------------------------------------------------------------------------
# Store (in-memory; single process)
# --------------------------------------------------------------------------
class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, dict] = {}
        self._cancel: set[str] = set()
        self._lock = threading.Lock()

    def create(self, job: dict) -> None:
        with self._lock:
            self._jobs[job["id"]] = job

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            j = self._jobs.get(job_id)
            return dict(j) if j else None

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(fields)

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)
            self._cancel.discard(job_id)

    def all(self) -> list[dict]:
        with self._lock:
            return [dict(j) for j in self._jobs.values()]

    def request_cancel(self, job_id: str) -> None:
        with self._lock:
            self._cancel.add(job_id)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancel


def to_view(job: dict) -> JobView:
    return JobView(
        id=job["id"],
        status=JobStatus(job["status"]),
        progress=job.get("progress", 0.0),
        speed=job.get("speed"),
        eta=job.get("eta"),
        filename=job.get("filename"),
        error=job.get("error"),
    )


# --------------------------------------------------------------------------
# Manager
# --------------------------------------------------------------------------
class JobManager:
    def __init__(self, settings: Settings, store: JobStore) -> None:
        self.settings = settings
        self.store = store
        self.executor = ThreadPoolExecutor(
            max_workers=max(1, settings.max_concurrent_downloads),
            thread_name_prefix="rewatch-dl",
        )
        self._pending = 0
        self._lock = threading.Lock()

    def submit(self, req: JobRequest, url: str) -> str:
        with self._lock:
            if self._pending >= self.settings.max_queued_jobs:
                raise QueueFull()
            self._pending += 1
        job_id = uuid.uuid4().hex
        self.store.create(
            {
                "id": job_id,
                "url": url,
                "title": req.title,
                "format": req.format,
                "height": req.height,
                "audio_bitrate": req.audio_bitrate,
                "status": JobStatus.queued.value,
                "progress": 0.0,
                "speed": None,
                "eta": None,
                "file": None,
                "filename": None,
                "error": None,
                "created_at": time.time(),
                "finished_at": None,
            }
        )
        self.executor.submit(self._run, job_id)
        return job_id

    def cancel(self, job_id: str) -> None:
        self.store.request_cancel(job_id)

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)

    # ---- worker ----------------------------------------------------------
    def _finish(self, job_id: str, **fields) -> None:
        self.store.update(job_id, finished_at=time.time(), speed=None, eta=None, **fields)

    def _run(self, job_id: str) -> None:
        try:
            job = self.store.get(job_id)
            if not job:
                return
            if self.store.is_cancelled(job_id):
                self._finish(job_id, status=JobStatus.cancelled.value)
                return
            self.store.update(job_id, status=JobStatus.downloading.value)

            last_write = 0.0
            last_cancel_check = 0.0
            cancelled = False

            def on_update(fields: dict) -> None:
                nonlocal last_write
                now = time.monotonic()
                if fields.get("status") == "downloading" and now - last_write < 0.4:
                    return
                last_write = now
                self.store.update(job_id, **fields)

            def is_cancelled() -> bool:
                nonlocal last_cancel_check, cancelled
                now = time.monotonic()
                if not cancelled and now - last_cancel_check > 0.5:
                    last_cancel_check = now
                    cancelled = self.store.is_cancelled(job_id)
                return cancelled

            path, filename = extractor.run_download(
                url=job["url"],
                fmt=job["format"],
                height=job["height"],
                audio_bitrate=job.get("audio_bitrate"),
                title=job["title"],
                job_id=job_id,
                settings=self.settings,
                on_update=on_update,
                is_cancelled=is_cancelled,
            )
            self._finish(
                job_id,
                status=JobStatus.done.value,
                progress=100.0,
                file=path.name,
                filename=filename,
            )
        except extractor.DownloadCancelled:
            self._finish(job_id, status=JobStatus.cancelled.value)
        except extractor.ExtractionError as exc:
            self._finish(job_id, status=JobStatus.error.value, error=str(exc)[:300])
        except Exception:  # noqa: BLE001
            log.exception("Unexpected error in job %s", job_id)
            self._finish(job_id, status=JobStatus.error.value, error="Unexpected server error")
        finally:
            with self._lock:
                self._pending -= 1

    def file_path(self, job: dict) -> Path | None:
        name = job.get("file")
        if not name:
            return None
        p = (self.settings.download_dir / name).resolve()
        if p.parent != self.settings.download_dir.resolve() or not p.is_file():
            return None
        return p
