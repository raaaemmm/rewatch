# Contributing to Rewatch

Thanks for helping. Rewatch is a small project, so keep changes focused.

## Set up

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                 # set REWATCH_SECRET_KEY
python start_server.py --reload
```

You also need **ffmpeg** (and **Deno** for full YouTube quality lists) on your PATH.

## Before you open a pull request

```bash
ruff check .
ruff format --check .
python -m pytest -q
```

CI runs the same checks on Python 3.10 to 3.13.

## Guidelines

- **New site logo:** add it to `app/services/platforms.py` and drop a white-glyph SVG in
  `static/platforms/`. The tests check that the list and the files match. Only add logos
  whose license allows it (see `static/platforms/LICENSE-ICONS.md`).
- **New text:** add the key to every language in `static/js/i18n.js`. The tests fail if a
  language is missing a key or a `{placeholder}` differs.
- **New language:** see "Adding a language" in the README.
- **Security:** keep the strict Content-Security-Policy (no inline scripts, styles or
  handlers), and run yt-dlp as a library, never through a shell.
- **No accounts, tracking or analytics.** That is a deliberate part of the project.
- Don't add support for bypassing DRM, paywalls or logins.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Don't use public issues for those.
