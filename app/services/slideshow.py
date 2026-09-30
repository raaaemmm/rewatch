"""TikTok photo slideshows (/@user/photo/<id>).

yt-dlp can't read these posts (it only sees the music), so we ask gallery-dl for the
image + audio URLs, download them from TikTok's CDN, and build an MP4 with ffmpeg.
gallery-dl is run as a subprocess with an argument list (no shell).
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from ..config import Settings
from ..schemas import FormatOption, InfoResponse, PhotoItem, PlaylistResponse
from ..security import safe_filename
from .extractor import DownloadCancelled, ExtractionError, _find_binary

log = logging.getLogger("rewatch.slideshow")

_PHOTO_RE = re.compile(
    r"^https?://(?:www\.|m\.)?tiktok\.com/@([^/?#]+)/photo/(\d+)", re.IGNORECASE
)
# Only ever download from TikTok's own hosts (gallery-dl output is not blindly trusted).
_CDN_SUFFIXES = ("tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us")
_MAX_IMAGE_BYTES = 25 * 1024 * 1024
_MAX_AUDIO_BYTES = 40 * 1024 * 1024
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
SECONDS_PER_PHOTO = 3.0
_QUALITIES = (1080, 720)  # output heights (portrait 9:16)


def is_photo_post(url: str) -> bool:
    return bool(_PHOTO_RE.match(url or ""))


# Links from TikTok's share button: vm.tiktok.com/ZS…/, vt.tiktok.com/ZS…/, tiktok.com/t/ZS…/
_SHORT_RE = re.compile(
    r"^https?://(?:(?:vm|vt)\.tiktok\.com/|(?:www\.)?tiktok\.com/t/)[^/?#\s]+",
    re.IGNORECASE,
)
_resolved: dict[str, tuple[float, str]] = {}


class _TikTokOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        host = (urlsplit(newurl).hostname or "").lower()
        if not (host == "tiktok.com" or host.endswith(".tiktok.com")):
            raise ExtractionError("Blocked a redirect to a non-TikTok host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _follow(url: str) -> str:
    opener = urllib.request.build_opener(_TikTokOnlyRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with opener.open(req, timeout=15) as resp:
        return resp.geturl()


def resolve_photo(url: str) -> str:
    """App share links (vm./vt./ /t/) -> the real /photo/ address when that's what they
    point to. Anything else (including short links to normal videos) is returned as is.
    """
    if is_photo_post(url) or not _SHORT_RE.match(url or ""):
        return url
    now = time.monotonic()
    hit = _resolved.get(url)
    if hit and now - hit[0] < 600:
        return hit[1]
    try:
        final = _follow(url)
    except (OSError, ExtractionError, ValueError):
        return url
    out = final if is_photo_post(final) else url
    _resolved[url] = (now, out)
    if len(_resolved) > 500:
        _resolved.clear()
    return out


_IMAGE_FRAG = re.compile(r"#image=(\d+)$")


def image_index(url: str) -> int | None:
    """1-based photo number when the URL ends in #image=N (a single photo), else None."""
    m = _IMAGE_FRAG.search(url or "")
    return int(m.group(1)) if m else None


def _image_ext(url: str) -> str:
    suffix = Path(urlsplit(url).path).suffix.lower()
    if suffix == ".jpeg":
        return ".jpg"
    return suffix if suffix in (".jpg", ".png", ".webp", ".avif", ".heic") else ".jpg"


def _clean_url(url: str) -> str:
    m = _PHOTO_RE.match(url)
    assert m
    return f"https://www.tiktok.com/@{m.group(1)}/photo/{m.group(2)}"


def _cdn_ok(url: str) -> bool:
    try:
        p = urlsplit(url)
        host = (p.hostname or "").lower()
    except ValueError:
        return False
    return p.scheme == "https" and any(
        host == s or host.endswith("." + s) for s in _CDN_SUFFIXES
    )


def split_media(lines: list[str]) -> tuple[list[str], str | None]:
    """gallery-dl -g output -> (image urls in order, audio url or None)."""
    images: list[str] = []
    audio: str | None = None
    for raw in lines:
        u = raw.strip()
        if not u.startswith("https://") or not _cdn_ok(u):
            continue
        low = u.lower()
        if "mime_type=audio" in low or "/video/tos/" in low:
            audio = audio or u
        else:
            images.append(u)
    return images, audio


