import pytest

from app.schemas import JobRequest
from app.services.extractor import video_selector

from .test_api import wait_done


def test_legacy_paths_exist_and_validate(make_client):
    with make_client() as c:
        for path in ("/api/info", "/api/playlist", "/api/download"):
            assert c.post(path, json={"url": "--exec=id"}).status_code == 400, path
            assert (
                c.post(path, json={"url": "http://127.0.0.1/"}).status_code == 400
            ), path
        assert c.get("/api/status/deadbeef").status_code == 404
        assert c.get("/api/file/deadbeef").status_code == 404


def test_legacy_inherits_api_key(make_client):
    with make_client(api_key="s3cret") as c:
        for path in ("/api/info", "/api/playlist", "/api/download"):
            assert c.post(path, json={"url": "https://a.com"}).status_code == 401, path
        ok = c.post(
            "/api/download", json={"url": "--x"}, headers={"X-API-Key": "s3cret"}
        )
        assert ok.status_code == 400  # passed auth, failed validation


def test_legacy_inherits_rate_limit(make_client):
    from app.security import limiter

    limiter._hits.clear()  # module-level limiter: don't inherit hits from other tests
    with make_client(rate_limit_per_minute=2) as c:
        codes = [
            c.post("/api/download", json={"url": "--x"}).status_code for _ in range(4)
        ]
        assert codes == [400, 400, 429, 429]  # /download can't bypass the limiter


def test_legacy_can_be_disabled(make_client):
    with make_client(legacy_api="false") as c:
        assert c.post("/api/info", json={"url": "https://a.com"}).status_code == 404
        assert (
            c.post("/api/v1/info", json={"url": "--x"}).status_code == 400
        )  # v1 unaffected


@pytest.mark.parametrize(
    "bad", ["18+bestaudio", "a/b", "b[height<=1]", "x y", "", "a" * 65, "-f;id"]
)
def test_format_id_cannot_carry_selector_syntax(bad):
    with pytest.raises(ValueError):
        JobRequest(url="https://a.com", format_id=bad)


def test_format_id_selector():
    assert JobRequest(url="https://a.com", format_id="137-1").format_id == "137-1"
    sel = video_selector(720, True, "137")
    assert sel.startswith("137+ba[acodec^=mp4a]/") and sel.endswith("/b")
    assert "height" not in sel  # format_id wins over height
    assert video_selector(720, True) == video_selector(
        720, True, None
    )  # height path untouched


def test_legacy_end_to_end(make_client, media_server):
    with make_client(allow_private_urls="true") as c:
        url = f"{media_server}/clip.mp4"
        info = c.post("/api/info", json={"url": url}).json()
        assert {"title", "thumbnail", "duration", "uploader", "formats"} <= info.keys()
        for f in info["formats"]:
            assert f["id"]  # Reclip's formats[].id

        r = c.post(
            "/api/download", json={"url": url, "format": "video", "title": "Legacy"}
        )
        assert r.status_code == 200
        job_id, token = r.json()["job_id"], r.json()["token"]

        # status: token accepted via query or header; status folded to Reclip's vocabulary
        wait_done(c, job_id, token)
        s = c.get(f"/api/status/{job_id}", params={"token": token}).json()
        assert (
            s["status"] == "done"
            and s["filename"] == "Legacy.mp4"
            and s["error"] is None
        )
        assert (
            c.get(f"/api/status/{job_id}", headers={"X-Job-Token": token}).status_code
            == 200
        )

        # secure by default: no token -> 404, same as v1
        assert c.get(f"/api/status/{job_id}").status_code == 404
        assert c.get(f"/api/file/{job_id}").status_code == 404

        f = c.get(f"/api/file/{job_id}", params={"token": token})
        assert f.status_code == 200 and f.content[4:8] == b"ftyp"
        assert "attachment" in f.headers["content-disposition"]


def test_legacy_tokenless_mode(make_client, media_server):
    with make_client(allow_private_urls="true", legacy_require_token="false") as c:
        r = c.post("/api/download", json={"url": f"{media_server}/clip.mp4"}).json()
        wait_done(c, r["job_id"], r["token"])
        assert c.get(f"/api/status/{r['job_id']}").json()["status"] == "done"
        assert c.get(f"/api/file/{r['job_id']}").status_code == 200
        # ...but v1 still insists on the token
        assert c.get(f"/api/v1/jobs/{r['job_id']}").status_code == 404
        # and an unknown id is still a 404
        assert c.get("/api/status/deadbeef").status_code == 404


