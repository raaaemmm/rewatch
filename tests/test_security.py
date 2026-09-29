import socket

import pytest

from app.config import Settings
from app.security import SlidingWindowLimiter, UnsafeURL, safe_filename, sign_job, validate_url, verify_job_token

S = Settings(download_dir="/tmp/x")


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    def fake(host, port, **kw):
        table = {"localhost": "127.0.0.1", "internal.example": "10.0.0.5", "meta.example": "169.254.169.254",
                 "v6.example": "::ffff:127.0.0.1"}
        ip = None
        for fam in (socket.AF_INET, socket.AF_INET6):   # literal IPs resolve to themselves
            try:
                socket.inet_pton(fam, host)
                ip = host
                break
            except OSError:
                pass
        if ip is None:
            ip = table.get(host, "93.184.216.34")
        fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(fam, socket.SOCK_STREAM, 6, "", (ip, port))]
    monkeypatch.setattr(socket, "getaddrinfo", fake)


@pytest.mark.parametrize("bad", [
    "--exec=touch /tmp/pwned", "-o /etc/passwd", "file:///etc/passwd", "ftp://example.com/x",
    "javascript:alert(1)", "http://127.0.0.1/", "http://localhost:8080/", "http://internal.example/",
    "http://meta.example/latest/meta-data", "http://v6.example/", "http://[::1]/", "http://user:pw@example.com/",
    "http://exa mple.com", "", "https://", "http://10.1.2.3/", "http://192.168.0.1/", "http://100.64.0.1/",
])
def test_rejects_unsafe(bad):
    with pytest.raises(UnsafeURL):
        validate_url(bad, S)


def test_accepts_public():
    assert validate_url("  https://example.com/watch?v=abc  ", S) == "https://example.com/watch?v=abc"


def test_allowlist():
    s = Settings(download_dir="/tmp/x", allowed_hosts=["youtube.com"])
    assert validate_url("https://www.youtube.com/watch?v=1", s)
    with pytest.raises(UnsafeURL):
        validate_url("https://evil.com/?youtube.com", s)


def test_tokens():
    tok = sign_job("abc", S)
    assert verify_job_token("abc", tok, S)
    assert not verify_job_token("abd", tok, S)
    assert not verify_job_token("abc", "", S)


def test_rate_limiter():
    lim = SlidingWindowLimiter(window=60)
    assert all(lim.allow("ip", 3)[0] for _ in range(3))
    ok, retry = lim.allow("ip", 3)
    assert not ok and retry >= 1
    assert lim.allow("other", 3)[0]


def test_filename_sanitising():
    assert safe_filename('a/b:c*"d', "fb", ".mp4") == "abcd.mp4"
    assert safe_filename("", "fb", ".mp3") == "fb.mp3"
    assert safe_filename("../../etc/passwd", "fb", ".mp4") == "etcpasswd.mp4"   # no traversal chars survive


def test_empty_secret_key_falls_back_to_random(monkeypatch):
    monkeypatch.setenv("REWATCH_SECRET_KEY", "")
    a, b = Settings(download_dir="/tmp/x"), Settings(download_dir="/tmp/x")
    assert len(a.secret_key) == 64 and a.secret_key != b.secret_key  # never an empty HMAC key
