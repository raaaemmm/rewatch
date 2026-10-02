"""Thin wrapper around yt-dlp used as a *library* (no shell, no CLI parsing)."""

from __future__ import annotations

import copy
import importlib.util
import os
import re
import shutil
import time
from collections.abc import Callable
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, YoutubeDLError

from ..config import Settings
from ..schemas import FormatOption, InfoResponse, PlaylistResponse
from ..security import safe_filename
from . import platforms

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


class ExtractionError(Exception):
    """A user-presentable failure (bad URL, private video, too long, ...)."""


class DownloadCancelled(Exception):
    pass


_RUNTIME_NAMES = (
    "deno",
    "node",
    "bun",
)  # yt-dlp's supported JS runtimes, preferred first


def _extra_bin_dirs() -> list[Path]:
    """Places a freshly installed runtime often lives but a running shell's PATH misses
    (e.g. right after `winget install DenoLand.Deno`, or a per-user Deno install)."""
    home = Path.home()
    dirs = [home / ".deno" / "bin", home / ".bun" / "bin"]
    if local := os.environ.get("LOCALAPPDATA"):
        dirs += [
            Path(local) / "Microsoft" / "WinGet" / "Links",
            Path(local) / "Microsoft" / "WinGet" / "Packages",
        ]
    if pf := os.environ.get("ProgramFiles"):
        dirs += [Path(pf) / "deno", Path(pf) / "nodejs"]
    dirs += [Path("/usr/local/bin"), Path("/opt/homebrew/bin")]
    return dirs


def _find_binary(name: str, override: str = "") -> str | None:
    if override and Path(override).is_file():
        return override
    if found := shutil.which(name):
        return found
    exe = name + (".exe" if os.name == "nt" else "")
    for d in _extra_bin_dirs():
        cand = d / exe
        if cand.is_file():
            return str(cand)
    return None


def js_runtimes(settings: Settings | None = None) -> dict[str, dict]:
    """JS runtimes yt-dlp can use to solve YouTube's challenges, as yt-dlp's
    `js_runtimes` option expects them ({name: {"path": ...}}). Empty if none found."""
    override = settings.deno_path if settings else ""
    out: dict[str, dict] = {}
    for name in _RUNTIME_NAMES:
        if path := _find_binary(name, override if name == "deno" else ""):
            out[name] = {"path": path}
    return out


def youtube_prereq_problems(settings: Settings | None = None) -> list[str]:
    """What yt-dlp needs for *full* YouTube format lists. Without these it still runs but
    silently returns only a handful of formats (often just one low resolution)."""
    problems = []
    if importlib.util.find_spec("yt_dlp_ejs") is None:
        problems.append('yt-dlp-ejs (pip install -U "yt-dlp[default]")')
    if not js_runtimes(settings):
        problems.append("deno on PATH (https://deno.com)")
    return problems


def clean_error(exc: BaseException) -> str:
    text = _ANSI.sub("", str(exc)).strip()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    msg = lines[-1] if lines else "Unknown error"
    msg = re.sub(r"^(ERROR:\s*)+", "", msg)
    return msg[:300]


def _base_opts(settings: Settings) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "ignoreconfig": True,  # never read user/system yt-dlp config files
        "socket_timeout": 20,
        "retries": 3,
        "color": {"stdout": "never", "stderr": "never"},
    }
    if runtimes := js_runtimes(settings):
        opts["js_runtimes"] = runtimes  # explicit paths: works even when PATH is stale
    if importlib.util.find_spec("yt_dlp_ejs") is None:
        opts["remote_components"] = ["ejs:github"]  # let yt-dlp fetch the solver itself
    return opts


# --------------------------------------------------------------------------
# Metadata
# --------------------------------------------------------------------------
def _codec_label(vcodec: str) -> str:
    v = (vcodec or "").lower()
    if v.startswith(("avc1", "h264")):
        return "h264"
    if v.startswith(("vp9", "vp09")):
        return "vp9"
    if v.startswith("av01"):
        return "av1"
    if v.startswith(("hev", "hvc", "h265")):
        return "h265"
    return v.split(".")[0]


def _first_entry(info: dict) -> dict:
    if info.get("entries"):
        entries = [e for e in info["entries"] if e]
        if not entries:
            raise ExtractionError("No media found at this URL")
        return entries[0]
    return info


