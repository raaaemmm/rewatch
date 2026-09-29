import functools
import http.server
import shutil
import subprocess
import threading

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    def _make(**env):
        monkeypatch.setenv("REWATCH_DOWNLOAD_DIR", str(tmp_path / "dl"))
        monkeypatch.setenv("REWATCH_RATE_LIMIT_PER_MINUTE", "0")
        for k, v in env.items():
            monkeypatch.setenv(f"REWATCH_{k.upper()}", str(v))
        get_settings.cache_clear()
        from app.main import create_app
        return TestClient(create_app())
    yield _make
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def media_server(tmp_path_factory):
    """Serve a tiny generated MP4 over HTTP on localhost."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    root = tmp_path_factory.mktemp("media")
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac",
         "-shortest", str(root / "clip.mp4")], check=True)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
