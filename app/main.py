from __future__ import annotations

import asyncio
import html
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .routers import jobs as jobs_router
from .routers import media as media_router
from .schemas import ConfigResponse
from .services import platforms
from .services.cleanup import cleanup_loop, wipe_orphans
from .services.extractor import youtube_prereq_problems
from .services.jobs import JobManager, JobStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("rewatch")

CSP = (
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; "
    "font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


_HOST_OK = re.compile(r"^[A-Za-z0-9.\-:\[\]]+$")


def public_base_url(request: Request, settings) -> str:
    """Absolute address of this site, for canonical/share-preview tags and the sitemap."""
    if settings.public_url:
        return settings.public_url.rstrip("/")
    proto = request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    if settings.trust_proxy_headers:
        proto = request.headers.get("x-forwarded-proto", proto).split(",")[0].strip()
        host = request.headers.get("x-forwarded-host", host).split(",")[0].strip()
    if proto not in ("http", "https") or not _HOST_OK.match(host):
        return ""  # never reflect something odd into the page
    return f"{proto}://{host}"


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
            platforms=platforms.catalog(),
        )

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return JSONResponse({"status": "ok"})

    @app.get("/", include_in_schema=False)
    async def index(request: Request):
        # The page carries %%BASE_URL%% placeholders (canonical link, share previews);
        # fill them in so crawlers and chat apps get absolute addresses.
        page = (settings.static_dir / "index.html").read_text(encoding="utf-8")
        base = html.escape(public_base_url(request, settings), quote=True)
        return HTMLResponse(
            page.replace("%%BASE_URL%%", base), headers={"Cache-Control": "no-cache"}
        )

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        return FileResponse(
            settings.static_dir / "icons" / "favicon.ico",
            media_type="image/x-icon",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.get("/robots.txt", include_in_schema=False)
    async def robots(request: Request):
        base = public_base_url(request, settings)
        lines = ["User-agent: *", "Allow: /", "Disallow: /api/"]
        if base:
            lines.append(f"Sitemap: {base}/sitemap.xml")
        return PlainTextResponse("\n".join(lines) + "\n")

    @app.get("/sitemap.xml", include_in_schema=False)
    async def sitemap(request: Request):
        base = html.escape(public_base_url(request, settings), quote=True)
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"  <url><loc>{base}/</loc></url>\n"
            "</urlset>\n"
        )
        return Response(xml, media_type="application/xml")

    app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
    return app


app = create_app()
