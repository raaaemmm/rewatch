from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status

from ..config import Settings, get_settings
from ..schemas import InfoResponse, PlaylistResponse, UrlRequest
from ..security import UnsafeURL, rate_limit, validate_url
from ..services import extractor

router = APIRouter(dependencies=[Depends(rate_limit)])


async def _run(fn, raw_url: str, settings: Settings, timeout: float):
    try:
        url = await asyncio.to_thread(validate_url, raw_url, settings)
        return await asyncio.wait_for(asyncio.to_thread(fn, url, settings), timeout)
    except UnsafeURL as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except extractor.ExtractionError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT, "Timed out fetching media info"
        ) from exc


@router.post("/info", response_model=InfoResponse)
async def info(body: UrlRequest, settings: Settings = Depends(get_settings)):
    return await _run(
        extractor.fetch_info, body.url, settings, settings.info_timeout_seconds
    )


@router.post("/playlist", response_model=PlaylistResponse)
async def playlist(body: UrlRequest, settings: Settings = Depends(get_settings)):
    return await _run(
        extractor.fetch_playlist, body.url, settings, settings.info_timeout_seconds
    )
