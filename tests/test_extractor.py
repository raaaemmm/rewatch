from app.services.extractor import video_selector


def test_video_selector():
    sel = video_selector(720, True)
    assert sel.startswith("bv*[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]/")
    assert sel.endswith("/b")
    assert "avc1" not in video_selector(720, False)
    assert "height" not in video_selector(None, True)


def test_info_keeps_formats_with_unknown_codec(monkeypatch):
    """Formats whose vcodec is None (unknown) are kept; audio-only ('none') is dropped."""
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
                    {"format_id": "22", "height": 720, "vcodec": None, "tbr": 900},
                    {"format_id": "137", "height": 1080, "vcodec": "avc1.640028", "tbr": 4000},
                    {"format_id": "248", "height": 1080, "vcodec": "vp09.00", "tbr": 5000},
                ],
            }

    monkeypatch.setattr(extractor, "YoutubeDL", FakeYDL)
    info = extractor.fetch_info("https://x.com/v", Settings())
    assert [(f.height, f.codec) for f in info.formats] == [
        (1080, "h264"),  # H.264 wins the tie despite the lower bitrate
        (720, ""),
    ]


def test_youtube_prereq_check(monkeypatch):
    from app.services import extractor

    monkeypatch.setattr(extractor.importlib.util, "find_spec", lambda n: None)
    monkeypatch.setattr(extractor.shutil, "which", lambda n: None)
    monkeypatch.setattr(extractor, "_extra_bin_dirs", lambda: [])
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
    from yt_dlp import YoutubeDL

    from app.config import Settings
    from app.services import extractor

    monkeypatch.setattr(extractor, "js_runtimes", lambda s=None: {"deno": {"path": "/x/deno"}})
    opts = extractor._base_opts(Settings())
    assert opts["js_runtimes"] == {"deno": {"path": "/x/deno"}}
    YoutubeDL(opts).close()  # yt-dlp accepts the options without raising
