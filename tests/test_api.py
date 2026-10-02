import time

import pytest


def wait_done(client, job_id, token, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"/api/v1/jobs/{job_id}", params={"token": token})
        assert r.status_code == 200
        if r.json()["status"] in ("done", "error", "cancelled"):
            return r.json()
        time.sleep(0.3)
    raise AssertionError("job did not finish")


def test_basics(make_client):
    with make_client() as c:
        assert c.get("/healthz").json() == {"status": "ok"}
        assert c.get("/").status_code == 200
        cfg = c.get("/api/v1/config").json()
        assert cfg["max_urls_per_batch"] > 0 and "auth_required" not in cfg
        assert "content-security-policy" in c.get("/").headers
        assert c.get("/docs").status_code == 404
        assert c.get("/openapi.json").status_code == 404


def test_no_inline_style_attributes():
    """The CSP has style-src 'self' (no inline attributes), so the UI must not emit any."""
    from pathlib import Path

    static = Path(__file__).resolve().parent.parent / "static"
    for f in (static / "index.html", static / "js" / "app.js"):
        assert 'style="' not in f.read_text(encoding="utf-8"), f.name


def test_rejects_option_injection_and_private(make_client):
    with make_client() as c:
        for bad in ("--exec=id", "http://127.0.0.1/", "http://169.254.169.254/latest"):
            assert c.post("/api/v1/info", json={"url": bad}).status_code == 400
            assert c.post("/api/v1/jobs", json={"url": bad}).status_code == 400
        assert c.post("/api/v1/jobs", json={"url": "http://x.com", "format": "flac"}).status_code == 422


def test_rate_limit(make_client):
    from app.security import limiter

    limiter._hits.clear()  # module-level limiter: don't inherit hits from other tests
    with make_client(rate_limit_per_minute=3) as c:
        codes = [c.post("/api/v1/info", json={"url": "--x"}).status_code for _ in range(5)]
        assert codes[:3] == [400] * 3 and codes[3:] == [429, 429]


def test_job_endpoints_need_token(make_client):
    with make_client() as c:
        assert c.get("/api/v1/jobs/deadbeef").status_code == 404
        assert c.get("/api/v1/jobs/deadbeef/file?token=zzz").status_code == 404


def test_info_video_and_audio_download(make_client, media_server):
    with make_client(allow_private_urls="true") as c:
        url = f"{media_server}/clip.mp4"
        info = c.post("/api/v1/info", json={"url": url}).json()
        assert info["title"]

        # ---- video
        r = c.post("/api/v1/jobs", json={"url": url, "format": "video", "title": "My: clip/1"})
        assert r.status_code == 202
        job_id, token = r.json()["job_id"], r.json()["token"]
        final = wait_done(c, job_id, token)
        assert final["status"] == "done", final
        assert final["progress"] == 100 and final["filename"] == "My clip1.mp4"
        assert "file" not in final and "path" not in str(final)     # no server paths leaked
        f = c.get(f"/api/v1/jobs/{job_id}/file", params={"token": token})
        assert f.status_code == 200 and f.content[4:8] == b"ftyp"
        assert "attachment" in f.headers["content-disposition"]
        assert c.get(f"/api/v1/jobs/{job_id}/file", params={"token": "bad"}).status_code == 404

        # ---- SSE stream on an already-finished job emits the terminal state and closes
        with c.stream("GET", f"/api/v1/jobs/{job_id}/events", params={"token": token}) as s:
            body = "".join(s.iter_text())
        assert '"status":"done"' in body

        # ---- audio -> mp3
        r = c.post("/api/v1/jobs", json={"url": url, "format": "audio", "title": "Song"})
        j2, t2 = r.json()["job_id"], r.json()["token"]
        final = wait_done(c, j2, t2)
        assert final["status"] == "done", final
        assert final["filename"] == "Song.mp3"
        assert c.get(f"/api/v1/jobs/{j2}/file", params={"token": t2}).content[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")


def test_cleanup_expires_files(make_client, media_server):
    from app.services.cleanup import sweep
    with make_client(allow_private_urls="true", file_ttl_seconds=1) as c:
        r = c.post("/api/v1/jobs", json={"url": f"{media_server}/clip.mp4"}).json()
        wait_done(c, r["job_id"], r["token"])
        mgr = c.app.state.jobs
        files = list(mgr.settings.download_dir.iterdir())
        assert files
        time.sleep(1.5)
        sweep(mgr.store, mgr.settings)
        assert not list(mgr.settings.download_dir.iterdir())
        assert c.get(f"/api/v1/jobs/{r['job_id']}", params={"token": r["token"]}).status_code == 404


def test_queue_full(make_client, media_server):
    with make_client(allow_private_urls="true", max_queued_jobs=0) as c:
        r = c.post("/api/v1/jobs", json={"url": f"{media_server}/clip.mp4"})
        assert r.status_code == 429 and "retry-after" in r.headers


def test_duration_limit_noop_without_metadata(make_client, media_server):
    # yt-dlp's *generic* extractor (used for a bare file URL, as in these tests) never
    # reports duration/filesize, so the pre-download duration check can't fire here — real
    # sites (YouTube, TikTok, ...) do report it. Filesize is still enforced live, below.
    with make_client(allow_private_urls="true", max_duration_seconds=1) as c:
        r = c.post("/api/v1/jobs", json={"url": f"{media_server}/clip.mp4"}).json()
        assert wait_done(c, r["job_id"], r["token"])["status"] == "done"


def test_filesize_limit_enforced_during_stream(make_client, media_server):
    # yt-dlp checks max_filesize against the actual byte stream as it downloads, so this
    # catches oversized files even when (as above) no size was known in advance.
    with make_client(allow_private_urls="true", max_filesize_mb=0.001) as c:
        r = c.post("/api/v1/jobs", json={"url": f"{media_server}/clip.mp4"}).json()
        final = wait_done(c, r["job_id"], r["token"])
        assert final["status"] == "error", final
        assert not list(c.app.state.jobs.settings.download_dir.iterdir())


def test_cancel_queued_job(make_client, media_server):
    with make_client(allow_private_urls="true", max_concurrent_downloads=1) as c:
        url = f"{media_server}/clip.mp4"
        first = c.post("/api/v1/jobs", json={"url": url}).json()
        second = c.post("/api/v1/jobs", json={"url": url}).json()
        assert c.delete(f"/api/v1/jobs/{second['job_id']}", params={"token": second["token"]}).status_code == 204
        wait_done(c, first["job_id"], first["token"])
        assert wait_done(c, second["job_id"], second["token"])["status"] in ("cancelled", "done")
