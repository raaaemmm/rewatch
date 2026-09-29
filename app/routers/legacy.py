"""Reclip-compatible aliases.

Reclip's original paths, served next to /api/v1 and delegating to the very same
handlers, so API-key auth, rate limiting, SSRF checks and job tokens live in one place:

    POST /api/info            -> /api/v1/info        (mounted in main.py)
    POST /api/playlist        -> /api/v1/playlist    (mounted in main.py)
    POST /api/download        -> POST /api/v1/jobs
    GET  /api/status/{id}     -> GET  /api/v1/jobs/{id}
    GET  /api/file/{id}       -> GET  /api/v1/jobs/{id}/file
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query

from ..config import Settings, get_settings
from ..schemas import JobCreated, JobRequest, JobStatus
from ..security import rate_limit, require_api_key, sign_job
from ..services.jobs import JobManager
from . import jobs as v1
from .deps import get_manager

router = APIRouter(prefix="/api", tags=["reclip-compat"], include_in_schema=False)

# reclip only ever reports downloading | done | error; fold Rewatch's extra states into those
# so a Reclip-style polling loop never sees a status it doesn't know.
_STATUS_MAP = {
    JobStatus.queued: "downloading",
    JobStatus.processing: "downloading",
    JobStatus.cancelled: "error",
}


def _token(job_id: str, query: str, header: str | None, settings: Settings) -> str:
    supplied = query or header or ""
    if not supplied and not settings.legacy_require_token:
        return sign_job(job_id, settings)
    return supplied


@router.post(
    "/download",
    response_model=JobCreated,
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)
async def download(
    body: JobRequest,
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    # same body shape as Reclip: {url, format, format_id, title}.
    # returns {job_id, token}; the extra token is what /status and /file need.
    return await v1.create_job(body, mgr, settings)


@router.get("/status/{job_id}")
async def status(
    job_id: str,
    token: str = Query(""),
    x_job_token: str | None = Header(default=None),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    view = await v1.job_status(
        job_id, _token(job_id, token, x_job_token, settings), mgr, settings
    )
    data = view.model_dump(
        mode="json"
    )  # superset of Reclip's {status, error, filename}
    data["status"] = _STATUS_MAP.get(view.status, view.status.value)
    if view.status is JobStatus.cancelled and not data["error"]:
        data["error"] = "Cancelled"
    return data


@router.get("/file/{job_id}")
async def file(
    job_id: str,
    token: str = Query(""),
    x_job_token: str | None = Header(default=None),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    return await v1.job_file(
        job_id, _token(job_id, token, x_job_token, settings), mgr, settings
    )
