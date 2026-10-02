FROM python:3.12-slim

# ffmpeg is required by yt-dlp for merging/transcoding; curl is used by the
# healthcheck and to keep yt-dlp's extractors current at startup.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Deno: the JS runtime yt-dlp uses (with yt-dlp-ejs) to solve YouTube's challenges.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

RUN useradd --create-home --uid 1000 rewatch
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/downloads && chown -R rewatch:rewatch /app
USER rewatch

ENV REWATCH_DOWNLOAD_DIR=/app/downloads \
    PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]