_CACHE_TTL = 120.0  # info, "photos" and each photo's job all ask for the same list
_cache: dict[str, tuple[float, tuple[list[str], str | None]]] = {}
_cache_lock = threading.Lock()


def list_media(url: str, settings: Settings) -> tuple[list[str], str | None]:
    key = f"{_clean_url(url)}|{settings.slideshow_max_photos}"
    now = time.monotonic()
    with _cache_lock:
        for k in [k for k, (t, _) in _cache.items() if now - t > _CACHE_TTL]:
            del _cache[k]
        if key in _cache:
            return _cache[key][1]
    result = _list_media_uncached(url, settings)
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
    return result


def _list_media_uncached(url: str, settings: Settings) -> tuple[list[str], str | None]:
    cmd = [sys.executable, "-m", "gallery_dl", "--config-ignore", "-g", _clean_url(url)]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=45, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise ExtractionError("Timed out reading this TikTok post") from exc
    except OSError as exc:
        raise ExtractionError("Could not run gallery-dl on the server") from exc
    if "No module named gallery_dl" in (proc.stderr or ""):
        raise ExtractionError(
            "TikTok slideshows need gallery-dl on the server (pip install gallery-dl)"
        )
    images, audio = split_media(proc.stdout.splitlines())
    if not images:
        log.warning(
            "gallery-dl found no photos (exit %s): %s",
            proc.returncode,
            (proc.stderr or proc.stdout or "").strip()[-500:],
        )
        raise ExtractionError("No photos found in this TikTok post")
    return images[: settings.slideshow_max_photos], audio


def fetch_info(url: str, settings: Settings) -> InfoResponse:
    images, audio = list_media(url, settings)
    handle = _PHOTO_RE.match(url).group(1)  # type: ignore[union-attr]
    n = len(images)
    return InfoResponse(
        title=f"@{handle} slideshow ({n} photos)",
        thumbnail=images[0],
        duration=round(n * SECONDS_PER_PHOTO, 1),
        uploader=f"@{handle}",
        photos=n,
        formats=[
            FormatOption(height=h, label=f"{h}p", codec="h264") for h in _QUALITIES
        ],
    )


def photo_entries(url: str, settings: Settings) -> PlaylistResponse:
    """Every photo of the post as its own entry (like a playlist), for 'Save as photos'."""
    images, _ = list_media(url, settings)
    handle = _PHOTO_RE.match(url).group(1)  # type: ignore[union-attr]
    base = _clean_url(url)
    n = len(images)
    urls = [f"{base}#image={i}" for i in range(1, n + 1)]
    photos = [
        PhotoItem(
            url=urls[i], thumbnail=images[i], title=f"@{handle} photo {i + 1} of {n}"
        )
        for i in range(n)
    ]
    return PlaylistResponse(urls=urls, photos=photos)


# --------------------------------------------------------------------------
# Download + build
# --------------------------------------------------------------------------
class _CdnOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        if not _cdn_ok(newurl):
            raise ExtractionError("Blocked a redirect to a non-TikTok host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _download(url: str, dest: Path, limit: int, check: Callable[[], None]) -> None:
    if not _cdn_ok(url):
        raise ExtractionError("Blocked a non-TikTok media address")
    opener = urllib.request.build_opener(_CdnOnlyRedirect)
    req = urllib.request.Request(
        url, headers={"User-Agent": _UA, "Referer": "https://www.tiktok.com/"}
    )
    try:
        with opener.open(req, timeout=20) as resp, open(dest, "wb") as out:
            total = 0
            while chunk := resp.read(64 * 1024):
                check()
                total += len(chunk)
                if total > limit:
                    raise ExtractionError("A photo or audio file is too large")
                out.write(chunk)
    except ExtractionError:
        raise
    except OSError as exc:  # URLError / timeouts are OSError subclasses
        raise ExtractionError("Could not download the slideshow files") from exc


def _run_ffmpeg(
    cmd: list[str],
    settings: Settings,
    started: float,
    is_cancelled: Callable[[], bool],
) -> None:
    proc = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
    )
    try:
        while proc.poll() is None:
            if is_cancelled():
                raise DownloadCancelled("Cancelled")
            if (
                settings.download_timeout_seconds
                and time.monotonic() - started > settings.download_timeout_seconds
            ):
                raise ExtractionError("Download timed out")
            time.sleep(0.4)
        if proc.returncode != 0:
            raise ExtractionError("Could not build the slideshow video")
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        if proc.stderr:
            proc.stderr.close()