def test_legacy_status_mapping(make_client, media_server):
    with make_client(allow_private_urls="true", max_concurrent_downloads=1) as c:
        url = f"{media_server}/clip.mp4"
        c.post("/api/download", json={"url": url})
        second = c.post("/api/download", json={"url": url}).json()
        c.delete(f"/api/v1/jobs/{second['job_id']}", params={"token": second["token"]})
        final = wait_done(c, second["job_id"], second["token"])
        s = c.get(
            f"/api/status/{second['job_id']}", params={"token": second["token"]}
        ).json()
        if final["status"] == "cancelled":
            assert s["status"] == "error" and s["error"] == "Cancelled"
        else:
            assert s["status"] == "done"


def test_info_keeps_formats_with_unknown_codec(monkeypatch):
    """Reclip keeps formats whose vcodec is None (unknown); audio-only ('none') is dropped."""
    from app.config import Settings
    from app.services import extractor

    class FakeYDL:
        def __init__(self, opts): ...
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def sanitize_info(self, i):
            return i

        def extract_info(self, url, download=False):
            return {
                "title": "t",
                "formats": [
                    {"format_id": "a", "height": None, "vcodec": "none"},  # audio-only
                    {
                        "format_id": "22",
                        "height": 720,
                        "vcodec": None,
                        "tbr": 900,
                    },  # unknown codec
                    {
                        "format_id": "137",
                        "height": 1080,
                        "vcodec": "avc1.640028",
                        "tbr": 4000,
                    },
                    {
                        "format_id": "248",
                        "height": 1080,
                        "vcodec": "vp09.00",
                        "tbr": 5000,
                    },
                ],
            }

    monkeypatch.setattr(extractor, "YoutubeDL", FakeYDL)
    info = extractor.fetch_info("https://x.com/v", Settings())
    assert [(f.height, f.id) for f in info.formats] == [
        (1080, "137"),
        (720, "22"),
    ]  # H.264 wins ties


def test_legacy_errors_use_reclip_shape(make_client):
    with make_client() as c:
        r = c.post("/api/info", json={"url": "--x"})
        assert r.status_code == 400 and r.json()["error"]
        r = c.post("/api/download", json={})
        assert r.status_code == 400 and r.json()["error"] == "No URL provided"
        r = c.get("/api/status/deadbeef")
        assert r.status_code == 404 and r.json()["error"] == "Job not found"
        # /api/v1 keeps FastAPI's shape
        r = c.post("/api/v1/info", json={"url": "--x"})
        assert "detail" in r.json() and "error" not in r.json()
        assert c.post("/api/v1/jobs", json={}).status_code == 422


def test_youtube_prereq_check(monkeypatch):
    from app.services import extractor

    monkeypatch.setattr(extractor.importlib.util, "find_spec", lambda n: None)
    monkeypatch.setattr(extractor.shutil, "which", lambda n: None)
    problems = extractor.youtube_prereq_problems()
    assert len(problems) == 2 and "yt-dlp[default]" in problems[0]
    monkeypatch.setattr(extractor.importlib.util, "find_spec", lambda n: object())
    monkeypatch.setattr(extractor.shutil, "which", lambda n: "/usr/bin/deno")
    assert extractor.youtube_prereq_problems() == []


def test_js_runtime_found_outside_path(monkeypatch, tmp_path):
    """A runtime that's installed but not on PATH (fresh winget install) is still used."""
    from app.services import extractor

    exe = tmp_path / ("deno.exe" if extractor.os.name == "nt" else "deno")
    exe.write_text("")
    monkeypatch.setattr(extractor.shutil, "which", lambda n: None)
    monkeypatch.setattr(extractor, "_extra_bin_dirs", lambda: [tmp_path])
    rt = extractor.js_runtimes()
    assert rt["deno"]["path"] == str(exe)
    monkeypatch.setattr(extractor.importlib.util, "find_spec", lambda n: object())
    assert extractor.youtube_prereq_problems() == []


def test_no_runtime_reports_problem_and_warns(monkeypatch):
    from app.config import Settings
    from app.services import extractor

    monkeypatch.setattr(extractor.shutil, "which", lambda n: None)
    monkeypatch.setattr(extractor, "_extra_bin_dirs", lambda: [])
    assert extractor.js_runtimes() == {}
    assert any("deno" in p for p in extractor.youtube_prereq_problems())
    assert "js_runtimes" not in extractor._base_opts(Settings())


def test_base_opts_pass_runtime_to_ytdlp(monkeypatch):
    from app.config import Settings
    from app.services import extractor
    from yt_dlp import YoutubeDL

    monkeypatch.setattr(
        extractor, "js_runtimes", lambda s=None: {"deno": {"path": "/x/deno"}}
    )
    opts = extractor._base_opts(Settings())
    assert opts["js_runtimes"] == {"deno": {"path": "/x/deno"}}
    YoutubeDL(opts).close()  # yt-dlp accepts the options without raising
