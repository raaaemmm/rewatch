"""Runtime configuration. Every setting can be overridden with a REWATCH_* env var."""

from __future__ import annotations

import json
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="REWATCH_", env_file=".env", extra="ignore"
    )

    # server
    download_dir: Path = BASE_DIR / "downloads"
    static_dir: Path = BASE_DIR / "static"

    # storage (jobs live in memory, so run a single worker)
    file_ttl_seconds: int = 1800  # finished files/jobs are deleted after this
    cleanup_interval_seconds: int = 60

    # limits
    max_concurrent_downloads: int = 5  # worker pool size
    max_queued_jobs: int = 80  # reject new jobs (429) beyond this
    max_playlist_items: int = 80
    max_urls_per_batch: int = 80  # advertised to the UI
    max_duration_seconds: int = 4 * 3600  # 0 = unlimited
    max_filesize_mb: float = 2048  # 0 = unlimited
    info_timeout_seconds: int = 60
    download_timeout_seconds: int = 1800
    rate_limit_per_minute: int = 50  # per client IP, 0 = off

    # security
    # Signs per-job tokens. Set a fixed value so tokens survive restarts;
    # an empty value falls back to a random key generated at startup.
    secret_key: str = Field(default_factory=lambda: secrets.token_hex(32))

    @field_validator("secret_key")
    @classmethod
    def _non_empty_secret(cls, v: str) -> str:
        return v or secrets.token_hex(32)

    # Trust CF-Connecting-IP / X-Forwarded-For (only enable behind Cloudflare
    # or another proxy you control, otherwise clients can spoof their IP).
    trust_proxy_headers: bool = False

    # Public address of this site, e.g. https://rewatch.example.com. Used for the
    # canonical link, share previews (Open Graph) and the sitemap. Empty = work it
    # out from each request, which is fine for a single hostname.
    public_url: str = ""

    # Reject URLs that resolve to private/loopback/link-local addresses (SSRF).
    allow_private_urls: bool = False
    # Empty = any public host. In .env write it comma-separated: youtube.com,youtu.be
    # (a JSON list such as ["youtube.com","youtu.be"] also works).
    allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=list)

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def _split_hosts(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [h.strip() for h in v.split(",") if h.strip()]
        return v

    # media
    # Prefer H.264 + AAC so MP4s play everywhere (iOS, Windows, TVs).
    prefer_compatible_codecs: bool = True
    audio_bitrate_kbps: int = 192

    # full path to deno.exe / deno if it isn't on PATH and isn't in a standard location.
    deno_path: str = ""

    # TikTok photo slideshows: most photos to turn into one video.
    slideshow_max_photos: int = 40


@lru_cache
def get_settings() -> Settings:
    return Settings()