def _video_cmd(
    ffmpeg: str, images: list[Path], audio: Path | None, height: int, out: Path
) -> list[str]:
    # TikTok is portrait, so "1080p" means 1080 wide x 1920 tall (like TikTok itself).
    w = height - height % 2
    h = int(w * 16 / 9) // 2 * 2
    cmd = [ffmpeg, "-y", "-loglevel", "error"]
    for img in images:
        cmd += [
            "-loop",
            "1",
            "-framerate",
            "30",
            "-t",
            str(SECONDS_PER_PHOTO),
            "-i",
            str(img),
        ]
    if audio:
        cmd += ["-stream_loop", "-1", "-i", str(audio)]
    fit = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
    )
    parts = [f"[{i}:v]{fit}[v{i}]" for i in range(len(images))]
    joined = "".join(f"[v{i}]" for i in range(len(images)))
    parts.append(f"{joined}concat=n={len(images)}:v=1:a=0[v]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[v]"]
    if audio:
        cmd += ["-map", f"{len(images)}:a", "-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30",
        "-movflags", "+faststart", str(out),
    ]  # fmt: skip
    return cmd


def run_download(
    *,
    url: str,
    fmt: str,
    height: int | None,
    audio_bitrate: int | None,
    title: str,
    job_id: str,
    settings: Settings,
    on_update: Callable[[dict], None],
    is_cancelled: Callable[[], bool],
) -> tuple[Path, str]:
    started = time.monotonic()

    def check() -> None:
        if is_cancelled():
            raise DownloadCancelled("Cancelled")
        if (
            settings.download_timeout_seconds
            and time.monotonic() - started > settings.download_timeout_seconds
        ):
            raise ExtractionError("Download timed out")

    images_urls, audio_url = list_media(url, settings)

    if (idx := image_index(url)) is not None:  # one photo, saved as the original image
        if not 1 <= idx <= len(images_urls):
            raise ExtractionError("That photo isn't in this post any more")
        src = images_urls[idx - 1]
        ext = _image_ext(src)
        out = settings.download_dir / f"{job_id}{ext}"
        try:
            on_update(
                {"status": "downloading", "progress": 30.0, "speed": None, "eta": None}
            )
            _download(src, out, _MAX_IMAGE_BYTES, check)
        except BaseException:
            out.unlink(missing_ok=True)
            raise
        return out, safe_filename(title or f"photo {idx}", job_id, ext)

    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        raise ExtractionError("The server needs ffmpeg to build slideshows")
    want_audio = fmt == "audio"
    if want_audio and not audio_url:
        raise ExtractionError("This slideshow has no music to save")

    work = Path(tempfile.mkdtemp(prefix="rewatch_slide_"))
    ext = ".mp3" if want_audio else ".mp4"
    out = settings.download_dir / f"{job_id}{ext}"
    try:
        jobs: list[tuple[str, Path, int]] = []
        if not want_audio:
            for i, u in enumerate(images_urls):
                jobs.append((u, work / f"img{i:02d}.jpg", _MAX_IMAGE_BYTES))
        if audio_url:
            jobs.append((audio_url, work / "audio.bin", _MAX_AUDIO_BYTES))

        for n, (u, dest, limit) in enumerate(jobs):
            _download(u, dest, limit, check)
            on_update(
                {
                    "status": "downloading",
                    "progress": round((n + 1) / len(jobs) * 70, 1),
                    "speed": None,
                    "eta": None,
                }
            )

        on_update(
            {"status": "processing", "progress": 96.0, "speed": None, "eta": None}
        )
        audio_path = (work / "audio.bin") if audio_url else None
        if want_audio:
            bitrate = audio_bitrate or settings.audio_bitrate_kbps
            cmd = [
                ffmpeg, "-y", "-loglevel", "error", "-i", str(audio_path),
                "-vn", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k", str(out),
            ]  # fmt: skip
        else:
            imgs = [j[1] for j in jobs if j[1].name.startswith("img")]
            cmd = _video_cmd(ffmpeg, imgs, audio_path, height or _QUALITIES[0], out)
        _run_ffmpeg(cmd, settings, started, is_cancelled)
    except BaseException:
        out.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if not out.is_file():
        raise ExtractionError("No file was produced")
    return out, safe_filename(title, job_id, ext)
