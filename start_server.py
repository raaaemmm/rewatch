#!/usr/bin/env python3
"""Start Rewatch without Docker.

    python start_server.py                  # http://127.0.0.1:8000 (this machine only)
    python start_server.py --port 9000
    python start_server.py --reload         # auto-restart on code changes (dev)
    python start_server.py --tunnel         # also start a Cloudflare quick tunnel

Settings still come from REWATCH_* environment variables or a .env file
(see .env.example and app/config.py).
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def secret_key_configured() -> bool:
    if os.environ.get("REWATCH_SECRET_KEY", "").strip():
        return True
    env_file = ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "REWATCH_SECRET_KEY" and value.strip().strip("\"'") not in (
                "",
                "change-me",
            ):
                return True
    return False


def lan_ip() -> str | None:
    """Best-effort LAN address (no packets are sent; UDP connect just picks a route)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def port_in_use(host: str, port: int) -> bool:
    probe = "127.0.0.1" if host in ("0.0.0.0", "") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((probe, port)) == 0


def preflight() -> None:
    try:
        import uvicorn  # noqa: F401
        import yt_dlp  # noqa: F401
    except ImportError as exc:
        sys.exit(f"Missing dependency ({exc.name}). Run: pip install -r requirements.txt")

    if not shutil.which("ffmpeg"):
        sys.exit(
            "ffmpeg was not found on PATH (needed for merging video/audio and MP3).\n"
            "Install it, e.g. `winget install Gyan.FFmpeg` (Windows) or `brew install ffmpeg` (macOS)."
        )

    from app.config import get_settings
    from app.services.extractor import youtube_prereq_problems

    if problems := youtube_prereq_problems(get_settings()):
        print(
            "WARNING: YouTube will only return a few low-resolution formats until this is fixed:\n  - "
            + "\n  - ".join(problems)
            + "\n  (Windows: winget install DenoLand.Deno)\n"
        )

    if not secret_key_configured():
        print(
            "NOTE: REWATCH_SECRET_KEY is not set, so a random key is used and open tabs "
            "lose their download tokens after a restart.\n"
            '  Generate one: python -c "import secrets; print(secrets.token_hex(32))"\n'
        )


def start_tunnel(port: int) -> subprocess.Popen | None:
    exe = shutil.which("cloudflared")
    if not exe:
        print("WARNING: --tunnel requested but `cloudflared` is not installed; skipping.\n")
        return None
    print("Starting Cloudflare quick tunnel (the public URL appears in the log below)...\n")
    return subprocess.Popen([exe, "tunnel", "--url", f"http://localhost:{port}"])


def main() -> None:
    ap = argparse.ArgumentParser(description="Start the Rewatch server.")
    ap.add_argument(
        "--host",
        default="127.0.0.1",
        help="bind address (default: 127.0.0.1; use 0.0.0.0 to allow your LAN)",
    )
    ap.add_argument("--port", type=int, default=8000, help="port (default: 8000)")
    ap.add_argument(
        "--reload",
        action="store_true",
        help="auto-reload on code changes (development)",
    )
    ap.add_argument("--tunnel", action="store_true", help="also start a Cloudflare quick tunnel")
    ap.add_argument("--log-level", default="info", choices=["debug", "info", "warning", "error"])
    args = ap.parse_args()

    # .env and the relative download/static paths are resolved from the project root
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))

    preflight()

    if port_in_use(args.host, args.port):
        sys.exit(f"Port {args.port} is already in use. Pick another with --port.")

    print(f"Rewatch: http://localhost:{args.port}")
    if args.host in ("0.0.0.0", "") and (ip := lan_ip()):
        print(f"On your network: http://{ip}:{args.port}")
        print("WARNING: Rewatch has no login. Only do this on a network you trust.")
    print()

    tunnel = start_tunnel(args.port) if args.tunnel else None

    import uvicorn

    try:
        # one worker on purpose: jobs are held in memory
        uvicorn.run(
            "app.main:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
            log_level=args.log_level,
            workers=1,
        )
    finally:
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()


if __name__ == "__main__":
    main()
