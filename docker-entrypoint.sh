#!/usr/bin/env sh
set -e

# Keep yt-dlp's site extractors (and gallery-dl, used for TikTok photo slideshows)
# current: sites change often and a stale copy is the most common cause of
# "Unsupported URL" reports. Set REWATCH_SKIP_YTDLP_UPDATE=true to skip this and use the
# versions installed in the image. A failed update is logged but never stops the server.
if [ "${REWATCH_SKIP_YTDLP_UPDATE:-}" != "true" ]; then
  if pip install --no-cache-dir --user -q -U "yt-dlp[default]" "gallery-dl>=1.32,<2" >/tmp/rewatch-update.log 2>&1; then
    echo "rewatch: yt-dlp and gallery-dl are up to date"
  else
    echo "rewatch: could not update yt-dlp/gallery-dl, using the versions in the image:" >&2
    tail -n 3 /tmp/rewatch-update.log >&2 || true
  fi
fi

exec "$@"
