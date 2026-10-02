def test_index_has_absolute_share_tags(make_client):
    with make_client() as c:
        page = c.get("/", headers={"host": "rewatch.example.com"}).text
        assert "%%BASE_URL%%" not in page
        assert (
            'property="og:image" content="http://rewatch.example.com/static/icons/og-image.png"'
            in page
        )
        assert 'rel="canonical" href="http://rewatch.example.com/"' in page


def test_public_url_wins(make_client):
    with make_client(public_url="https://get.example.org/") as c:
        page = c.get("/", headers={"host": "evil.test"}).text
        assert "https://get.example.org/static/icons/og-image.png" in page
        assert "evil.test" not in page


def test_odd_host_is_not_reflected(make_client):
    with make_client() as c:
        page = c.get("/", headers={"host": 'a"><script>x</script>'}).text
        assert "<script>x" not in page


def test_robots_sitemap_and_icons(make_client):
    with make_client(public_url="https://get.example.org") as c:
        robots = c.get("/robots.txt").text
        assert (
            "Disallow: /api/" in robots and "Sitemap: https://get.example.org/sitemap.xml" in robots
        )
        assert "<loc>https://get.example.org/</loc>" in c.get("/sitemap.xml").text
        assert c.get("/favicon.ico").status_code == 200
        for path in (
            "og-image.png",
            "apple-touch-icon.png",
            "icon-192.png",
            "icon-512.png",
            "icon-maskable-512.png",
        ):
            assert c.get(f"/static/icons/{path}").status_code == 200, path
        assert c.get("/static/site.webmanifest").status_code == 200
