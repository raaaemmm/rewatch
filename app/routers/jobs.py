from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse

from ..config import Settings, get_settings
from ..schemas import AUDIO_BITRATES, JobCreated, JobRequest, JobStatus, JobView
from ..security import (
    UnsafeURL,
    rate_limit,
    sign_job,
    validate_url,
    verify_job_token,
)
from ..services.jobs import JobManager, QueueFull, to_view
from .deps import get_manager

router = APIRouter(prefix="/jobs")


@router.post(
    "",
    response_model=JobCreated,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit)],
)
async def create_job(
    body: JobRequest,
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    if body.audio_bitrate is not None and body.audio_bitrate not in AUDIO_BITRATES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"audio_bitrate must be one of {list(AUDIO_BITRATES)}",
        )
    try:
        url = await asyncio.to_thread(validate_url, body.url, settings)
    except UnsafeURL as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    try:
        job_id = mgr.submit(body, url)
    except QueueFull as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Download queue is full — try again shortly",
            headers={"Retry-After": "30"},
        ) from exc
    return JobCreated(job_id=job_id, token=sign_job(job_id, settings))


async def _authorized_job(
    job_id: str, token: str | None, mgr: JobManager, settings: Settings
) -> dict:
    # same response for "bad token" and "unknown job" so ids can't be probed.
    if not verify_job_token(job_id, token, settings):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    job = await asyncio.to_thread(mgr.store.get, job_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found or expired")
    return job


@router.get("/{job_id}", response_model=JobView)
async def job_status(
    job_id: str,
    token: str = Query(""),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    return to_view(await _authorized_job(job_id, token, mgr, settings))


@router.get("/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    token: str = Query(""),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    await _authorized_job(job_id, token, mgr, settings)

    async def stream() -> AsyncIterator[str]:
        last, quiet = None, 0
        while not await request.is_disconnected():
            job = await asyncio.to_thread(mgr.store.get, job_id)
            if not job:
                yield "event: gone\ndata: {}\n\n"
                return
            view = to_view(job)
            payload = view.model_dump_json()
            if payload != last:
                last, quiet = payload, 0
                yield f"data: {payload}\n\n"
            else:
                quiet += 1
                if quiet >= 30:  # ~15 s: keep proxies (Cloudflare) from closing the stream
                    quiet = 0
                    yield ": ping\n\n"
            if view.status.terminal:
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/{job_id}/file")
async def job_file(
    job_id: str,
    token: str = Query(""),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    job = await _authorized_job(job_id, token, mgr, settings)
    path = mgr.file_path(job) if job["status"] == JobStatus.done.value else None
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not ready or expired")
    return FileResponse(
        path,
        filename=job.get("filename") or path.name,
        content_disposition_type="attachment",
    )


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_job(
    job_id: str,
    token: str = Query(""),
    mgr: JobManager = Depends(get_manager),
    settings: Settings = Depends(get_settings),
):
    await _authorized_job(job_id, token, mgr, settings)
    await asyncio.to_thread(mgr.cancel, job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