def fetch_info(url: str, settings: Settings) -> InfoResponse:
    from . import slideshow  # local import: slideshow imports this module

    url = slideshow.resolve_photo(url)  # TikTok app share links
    if slideshow.is_photo_post(url):
        return slideshow.fetch_info(url, settings)
    try:
        with YoutubeDL(_base_opts(settings)) as ydl:
            info = _first_entry(
                ydl.sanitize_info(ydl.extract_info(url, download=False))
            )
    except ExtractionError:
        raise
    except YoutubeDLError as exc:
        raise ExtractionError(clean_error(exc)) from exc

    # One entry per resolution; among equals prefer H.264 (plays everywhere), then bitrate.
    best: dict[int, dict] = {}
    for f in info.get("formats") or []:
        h = f.get("height")
        if not h or f.get("vcodec") == "none":  # None = unknown codec, still a video
            continue
        rank = (
            (
                1
                if settings.prefer_compatible_codecs
                and (f.get("vcodec") or "").startswith("avc1")
                else 0
            ),
            f.get("tbr") or 0,
        )
        if h not in best or rank > best[h]["rank"]:
            best[h] = {
                "rank": rank,
                "codec": _codec_label(f.get("vcodec") or ""),
            }

    thumb = info.get("thumbnail") or ""
    if not thumb.startswith(("http://", "https://")):
        thumb = ""

    warning = ""
    is_youtube = (info.get("extractor_key") or "").lower().startswith("youtube")
    if is_youtube and (problems := youtube_prereq_problems(settings)):
        warning = (
            "Only a few qualities are available because the server is missing: "
            + "; ".join(problems)
            + "."
        )

    return InfoResponse(
        warning=warning,
        platform=platforms.detect(
            info.get("webpage_url") or url,
            info.get("extractor_key"),
            info.get("extractor"),
        ),
        title=info.get("title") or "",
        thumbnail=thumb,
        duration=info.get("duration"),
        uploader=info.get("uploader") or info.get("channel") or "",
        formats=[
            FormatOption(height=h, label=f"{h}p", codec=v["codec"])
            for h, v in sorted(best.items(), reverse=True)
        ],
    )


