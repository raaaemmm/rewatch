# Rewatch

Self-hosted downloader for YouTube, TikTok, Instagram, X/Twitter, Reddit and
1000+ other sites. Paste a link, pick **MP4** or **MP3**, download.

Built on **FastAPI** and **yt-dlp**. It is a rebuild of
[averygan/reclip](https://github.com/averygan/reclip) with a hardened API, live
progress and a split frontend. It is meant for personal use on your own machine,
optionally shared through a Cloudflare tunnel.

## Features

- MP4 (video) or MP3 (audio, 128 / 192 / 320 kbps)
- Quality picker per video, defaulting to the highest resolution
- Batch mode: paste several links at once (up to 25); playlists are expanded for you
- Live percent, speed and ETA, with cancel
- Prefers H.264 + AAC so MP4s play on iPhone, Windows and TVs
- Finished files are deleted automatically after 30 minutes
- No accounts, no third-party requests (the font is self-hosted), strict CSP
- English and Khmer text render correctly (Kantumruy Pro)

## Quick start

### Option A: Python (`start_server.py`)

Requirements: Python 3.10+, **ffmpeg** on PATH, and **Deno** on PATH for full
YouTube quality lists.

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env              # Windows: copy .env.example .env
# edit .env and set REWATCH_SECRET_KEY (see below)

python start_server.py
```

Open http://localhost:8000. The script also prints your LAN address so you can
open it from your phone.

```bash
python start_server.py --port 9000       # different port
python start_server.py --reload          # auto-restart on code changes (development)
python start_server.py --tunnel          # also start a Cloudflare quick tunnel
python start_server.py --host 127.0.0.1  # this machine only
```

On startup it checks for ffmpeg (exits if missing), warns if Deno or the secret
key is missing, and stops with a message if the port is already in use.

Install the tools on Windows with:

```powershell
winget install Gyan.FFmpeg
winget install DenoLand.Deno
```

macOS: `brew install ffmpeg deno`.

Generate a secret key with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Option B: Docker

```bash
cp .env.example .env              # then set REWATCH_SECRET_KEY
docker compose up --build         # later runs: docker compose up -d
```

Open http://localhost:8000. The image already contains ffmpeg and Deno.
`docker compose up` refuses to start until `REWATCH_SECRET_KEY` is set.

The compose file publishes the port on all interfaces, runs the container with
`no-new-privileges` and all capabilities dropped, and caps it at 2 GB RAM and 2 CPUs.
To make it reachable from this machine only, change the port mapping to
`"127.0.0.1:8000:8000"`.

## Sharing it with a Cloudflare tunnel

```bash
cloudflared tunnel --url http://localhost:8000
# or: python start_server.py --tunnel
```

This prints a `https://...trycloudflare.com` address.

- **Anyone with that address can use your instance.** For anything beyond a quick
  test, use a named tunnel with **Cloudflare Access** (the free tier supports email
  one-time PINs) instead of relying on the URL being secret.
- Because the app also listens on your LAN, `REWATCH_TRUST_PROXY_HEADERS` is
  `false` by default, so all tunnel visitors share one rate-limit bucket. If you
  bind to `127.0.0.1` and reach the app only through cloudflared, set it to `true`
  so the limiter uses `CF-Connecting-IP`.
- Cloudflare's free proxy closes idle connections at about 100 s. The progress
  stream sends a keep-alive every ~15 s, and the UI falls back to polling if it drops.

## Configuration

Set environment variables prefixed with `REWATCH_`, either in `.env` or in your
shell (see [`app/config.py`](app/config.py) for the full list).

| Variable | Default | Description |
|---|---|---|
| `REWATCH_SECRET_KEY` | random per start | Signs job tokens. Set it so open tabs survive a restart. |
| `REWATCH_MAX_CONCURRENT_DOWNLOADS` | `2` | Parallel downloads. |
| `REWATCH_MAX_QUEUED_JOBS` | `50` | Reject new jobs beyond this (HTTP 429). |
| `REWATCH_FILE_TTL_SECONDS` | `1800` | Delete finished files and jobs after this long. |
| `REWATCH_MAX_DURATION_SECONDS` | `14400` | Reject media longer than this (0 = off). |
| `REWATCH_MAX_FILESIZE_MB` | `2048` | Reject files larger than this (0 = off). |
| `REWATCH_RATE_LIMIT_PER_MINUTE` | `30` | Per-IP request limit (0 = off). `docker-compose.yml` sets 120. |
| `REWATCH_TRUST_PROXY_HEADERS` | `false` | Trust `CF-Connecting-IP` / `X-Forwarded-For`. |
| `REWATCH_ALLOWED_HOSTS` | *(unset)* | Restrict to certain sites, e.g. `youtube.com,youtu.be`. |
| `REWATCH_ALLOW_PRIVATE_URLS` | `false` | Allow URLs that resolve to private/loopback addresses. Leave off. |
| `REWATCH_DENO_PATH` | *(auto)* | Full path to Deno if it is installed somewhere unusual. |

Jobs are held in memory, so Rewatch runs a **single worker**. Do not start it with
`--workers` greater than 1.

## Troubleshooting

| Problem | Fix |
|---|---|
| Only one or two low qualities show for YouTube | Install **Deno** and make sure `yt-dlp[default]` is installed (`pip install -U "yt-dlp[default]"`). The card shows a warning when this is the cause. |
| "Unsupported URL" or extraction errors on a site that used to work | Update yt-dlp: `pip install -U "yt-dlp[default]"`. In Docker, rebuild with `docker compose build --no-cache`. |
| "Too many requests" (429) | You hit the per-IP rate limit. Wait a minute or raise `REWATCH_RATE_LIMIT_PER_MINUTE`. |
| "Job not found" after restarting the server | Job tokens reset when the secret key is random. Set `REWATCH_SECRET_KEY`. |
| "File not ready or expired" | Files are removed after `REWATCH_FILE_TTL_SECONDS` (30 min by default). Download again. |
| "Port already in use" | Use `python start_server.py --port 9000`. |
| MP3 or merging fails | ffmpeg is missing from PATH. |
| Some sites need a login or cookies | Not supported. Rewatch ignores yt-dlp config files on purpose. |

## API

There are no public API docs. These are the endpoints the bundled UI uses:

| Method | Path | |
|---|---|---|
| `GET` | `/api/v1/config` | UI limits |
| `POST` | `/api/v1/info` | `{url}` returns title, thumbnail, duration, uploader and available qualities |
| `POST` | `/api/v1/playlist` | `{url}` returns the entry URLs (up to 50) |
| `POST` | `/api/v1/jobs` | `{url, format: "video"\|"audio", height?, audio_bitrate?, title?}` returns `{job_id, token}` |
| `GET` | `/api/v1/jobs/{id}?token=` | Current status |
| `GET` | `/api/v1/jobs/{id}/events?token=` | Server-Sent Events progress stream |
| `GET` | `/api/v1/jobs/{id}/file?token=` | Download the finished file |
| `DELETE` | `/api/v1/jobs/{id}?token=` | Cancel a queued or running job |
| `GET` | `/healthz` | Health check |

The `token` is an HMAC signed when the job is created. A job id alone cannot be
queried or downloaded.

## Security notes

- URLs must be `http(s)`, are limited to 2048 characters, and must not carry
  credentials. Hosts are resolved and rejected if they point at private, loopback or
  link-local addresses (SSRF guard).
- yt-dlp runs as a library, so a URL can never be parsed as a command-line flag.
- The Content-Security-Policy allows only same-origin scripts, styles and fonts, and
  the UI uses no inline styles or handlers.
- The SSRF check resolves DNS once before yt-dlp fetches the page, so it cannot
  fully stop redirect or DNS-rebinding tricks. Keep the instance behind Cloudflare
  Access or on a trusted network, and do not give it access to sensitive internal
  services.

## Project layout

```
app/
  main.py            app factory, security headers, static files
  config.py          REWATCH_* settings
  security.py        URL validation, job tokens, rate limiting
  schemas.py         request/response models
  routers/           media.py (info, playlist), jobs.py (jobs, SSE, file), deps.py
  services/          extractor.py (yt-dlp), jobs.py (queue + store), cleanup.py
static/              index.html, js/app.js, css/, fonts/
tests/               pytest suite
start_server.py      launcher for running without Docker
Dockerfile, docker-compose.yml, docker-entrypoint.sh
```

## Tests

```bash
pip install pytest httpx
pytest
```

The download tests need ffmpeg and are skipped if it is not installed.

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) does the actual downloading.
- [averygan/reclip](https://github.com/averygan/reclip) (MIT) is the project this is
  a rebuild of.
- [Kantumruy Pro](https://github.com/anagata-design/kantumruy-pro) by Sovichet Tep is
  the bundled font, under the SIL Open Font License 1.1
  (see [`static/fonts/OFL.txt`](static/fonts/OFL.txt)).

## Legal

Downloading media you do not hold the rights to may violate a platform's terms of
service or copyright law in your jurisdiction. That is up to whoever runs the
instance. MIT licensed, see [LICENSE](LICENSE).