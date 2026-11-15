# ---------------------------------------------------------------------------
# Stage 1: build the React frontend into static files
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Deno binary. yt-dlp needs a JavaScript runtime to solve YouTube's
# player challenges, and Deno is the one it uses by default.
# (Pin a version tag such as denoland/deno:bin-2.x.y for reproducible builds.)
# ---------------------------------------------------------------------------
FROM denoland/deno:bin AS deno

# ---------------------------------------------------------------------------
# Stage 3: runtime - Python + ffmpeg + deno
# ---------------------------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/opt/venv/bin:$PATH" \
    DOWNLOAD_DIR=/app/downloads \
    COOKIES_FILE=/app/data/cookies.txt \
    INSTAGRAM_COOKIES_FILE=/app/data/instagram_cookies.txt \
    FRONTEND_DIST=/app/frontend/dist

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

# Unprivileged user. The virtualenv is owned by this user so the admin
# "update yt-dlp" endpoint can pip-install yt-dlp + gallery-dl at runtime.
RUN useradd --create-home --uid 1000 app \
 && python -m venv /opt/venv \
 && mkdir -p /app/downloads /app/data \
 && chown -R app:app /opt/venv /app

WORKDIR /app/backend
COPY --chown=app:app backend/requirements.txt .
USER app
RUN pip install -r requirements.txt

COPY --chown=app:app backend/app ./app
COPY --chown=app:app --from=frontend /fe/dist /app/frontend/dist

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# One worker only: jobs and progress live in this process's memory.
# --proxy-headers makes rate limiting see the real client IP behind Caddy/nginx.
# Only safe because port 8000 is NOT exposed to the internet (see docker-compose.yml).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
