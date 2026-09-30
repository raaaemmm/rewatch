from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class UrlRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class FormatOption(BaseModel):
    height: int
    label: str
    codec: str = ""


class InfoResponse(BaseModel):
    title: str = ""
    thumbnail: str = ""
    duration: float | None = None
    uploader: str = ""
    formats: list[FormatOption] = []
    warning: str = ""  # non-fatal server-side problem the UI should show
    photos: int = 0  # >0 = a photo slideshow with this many photos


class PhotoItem(BaseModel):
    """One photo of a slideshow post (TikTok), ready to show as its own card."""

    url: str
    thumbnail: str = ""
    title: str = ""


class PlaylistResponse(BaseModel):
    urls: list[str]
    truncated: bool = False
    photos: list[PhotoItem] = []  # only for slideshow posts


AUDIO_BITRATES: tuple[int, ...] = (128, 192, 320)


class JobRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    format: Literal["video", "audio"] = "video"
    height: int | None = Field(default=None, ge=64, le=8640)
    audio_bitrate: int | None = (
        None  # kbps; must be one of AUDIO_BITRATES, else server default
    )
    title: str = Field(default="", max_length=300)


class JobStatus(str, Enum):
    queued = "queued"
    downloading = "downloading"
    processing = "processing"
    done = "done"
    error = "error"
    cancelled = "cancelled"

    @property
    def terminal(self) -> bool:
        return self in (JobStatus.done, JobStatus.error, JobStatus.cancelled)


class JobView(BaseModel):
    """What clients see. Never exposes server file paths."""

    id: str
    status: JobStatus
    progress: float = 0.0  # 0..100
    speed: str | None = None  # e.g. "3.2 MB/s"
    eta: int | None = None  # seconds
    filename: str | None = None
    error: str | None = None


class JobCreated(BaseModel):
    job_id: str
    token: str


class ConfigResponse(BaseModel):
    version: str
    max_urls_per_batch: int
    max_playlist_items: int
    file_ttl_seconds: int
    audio_bitrates: list[int] = list(AUDIO_BITRATES)
