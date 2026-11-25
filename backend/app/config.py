"""
Central configuration.

Every setting can be overridden with an environment variable of the same name
(e.g. MAX_CONCURRENT_JOBS=4). Values are read once at startup.
"""
import os
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# --- Storage -----------------------------------------------------------------
# Every job gets its own sub-folder in here. Folders are deleted FILE_TTL_SECONDS
# after the job was created.
DOWNLOAD_DIR = Path(os.environ.get("DOWNLOAD_DIR", Path(__file__).resolve().parents[1] / "downloads"))
FILE_TTL_SECONDS = _int("FILE_TTL_SECONDS", 3600)          # 1 hour
CLEANUP_INTERVAL_SECONDS = _int("CLEANUP_INTERVAL_SECONDS", 300)

# --- Job queue ---------------------------------------------------------------
MAX_CONCURRENT_JOBS = _int("MAX_CONCURRENT_JOBS", 2)       # yt-dlp/ffmpeg processes running at once
MAX_QUEUED_JOBS = _int("MAX_QUEUED_JOBS", 40)              # reject new jobs beyond this
MAX_ACTIVE_JOBS_PER_IP = _int("MAX_ACTIVE_JOBS_PER_IP", 20) # queued + running items per client (a batch item counts as one)
JOB_TIMEOUT_SECONDS = _int("JOB_TIMEOUT_SECONDS", 1800)    # kill a job running longer than this

# --- Multi-clip / batch --------------------------------------------------------
MAX_CLIPS_PER_JOB = _int("MAX_CLIPS_PER_JOB", 20)              # clips in one item
MAX_TOTAL_CLIP_SECONDS = _int("MAX_TOTAL_CLIP_SECONDS", 3600)  # summed clip length per item
MAX_BATCH_ITEMS = _int("MAX_BATCH_ITEMS", 20)                  # links in one batch
MERGE_FADE_SECONDS = 0.5                                       # total fade between merged clips

# --- Limits ------------------------------------------------------------------
MAX_DURATION_SECONDS = _int("MAX_DURATION_SECONDS", 3 * 3600)  # longest video (or clip) allowed
MAX_FILESIZE_MB = _int("MAX_FILESIZE_MB", 2048)                # estimated-size cap per job
MAX_QUALITY = _int("MAX_QUALITY", 2160)                        # highest height offered

# --- Rate limiting (per client IP, sliding window) ---------------------------
RATE_INFO_PER_MINUTE = _int("RATE_INFO_PER_MINUTE", 30)
RATE_DOWNLOADS_PER_HOUR = _int("RATE_DOWNLOADS_PER_HOUR", 30)

# --- yt-dlp ------------------------------------------------------------------
# Optional Netscape-format cookies file (exported from a logged-in browser).
# Lets the server fetch age-restricted videos. Admin can also upload it via API.
COOKIES_FILE = Path(os.environ.get("COOKIES_FILE", Path(__file__).resolve().parents[1] / "data" / "cookies.txt"))
# Separate cookies for Instagram (stories, highlights, private accounts you
# follow, image posts/carousels via gallery-dl). Upload via the admin API.
INSTAGRAM_COOKIES_FILE = Path(os.environ.get(
    "INSTAGRAM_COOKIES_FILE", Path(__file__).resolve().parents[1] / "data" / "instagram_cookies.txt"))
# How often to retry Instagram when it rate-limits us (waits 5s, 15s, 45s...).
INSTAGRAM_RETRIES = _int("INSTAGRAM_RETRIES", 3)
# Prefer H.264 + AAC (plays everywhere, incl. QuickTime/old TVs). Only matters up
# to 1080p; YouTube serves 1440p/2160p as VP9/AV1 only.
PREFER_H264 = _bool("PREFER_H264", False)
# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges.
# Deno is its default (installed in the Docker image). If you only have Node
# locally, set YTDLP_JS_RUNTIMES=node.
YTDLP_JS_RUNTIMES = os.environ.get("YTDLP_JS_RUNTIMES", "").strip()
INFO_CACHE_SECONDS = _int("INFO_CACHE_SECONDS", 600)
INFO_TIMEOUT_SECONDS = _int("INFO_TIMEOUT_SECONDS", 60)

# --- Admin -------------------------------------------------------------------
# Admin endpoints are disabled unless this is set to a long random string.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

# --- Frontend ----------------------------------------------------------------
# If this folder exists (the built React app), FastAPI serves it at "/".
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
# Comma-separated list of extra origins allowed by CORS (only needed when the
# frontend is hosted on a different domain than the API).
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
# Optional regex for origins, handy for Vercel preview URLs, e.g.
#   CORS_ORIGIN_REGEX=https://reeltube(-[a-z0-9-]+)?\.vercel\.app
CORS_ORIGIN_REGEX = os.environ.get("CORS_ORIGIN_REGEX", "").strip() or None

# Qualities offered in the UI, highest first.
QUALITIES = [h for h in (2160, 1440, 1080, 720, 480, 360) if h <= MAX_QUALITY]
BITRATES = (128, 192, 320)
