"""Input validation, SSRF guard, per-job tokens and rate limiting."""

from __future__ import annotations

import hmac
import ipaddress
import re
import socket
import threading
import time
from collections import defaultdict, deque
from hashlib import sha256
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status

from .config import Settings, get_settings


class UnsafeURL(ValueError):
    """Raised when a URL is malformed or points somewhere we refuse to fetch."""


# --------------------------------------------------------------------------
# URL validation (blocks option injection and SSRF)
# --------------------------------------------------------------------------
def _is_public_ip(raw: str) -> bool:
    ip = ipaddress.ip_address(raw.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


def _host_allowed(host: str, allowed: list[str]) -> bool:
    return any(
        host == a or host.endswith("." + a) for a in (h.lower().lstrip(".") for h in allowed)
    )


def validate_url(raw: str, settings: Settings | None = None) -> str:
    """Return a cleaned http(s) URL or raise UnsafeURL.

    Blocking (does a DNS lookup) — call it via ``asyncio.to_thread`` from async code.
    Note: yt-dlp is used as a library, so a URL can never be parsed as a CLI flag;
    we still require an http(s) scheme, which also rejects anything starting with "-".
    """
    settings = settings or get_settings()
    url = (raw or "").strip()
    if not url or len(url) > 2048 or any(c.isspace() or ord(c) < 32 for c in url):
        raise UnsafeURL("Invalid URL")

    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError as exc:
        raise UnsafeURL("Invalid URL") from exc

    if parts.scheme not in ("http", "https") or not host:
        raise UnsafeURL("Only http:// and https:// URLs are supported")
    if parts.username or parts.password:
        raise UnsafeURL("URLs with embedded credentials are not allowed")
    if settings.allowed_hosts and not _host_allowed(host, settings.allowed_hosts):
        raise UnsafeURL("This site is not on the allow-list")

    if not settings.allow_private_urls:
        if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
            raise UnsafeURL("Private addresses are not allowed")
        try:
            infos = socket.getaddrinfo(
                host,
                port or (443 if parts.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as exc:
            raise UnsafeURL("Could not resolve host") from exc
        if not infos or not all(_is_public_ip(i[4][0]) for i in infos):
            raise UnsafeURL("Private addresses are not allowed")
    return url


_FILENAME_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_filename(title: str, fallback: str, ext: str) -> str:
    name = _FILENAME_BAD.sub("", title or "").strip(" .")[:100].strip(" .")
    return f"{name or fallback}{ext}"


# --------------------------------------------------------------------------
# Per-job tokens
# --------------------------------------------------------------------------
def sign_job(job_id: str, settings: Settings) -> str:
    return hmac.new(settings.secret_key.encode(), job_id.encode(), sha256).hexdigest()[:32]


def verify_job_token(job_id: str, token: str | None, settings: Settings) -> bool:
    return bool(token) and hmac.compare_digest(sign_job(job_id, settings), token)


# --------------------------------------------------------------------------
# Rate limiting (per client IP)
# --------------------------------------------------------------------------
def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        cf = request.headers.get("cf-connecting-ip")
        if cf:
            return cf.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    def __init__(self, window: float = 60.0) -> None:
        self.window = window
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def allow(self, key: str, limit: int) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > self.window:  # drop idle keys
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]
                self._last_sweep = now
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= limit:
                return False, max(1, int(self.window - (now - q[0])))
            q.append(now)
            return True, 0


limiter = SlidingWindowLimiter()


async def rate_limit(request: Request, settings: Settings = Depends(get_settings)) -> None:
    if settings.rate_limit_per_minute <= 0:
        return
    ok, retry = limiter.allow(client_ip(request, settings), settings.rate_limit_per_minute)
    if not ok:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests — slow down",
            headers={"Retry-After": str(retry)},
        )
