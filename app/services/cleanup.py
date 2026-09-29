"""Periodic expiry of finished jobs and their files (fixes: unbounded disk/memory growth)."""

from __future__ import annotations

import asyncio
import logging
import re
import time

from ..config import Settings
from .jobs import JobStore

log = logging.getLogger("rewatch.cleanup")

# only ever touch files that look like ours: <32-hex job id>.<anything>
_OURS = re.compile(r"^[0-9a-f]{32}\.")


def wipe_orphans(settings: Settings, known_ids: set[str], min_age: float) -> int:
    removed = 0
    now = time.time()
    for p in settings.download_dir.iterdir():
        if not p.is_file() or not _OURS.match(p.name):
            continue
        if p.name.split(".")[0] in known_ids:
            continue
        if now - p.stat().st_mtime >= min_age:
            p.unlink(missing_ok=True)
            removed += 1
    return removed


def sweep(store: JobStore, settings: Settings) -> None:
    now = time.time()
    ttl = settings.file_ttl_seconds
    stuck_after = max(settings.download_timeout_seconds * 2, 3600)
    known: set[str] = set()
    for job in store.all():
        jid = job["id"]
        finished = job.get("finished_at")
        expired = finished and now - finished > ttl
        stuck = not finished and now - job.get("created_at", now) > stuck_after
        if expired or stuck:
            f = job.get("file")
            if f and _OURS.match(f):
                (settings.download_dir / f).unlink(missing_ok=True)
            store.delete(jid)
        else:
            known.add(jid)
    wipe_orphans(settings, known, min_age=300)


async def cleanup_loop(store: JobStore, settings: Settings) -> None:
    while True:
        await asyncio.sleep(settings.cleanup_interval_seconds)
        try:
            await asyncio.to_thread(sweep, store, settings)
        except Exception:  # noqa: BLE001
            log.exception("cleanup sweep failed")
