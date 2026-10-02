"""Site detection: logo + name for the link a visitor pastes."""
import re
from pathlib import Path

import pytest

from app.services import platforms

STATIC = Path(__file__).resolve().parent.parent / "static"


@pytest.mark.parametrize(
    "url, key, name",
    [
        ("https://www.youtube.com/watch?v=abc", "youtube", "YouTube"),
        ("https://youtu.be/abc", "youtube", "YouTube"),
        ("https://m.youtube.com/shorts/abc", "youtube", "YouTube"),
        ("https://www.facebook.com/reel/123", "facebook", "Facebook"),
        ("https://fb.watch/xyz/", "facebook", "Facebook"),
        ("https://vt.tiktok.com/ZSabc/", "tiktok", "TikTok"),
        ("https://www.tiktok.com/@u/photo/9", "tiktok", "TikTok"),
        ("https://x.com/u/status/1", "x", "X (Twitter)"),
        ("https://twitter.com/u/status/1", "x", "X (Twitter)"),
        ("https://www.instagram.com/reel/abc/", "instagram", "Instagram"),
        ("https://v.redd.it/abc", "reddit", "Reddit"),
        ("https://clips.twitch.tv/abc", "twitch", "Twitch"),
        ("https://www.linkedin.com/posts/x", "linkedin", "LinkedIn"),
    ],
)
def test_detects_by_host(url, key, name):
    p = platforms.detect(url)
    assert (p.key, p.name) == (key, name)


def test_lookalike_hosts_do_not_match():
    for url in ("https://notyoutube.com/x", "https://youtube.com.evil.example/x", "https://evil.example/?u=youtube.com"):
        assert platforms.detect(url).key == "other", url


def test_unknown_site_uses_its_domain_or_extractor_name():
    p = platforms.detect("https://www.example-videos.org/v/1")
    assert (p.key, p.name, p.icon) == ("other", "example-videos.org", "")
    # a site yt-dlp knows but we don't list: its own display name
    p = platforms.detect("https://peertube.example/w/1", extractor_key="PeerTube", extractor="PeerTube")
    assert (p.key, p.name) == ("other", "PeerTube")
    # a custom domain served by a known extractor is still recognised
    assert platforms.detect("https://video.mycompany.example/v", extractor_key="VimeoOnDemand").key == "vimeo"
    assert platforms.detect("") is None


def test_every_platform_icon_exists_and_is_safe():
    keys = set()
    for p in platforms.PLATFORMS:
        assert p.key not in keys and re.fullmatch(r"#[0-9A-Fa-f]{6}", p.color), p.key
        keys.add(p.key)
        icon = STATIC / "platforms" / f"{p.key}.svg"
        assert icon.is_file() == p.icon, p.key
        if p.icon:
            svg = icon.read_text(encoding="utf-8")
            assert svg.startswith("<svg") and "<script" not in svg and "style" not in svg, p.key
    # no orphan logo files either
    on_disk = {f.stem for f in (STATIC / "platforms").glob("*.svg")}
    assert on_disk == {p.key for p in platforms.PLATFORMS if p.icon}


def test_config_lists_platforms_with_hosts(make_client):
    with make_client() as c:
        cfg = c.get("/api/v1/config").json()
        yt = next(p for p in cfg["platforms"] if p["key"] == "youtube")
        assert "youtu.be" in yt["hosts"] and yt["icon"] == "/static/platforms/youtube.svg"
        assert c.get(yt["icon"]).status_code == 200


def test_info_reports_platform(monkeypatch):
    from app.config import Settings
    from app.services import extractor

    class FakeYDL:
        def __init__(self, opts): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def sanitize_info(self, i): return i
        def extract_info(self, url, download=False):
            return {"title": "t", "formats": [], "extractor_key": "FacebookReel", "extractor": "facebook:reel",
                    "webpage_url": "https://www.facebook.com/reel/1"}

    monkeypatch.setattr(extractor, "YoutubeDL", FakeYDL)
    info = extractor.fetch_info("https://fb.watch/abc/", Settings())
    assert (info.platform.key, info.platform.name) == ("facebook", "Facebook")


def test_slideshow_info_reports_tiktok(monkeypatch):
    from app.config import Settings
    from app.services import slideshow as sl

    monkeypatch.setattr(sl, "list_media", lambda u, s: (["https://p16.tiktokcdn.com/a.jpeg"], None))
    info = sl.fetch_info("https://www.tiktok.com/@u/photo/9", Settings())
    assert info.platform.key == "tiktok"


def test_page_has_site_row_and_helpers():
    index = (STATIC / "index.html").read_text(encoding="utf-8")
    app = (STATIC / "js" / "app.js").read_text(encoding="utf-8")
    assert 'id="sites"' in index
    assert "detectPlatform" in app and "platformBadge" in app
    # attribute values must be quote-safe: esc() is used inside "..." attributes
    assert '&quot;' in app
