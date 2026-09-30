from app.services import slideshow as sl


def test_photo_url_detection_ignores_query():
    assert sl.is_photo_post(
        "https://www.tiktok.com/@a.b/photo/765?is_from_webapp=1&x=2"
    )
    assert not sl.is_photo_post("https://www.tiktok.com/@a.b/video/765")
    assert not sl.is_photo_post("https://example.com/@a/photo/1")


def test_split_media_separates_audio_and_blocks_foreign_hosts():
    lines = [
        "https://p16-common-sign.tiktokcdn.com/a~tplv-photomode-image.jpeg?x=1",
        "https://v58.tiktokcdn.com/video/tos/alisg/x/?mime_type=audio_mpeg",
        "https://evil.example.com/b.jpeg",
        "http://p16-common-sign.tiktokcdn.com/insecure.jpeg",
        "| ytdl:something",
    ]
    images, audio = sl.split_media(lines)
    assert images == [lines[0]]
    assert audio == lines[1]


def test_video_cmd_has_one_input_per_image_plus_looped_audio(tmp_path):
    from pathlib import Path

    imgs = [Path(f"i{i}.jpg") for i in range(3)]
    cmd = sl._video_cmd("ffmpeg", imgs, Path("a.bin"), 720, Path("o.mp4"))
    assert cmd.count("-i") == 4 and "-stream_loop" in cmd and "-shortest" in cmd
    assert "concat=n=3" in cmd[cmd.index("-filter_complex") + 1]


def test_image_index_and_extension():
    assert sl.image_index("https://www.tiktok.com/@a/photo/1#image=3") == 3
    assert sl.image_index("https://www.tiktok.com/@a/photo/1") is None
    assert (
        sl._image_ext("https://x.tiktokcdn.com/a~tplv-photomode-image.jpeg?x=1")
        == ".jpg"
    )
    assert sl._image_ext("https://x.tiktokcdn.com/a.webp?x=1") == ".webp"
    assert sl._image_ext("https://x.tiktokcdn.com/a?x=1") == ".jpg"


def test_photo_entries_lists_every_photo(monkeypatch):
    from app.config import Settings

    imgs = [f"https://p16.tiktokcdn.com/{i}.jpeg" for i in range(3)]
    monkeypatch.setattr(sl, "list_media", lambda u, s: (imgs, None))
    res = sl.photo_entries(
        "https://www.tiktok.com/@u.v/photo/99?is_from_webapp=1", Settings()
    )
    assert res.urls == [
        f"https://www.tiktok.com/@u.v/photo/99#image={i}" for i in (1, 2, 3)
    ]
    assert res.photos[1].title == "@u.v photo 2 of 3"
    assert res.photos[1].thumbnail == imgs[1]


def test_single_photo_download_keeps_original_image(monkeypatch, tmp_path):
    from app.config import Settings

    imgs = ["https://p16.tiktokcdn.com/a.jpeg", "https://p16.tiktokcdn.com/b.jpeg"]
    monkeypatch.setattr(
        sl, "list_media", lambda u, s: (imgs, "https://v.tiktokcdn.com/video/tos/x")
    )
    fetched = []

    def fake_dl(url, dest, limit, check):
        fetched.append(url)
        dest.write_bytes(b"jpegdata")

    monkeypatch.setattr(sl, "_download", fake_dl)
    settings = Settings(download_dir=tmp_path)
    path, name = sl.run_download(
        url="https://www.tiktok.com/@u/photo/9#image=2",
        fmt="video",
        height=None,
        audio_bitrate=None,
        title="@u photo 2 of 2",
        job_id="a" * 32,
        settings=settings,
        on_update=lambda d: None,
        is_cancelled=lambda: False,
    )
    assert (
        fetched == [imgs[1]] and path.suffix == ".jpg" and name == "@u photo 2 of 2.jpg"
    )


def test_app_share_links_resolve_to_photo_posts(monkeypatch):
    sl._resolved.clear()
    real = "https://www.tiktok.com/@u/photo/123?_r=1"
    monkeypatch.setattr(sl, "_follow", lambda u: real)
    short = "https://vm.tiktok.com/ZSabc123/"
    assert sl.resolve_photo(short) == real
    # a short link to a normal video is left for yt-dlp
    sl._resolved.clear()
    monkeypatch.setattr(sl, "_follow", lambda u: "https://www.tiktok.com/@u/video/5")
    assert (
        sl.resolve_photo("https://vt.tiktok.com/ZSxyz/")
        == "https://vt.tiktok.com/ZSxyz/"
    )
    # unrelated hosts never trigger a request
    monkeypatch.setattr(sl, "_follow", lambda u: (_ for _ in ()).throw(AssertionError))
    assert sl.resolve_photo("https://example.com/t/abc") == "https://example.com/t/abc"