def fetch_playlist(url: str, settings: Settings) -> PlaylistResponse:
    from . import slideshow  # local import: slideshow imports this module

    url = slideshow.resolve_photo(url)
    if slideshow.is_photo_post(url):
        return slideshow.photo_entries(url, settings)
    opts = _base_opts(settings) | {
        "noplaylist": False,
        "extract_flat": "in_playlist",
        "playlistend": settings.max_playlist_items + 1,
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.sanitize_info(ydl.extract_info(url, download=False))
    except YoutubeDLError as exc:
        raise ExtractionError(clean_error(exc)) from exc

    urls: list[str] = []
    for entry in info.get("entries") or []:
        u = (entry or {}).get("url") or (entry or {}).get("webpage_url")
        if u and u.startswith(("http://", "https://")):
            urls.append(u)
    truncated = len(urls) > settings.max_playlist_items
    return PlaylistResponse(
        urls=urls[: settings.max_playlist_items],
        truncated=truncated,
    )


# --------------------------------------------------------------------------
# Download
# --------------------------------------------------------------------------
def video_selector(height: int | None, compatible: bool) -> str:
    h = f"[height<={height}]" if height else ""
    parts: list[str] = []
    if compatible:  # H.264 + AAC first
        parts += [
            f"bv*{h}[vcodec^=avc1]+ba[acodec^=mp4a]",
            f"b{h}[ext=mp4][vcodec^=avc1]",
        ]
    parts += [f"bv*{h}+ba", f"b{h}", "b"]
    return "/".join(parts)


def _fmt_speed(bps: float | None) -> str | None:
    if not bps:
        return None
    for unit in ("B/s", "KB/s", "MB/s", "GB/s"):
        if bps < 1024 or unit == "GB/s":
            return f"{bps:.1f} {unit}" if unit != "B/s" else f"{bps:.0f} B/s"
        bps /= 1024
    return None


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
    """Blocking. Returns (path_on_disk, download_filename)."""
    from . import slideshow  # local import: slideshow imports this module

    url = slideshow.resolve_photo(url)
    if slideshow.is_photo_post(url):
        return slideshow.run_download(
            url=url,
            fmt=fmt,
            height=height,
            audio_bitrate=audio_bitrate,
            title=title,
            job_id=job_id,
            settings=settings,
            on_update=on_update,
            is_cancelled=is_cancelled,
        )
    out_dir = settings.download_dir
    started = time.monotonic()
    opts = _base_opts(settings) | {
        "outtmpl": str(out_dir / f"{job_id}.%(ext)s"),
        "windowsfilenames": True,
        "overwrites": True,
        "cachedir": False,
        "concurrent_fragment_downloads": 4,
    }
    if settings.max_filesize_mb:
        opts["max_filesize"] = settings.max_filesize_mb * 1024 * 1024
    if fmt == "audio":
        bitrate = audio_bitrate or settings.audio_bitrate_kbps
        opts |= {
            "format": "bestaudio/best",
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": str(bitrate),
                }
            ],
        }
        want_ext = ".mp3"
    else:
        opts |= {
            "format": video_selector(height, settings.prefer_compatible_codecs),
            "merge_output_format": "mp4",
        }
        want_ext = ".mp4"

    state = {"streams": 1, "index": 0, "last_file": None}

    def progress_hook(d: dict) -> None:
        if is_cancelled():
            raise DownloadCancelled("Cancelled")
        if (
            settings.download_timeout_seconds
            and time.monotonic() - started > settings.download_timeout_seconds
        ):
            raise ExtractionError("Download timed out")
        if d.get("status") != "downloading":
            return
        fname = d.get("filename")
        if state["last_file"] and fname != state["last_file"]:
            state["index"] += 1  # next stream (video -> audio)
        state["last_file"] = fname
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        frac = min(1.0, (d.get("downloaded_bytes") or 0) / total) if total else 0.0
        overall = (state["index"] + frac) / max(1, state["streams"])
        on_update(
            {
                "status": "downloading",
                "progress": round(min(overall, 1.0) * 94, 1),
                "speed": _fmt_speed(d.get("speed")),
                "eta": int(d["eta"]) if d.get("eta") is not None else None,
            }
        )

    def post_hook(d: dict) -> None:
        if d.get("status") == "started":
            on_update(
                {"status": "processing", "progress": 96.0, "speed": None, "eta": None}
            )

    opts["progress_hooks"] = [progress_hook]
    opts["postprocessor_hooks"] = [post_hook]

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            info = _first_entry(info)
            if info.get("is_live"):
                raise ExtractionError("Live streams are not supported")
            dur = info.get("duration")
            if (
                settings.max_duration_seconds
                and dur
                and dur > settings.max_duration_seconds
            ):
                raise ExtractionError(
                    f"Media is longer than {settings.max_duration_seconds // 3600}h limit"
                )
            req = info.get("requested_formats") or [info]
            state["streams"] = len(req)
            size = sum(
                (f.get("filesize") or f.get("filesize_approx") or 0) for f in req
            )
            if (
                settings.max_filesize_mb
                and size > settings.max_filesize_mb * 1024 * 1024
            ):
                raise ExtractionError(
                    f"File is larger than the {settings.max_filesize_mb} MB limit"
                )
            ydl.process_ie_result(copy.deepcopy(info), download=True)
    except (ExtractionError, DownloadCancelled):
        _remove_job_files(out_dir, job_id)
        raise
    except YoutubeDLError as exc:
        _remove_job_files(out_dir, job_id)
        if (
            isinstance(exc, DownloadError)
            and exc.exc_info
            and isinstance(exc.exc_info[1], DownloadCancelled)
        ):
            raise DownloadCancelled("Cancelled") from exc
        raise ExtractionError(clean_error(exc)) from exc
    except Exception:
        _remove_job_files(out_dir, job_id)
        raise

    files = [
        p for p in out_dir.glob(f"{job_id}.*") if p.suffix not in (".part", ".ytdl")
    ]
    if not files:
        raise ExtractionError("No file was produced (it may exceed the size limit)")
    chosen = next(
        (p for p in files if p.suffix == want_ext),
        max(files, key=lambda p: p.stat().st_size),
    )
    for p in out_dir.glob(f"{job_id}.*"):
        if p != chosen:
            p.unlink(missing_ok=True)
    return chosen, safe_filename(
        title or info.get("title") or "", job_id, chosen.suffix
    )


def _remove_job_files(out_dir: Path, job_id: str) -> None:
    for p in out_dir.glob(f"{job_id}.*"):
        p.unlink(missing_ok=True)
