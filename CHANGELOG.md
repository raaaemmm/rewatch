# Changelog

## 1.0.0

First public release. A rebuild of [ReClip](https://github.com/averygan/reclip) with a
hardened API, live progress, playlists and batches, TikTok slideshows, English and Khmer
interface, and Docker support.

Before release:
- Updated FastAPI to 0.142 (Starlette 1.7) and pydantic-settings to 2.15 to fix known
  vulnerabilities.
- Docker and `start_server.py` now listen on `127.0.0.1` by default.
- Removed the runtime download of the YouTube solver from GitHub.
- Added `REWATCH_SKIP_YTDLP_UPDATE` to stop the container updating yt-dlp on start.
