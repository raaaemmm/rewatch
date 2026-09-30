#!/usr/bin/env sh
set -e

# Keep yt-dlp's site extractors (and gallery-dl, used for TikTok photo slideshows)
# current — sites change often and a stale copy is the most common cause of
# "Unsupported URL" reports.
if [ "${REWATCH_SKIP_YTDLP_UPDATE:-}" != "true" ]; then
  pip install --no-cache-dir --user -U "yt-dlp[default]" gallery-dl >/dev/null 2>&1 || true
fi

exec "$@"