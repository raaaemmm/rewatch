#!/usr/bin/env sh
set -e

# Keep yt-dlp's site extractors current — sites change often and a stale
# yt-dlp is the most common cause of "Unsupported URL" reports.
if [ "${REWATCH_SKIP_YTDLP_UPDATE:-}" != "true" ]; then
  pip install --no-cache-dir --user -U "yt-dlp[default]" >/dev/null 2>&1 || true
fi

exec "$@"