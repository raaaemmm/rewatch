from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .routers import jobs as jobs_router
from .routers import media as media_router
from .schemas import ConfigResponse
from .services.extractor import youtube_prereq_problems
from .services.cleanup import cleanup_loop, wipe_orphans
from .services.jobs import JobManager, JobStore

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("rewatch")

CSP = (
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; "
    "font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.download_dir.mkdir(parents=True, exist_ok=True)
    store = JobStore()
    wipe_orphans(settings, set(), min_age=0)  # leftovers from a previous process
    if problems := youtube_prereq_problems(settings):
        log.warning(
            "YouTube will return only a few formats/qualities until this is fixed — missing: %s",
            "; ".join(problems),
        )
    manager = JobManager(settings, store)
    app.state.jobs = manager
    task = asyncio.create_task(cleanup_loop(store, settings))
    log.info(
        "Rewatch %s ready — workers=%d",
        __version__,
        settings.max_concurrent_downloads,
    )
    try:
        yield
    finally:
        task.cancel()
        manager.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Rewatch",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,  # no public API docs on a tunnel-exposed instance
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Content-Security-Policy", CSP)
        return response

    api = "/api/v1"
    app.include_router(media_router.router, prefix=api, tags=["media"])
    app.include_router(jobs_router.router, prefix=api, tags=["jobs"])

    @app.get(f"{api}/config", response_model=ConfigResponse, tags=["meta"])
    async def config():
        return ConfigResponse(
            version=__version__,
            max_urls_per_batch=settings.max_urls_per_batch,
            max_playlist_items=settings.max_playlist_items,
            file_ttl_seconds=settings.file_ttl_seconds,
        )

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return JSONResponse({"status": "ok"})

    @app.get("/", include_in_schema=False)
    async def index():
        return FileResponse(
            settings.static_dir / "index.html", headers={"Cache-Control": "no-cache"}
        )

    app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
    return app


app = create_app()
