"""
Everything that talks to the extractors: yt-dlp (YouTube + Instagram videos)
and gallery-dl (Instagram images, carousels, stories).

Both run as *subprocesses* (`python -m yt_dlp`, `python -m gallery_dl`) instead
of being imported. When the admin updates them through the API, the very next
job uses the new version without restarting the server.
"""
import asyncio
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from . import config, media
from .utils import RATE_LIMIT_RE, Link, friendly_error, section_time

YTDLP = [sys.executable, "-m", "yt_dlp"]
GALLERYDL = [sys.executable, "-m", "gallery_dl"]

# Machine-readable progress lines, parsed in jobs.py.
PROGRESS_TEMPLATE = (
    "download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|"
    "%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|"
    "%(progress.speed)s|%(progress.eta)s"
)


class YtdlpError(Exception):
    """Raised with a user-friendly message."""


def cookies_for(platform: str) -> Optional[Path]:
    path = config.INSTAGRAM_COOKIES_FILE if platform == "instagram" else config.COOKIES_FILE
    return path if path.is_file() else None


def base_args(platform: str = "youtube") -> List[str]:
    """Options shared by every yt-dlp call."""
    args = ["--no-warnings", "--no-colors", "--socket-timeout", "20"]
    if config.YTDLP_JS_RUNTIMES:
        args += ["--js-runtimes", config.YTDLP_JS_RUNTIMES]
    cookies = cookies_for(platform)
    if cookies:
        args += ["--cookies", str(cookies)]
    return args


async def run_capture(args: List[str], timeout: int) -> Tuple[int, str, str]:
    """
    Run a command and capture stdout/stderr, killing it after `timeout` seconds.
    Uses a worker thread + subprocess.run (works with every event loop,
    including uvicorn --reload on Windows).
    """
    def _run():
        return subprocess.run(args, capture_output=True, timeout=timeout)

    try:
        proc = await asyncio.to_thread(_run)
    except subprocess.TimeoutExpired:
        raise YtdlpError("Timed out talking to the site. Please try again.")
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


async def with_backoff(fn: Callable, retries: int, first_delay: float = 5.0):
    """
    Call async `fn()` returning (code, out, err). Retry when the output looks
    like a rate limit (HTTP 429 etc.), waiting 5s, 15s, 45s... between tries.
    """
    delay = first_delay
    for attempt in range(retries + 1):
        code, out, err = await fn()
        if code == 0 or not RATE_LIMIT_RE.search(err) or attempt == retries:
            return code, out, err
        await asyncio.sleep(delay)
        delay *= 3
    return code, out, err  # pragma: no cover


# ---------------------------------------------------------------------------
# Info
# ---------------------------------------------------------------------------

# Tiny in-memory cache: link.cache_key -> (timestamp, summary).
_info_cache: Dict[str, Tuple[float, dict]] = {}


async def get_info(link: Link) -> dict:
    cached = _info_cache.get(link.cache_key)
    if cached and time.time() - cached[0] < config.INFO_CACHE_SECONDS:
        return cached[1]

    if link.platform == "youtube":
        summary = await _youtube_info(link)
    else:
        summary = await _instagram_info(link)

    _info_cache[link.cache_key] = (time.time(), summary)
    if len(_info_cache) > 500:  # keep the cache bounded
        for key, _ in sorted(_info_cache.items(), key=lambda kv: kv[1][0])[:100]:
            _info_cache.pop(key, None)
    return summary


def clear_cache():
    _info_cache.clear()


async def _ytdlp_json(url: str, platform: str, extra: List[str] = ()) -> dict:
    retries = config.INSTAGRAM_RETRIES if platform == "instagram" else 0
    code, out, err = await with_backoff(
        lambda: run_capture(YTDLP + base_args(platform) + list(extra) + ["-J", url], config.INFO_TIMEOUT_SECONDS),
        retries, first_delay=3,
    )
    if code != 0 or not out.strip():
        raise YtdlpError(friendly_error(err))
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        raise YtdlpError("Could not read the media information.")


def _size_of(fmt: dict, duration: float) -> Optional[float]:
    """Best guess of a format's size in bytes."""
    size = fmt.get("filesize") or fmt.get("filesize_approx")
    if size:
        return float(size)
    tbr = fmt.get("tbr")  # total bitrate in kbit/s
    if tbr and duration:
        return tbr * 1000 / 8 * duration
    return None


def _audio_options(duration: float) -> List[dict]:
    return [{"kbps": k, "filesize": int(k * 1000 / 8 * duration) if duration else None} for k in config.BITRATES]


async def _youtube_info(link: Link) -> dict:
    raw = await _ytdlp_json(link.url, "youtube", ["--no-playlist"])
    duration = float(raw.get("duration") or 0)
    formats = raw.get("formats") or []

    audio_only = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    best_audio = max(audio_only, key=lambda f: f.get("abr") or f.get("tbr") or 0, default=None)
    audio_size = _size_of(best_audio, duration) if best_audio else None

    qualities = []
    for height in config.QUALITIES:
        candidates = [
            f for f in formats
            if f.get("vcodec") not in (None, "none") and f.get("height") == height
            and f.get("protocol", "").startswith("http")
        ]
        if not candidates:
            continue
        best = max(candidates, key=lambda f: f.get("tbr") or 0)
        video_size = _size_of(best, duration)
        total = None
        if video_size:
            needs_audio = best.get("acodec") in (None, "none")
            total = video_size + ((audio_size or 0) if needs_audio else 0)
        qualities.append({
            "height": height, "label": f"{height}p", "fps": best.get("fps"),
            "vcodec": (best.get("vcodec") or "").split(".")[0],
            "filesize": int(total) if total else None,
        })

    thumbs = [t for t in raw.get("thumbnails") or [] if t.get("url")]
    thumb = raw.get("thumbnail") or (max(thumbs, key=lambda t: t.get("width") or 0)["url"] if thumbs else None)

    return {
        "platform": "youtube",
        "kind": "video",
        "id": raw.get("id"),
        "url": link.url,
        "title": raw.get("title") or "Untitled",
        "channel": raw.get("channel") or raw.get("uploader") or "",
        "caption": "",
        "duration": duration,
        "thumbnail": thumb,
        "live_status": raw.get("live_status"),
        "is_live": bool(raw.get("is_live")),
        "age_limit": raw.get("age_limit") or 0,
        "qualities": qualities,
        "audio": _audio_options(duration),
        "media": [],
        "media_count": 1,
        "is_video": True,      # can do MP4 / MP3 / clips
        "has_audio": True,
        "preview_url": None,   # YouTube uses the embedded player instead
    }


# ---- Instagram -------------------------------------------------------------

def _ig_title(caption: str, username: str, link: Link) -> str:
    first = (caption or "").strip().splitlines()[0] if (caption or "").strip() else ""
    first = re.sub(r"\s+", " ", first)[:80]
    if first:
        return first
    noun = {"reel": "Reel", "story": "Story", "highlight": "Highlight"}.get(link.kind, "Post")
    return f"{noun} by {username}" if username else f"Instagram {noun.lower()} {link.id}"


def _ig_summary(link: Link, username: str, caption: str, items: List[dict], source: str) -> dict:
    """Common Instagram info shape. `items` = [{type, thumbnail, url, width, height, media_id}]"""
    for i, item in enumerate(items, start=1):
        item["index"] = i
    single_video = len(items) == 1 and items[0]["type"] == "video"
    duration = items[0].get("duration") or 0 if single_video else 0
    return {
        "platform": "instagram",
        "kind": link.kind,
        "id": link.id,
        "url": link.url,
        "title": _ig_title(caption, username, link),
        "channel": username,
        "caption": (caption or "")[:500],
        "duration": float(duration or 0),
        "thumbnail": items[0]["thumbnail"] if items else None,
        "live_status": None,
        "is_live": False,
        "age_limit": 0,
        "qualities": [],                     # Instagram: always best available
        "audio": _audio_options(duration or 0),
        "media": items,
        "media_count": len(items),
        "is_video": single_video,            # MP3 + clip cutting only for single-video posts
        "has_audio": items[0].get("has_audio") is not False if single_video else None,
        "preview_url": items[0].get("url") if single_video else None,
        "source": source,
    }


async def _instagram_info(link: Link) -> dict:
    needs_login = link.kind in ("story", "highlight")
    has_cookies = cookies_for("instagram") is not None
    if needs_login and not has_cookies:
        raise YtdlpError("Instagram stories and highlights need a login. "
                         "The server admin needs to add an Instagram cookies.txt.")

    if has_cookies:
        try:
            return await _instagram_info_gallerydl(link)
        except YtdlpError:
            if needs_login:
                raise
            # Fall back to yt-dlp for posts/reels.
    return await _instagram_info_ytdlp(link)


async def _instagram_info_gallerydl(link: Link) -> dict:
    cookies = cookies_for("instagram")
    args = GALLERYDL + ["-j"] + (["--cookies", str(cookies)] if cookies else []) + [link.url]
    code, out, err = await with_backoff(
        lambda: run_capture(args, config.INFO_TIMEOUT_SECONDS), config.INSTAGRAM_RETRIES, first_delay=3)
    try:
        messages = json.loads(out) if out.strip() else []
    except json.JSONDecodeError:
        messages = []

    items, username, caption = [], "", ""
    for msg in messages:
        if not isinstance(msg, list) or not msg:
            continue
        if msg[0] == -1:  # extractor error
            err_info = msg[1] if len(msg) > 1 else {}
            raise YtdlpError(friendly_error(f"ERROR: {err_info.get('message', '')} {err}"))
        if msg[0] != 3 or len(msg) < 3:
            continue
        meta = msg[2]
        if meta.get("audio_url") and not meta.get("video_url") and not meta.get("display_url"):
            continue
        is_video = bool(meta.get("video_url")) or meta.get("extension") == "mp4"
        username = username or meta.get("username") or ""
        caption = caption or meta.get("description") or ""
        items.append({
            "type": "video" if is_video else "image",
            "thumbnail": meta.get("display_url"),
            "url": meta.get("video_url") or meta.get("display_url") or msg[1],
            "width": meta.get("width_original") or meta.get("width"),
            "height": meta.get("height_original") or meta.get("height"),
            "media_id": str(meta.get("media_id") or ""),
        })
    if code != 0 and not items:
        raise YtdlpError(friendly_error(err))
    if not items:
        raise YtdlpError("No media found at that Instagram link.")

    await _probe_single_video(items)
    return _ig_summary(link, username, caption, items, "gallery-dl")


async def _probe_single_video(items: List[dict]):
    """Instagram doesn't report duration/audio reliably: ask ffprobe (needed for clips + MP3)."""
    if len(items) == 1 and items[0]["type"] == "video" and items[0].get("url"):
        duration, has_audio = await asyncio.to_thread(media.probe_basic, items[0]["url"])
        items[0]["duration"] = items[0].get("duration") or duration
        items[0]["has_audio"] = has_audio


def _best_progressive(entry: dict) -> Optional[str]:
    """Direct MP4 URL with audio (non-DASH) for previews, best width first."""
    formats = [f for f in entry.get("formats") or [] if f.get("url")]
    plain = [f for f in formats if not str(f.get("format_id", "")).startswith("dash")]
    pool = plain or formats
    if not pool:
        return None
    return max(pool, key=lambda f: (f.get("width") or 0, f.get("tbr") or 0))["url"]


def _best_thumbnail(entry: dict) -> Optional[str]:
    thumbs = [t for t in entry.get("thumbnails") or [] if t.get("url")]
    if thumbs and any(t.get("width") for t in thumbs):
        return max(thumbs, key=lambda t: t.get("width") or 0)["url"]
    return entry.get("thumbnail") or (thumbs[-1]["url"] if thumbs else None)


async def _instagram_info_ytdlp(link: Link) -> dict:
    raw = await _ytdlp_json(link.url, "instagram", ["--ignore-no-formats-error", "--yes-playlist"])
    entries = raw.get("entries") if raw.get("_type") == "playlist" else [raw]
    items = []
    for entry in entries or []:
        if not entry:
            continue
        has_video = bool(entry.get("formats"))
        items.append({
            "type": "video" if has_video else "image",
            "thumbnail": _best_thumbnail(entry),
            "url": _best_progressive(entry) if has_video else _best_thumbnail(entry),
            "width": entry.get("width"),
            "height": entry.get("height"),
            "media_id": str(entry.get("id") or ""),
            "duration": entry.get("duration"),
        })
    if not items:
        raise YtdlpError("No media found at that Instagram link.")
    await _probe_single_video(items)

    username = raw.get("channel") or raw.get("uploader_id") or ""
    caption = raw.get("description") or ""
    return _ig_summary(link, username, caption, items, "yt-dlp")


# ---------------------------------------------------------------------------
# Download commands
# ---------------------------------------------------------------------------

def build_download_args(
    link: Link,
    out_dir: Path,
    kind: str,
    quality: int,
    bitrate: int,
    sections: Optional[List[Tuple[float, float]]] = None,
) -> List[str]:
    """
    yt-dlp arguments for one video download.

    `sections`: list of (start, end) seconds. Each becomes a repeated
    --download-sections flag, and yt-dlp writes one file per section named
    "<id>_<start>_<end>.<ext>" so jobs.py can map files back to clips.
    """
    args = YTDLP + base_args(link.platform) + [
        "--no-playlist",
        "--newline",                       # one progress line per update (no \r)
        "--progress",
        "--progress-template", PROGRESS_TEMPLATE,
        "--no-part",
        "--no-mtime",
        "--max-filesize", f"{config.MAX_FILESIZE_MB}M",
    ]
    name = "%(id)s_%(section_start)s_%(section_end)s.%(ext)s" if sections else "%(id)s.%(ext)s"
    args += ["-o", str(out_dir / name)]

    if kind == "video":
        if link.platform == "youtube":
            h = int(quality)
            args += ["-f", f"bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"]
            sort = f"res:{h},vcodec:h264,acodec:m4a" if config.PREFER_H264 else f"res:{h},acodec:m4a"
            args += ["-S", sort]
        else:
            args += ["-f", "bv*+ba/b", "-S", "acodec:m4a"]
        args += ["--merge-output-format", "mp4"]
    else:
        args += [
            "-f", "ba/b",
            "-x", "--audio-format", "mp3", "--audio-quality", f"{int(bitrate)}K",
            "--embed-thumbnail", "--convert-thumbnails", "jpg",
            "--add-metadata",
            "--parse-metadata", "%(artist,channel,uploader)s:%(meta_artist)s",
        ]

    for start, end in sections or []:
        # Only these sections are downloaded; keyframes are forced at the cut
        # points so each clip starts/ends on the exact frame.
        args += ["--download-sections", f"*{section_time(start)}-{section_time(end)}"]
    if sections:
        args.append("--force-keyframes-at-cuts")

    if link.platform == "instagram":
        args += ["--extractor-retries", "3"]
    args.append(link.url)
    return args


def build_ytdlp_playlist_args(link: Link, out_dir: Path, indices: List[int]) -> List[str]:
    """Download chosen carousel videos with yt-dlp (no-cookie fallback for Instagram)."""
    return YTDLP + base_args("instagram") + [
        "--yes-playlist", "--playlist-items", ",".join(str(i) for i in indices),
        "--newline", "--progress", "--progress-template", PROGRESS_TEMPLATE,
        "--no-part", "--no-mtime", "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", str(out_dir / "%(playlist_index)s.%(ext)s"),
        "--extractor-retries", "3",
        link.url,
    ]


def build_gallerydl_args(link: Link, out_dir: Path, indices: List[int]) -> List[str]:
    """Download chosen Instagram media (original quality) with gallery-dl."""
    cookies = cookies_for("instagram")
    args = GALLERYDL + [
        "-D", str(out_dir),                       # flat folder, no sub-dirs
        "-f", "{media_id}.{extension}",           # jobs.py maps media_id -> index
        "--range", ",".join(str(i) for i in indices),
        "--no-mtime",
        "-o", "sleep-request=1.0-2.0",            # be gentle: fewer rate limits
    ]
    if cookies:
        args += ["--cookies", str(cookies)]
    return args + [link.url]


# ---------------------------------------------------------------------------
# Version / update (admin)
# ---------------------------------------------------------------------------

async def versions() -> Dict[str, str]:
    out = {}
    for name, cmd in (("yt-dlp", YTDLP), ("gallery-dl", GALLERYDL)):
        code, stdout, err = await run_capture(cmd + ["--version"], 30)
        out[name] = stdout.strip() if code == 0 else f"unknown ({err.strip()[:100]})"
    return out


async def update(channel: str = "stable") -> dict:
    """
    pip-upgrade yt-dlp and gallery-dl inside the running server's Python env.
    channel="nightly" installs pre-releases, which often fix site breakage
    days before a stable release.
    """
    before = await versions()
    pip = [sys.executable, "-m", "pip", "install", "--no-cache-dir", "-U"]
    if channel == "nightly":
        pip += ["--pre"]
    pip += ["yt-dlp[default]", "gallery-dl"]
    code, out, err = await run_capture(pip, 300)
    after = await versions()
    clear_cache()
    return {"ok": code == 0, "before": before, "after": after, "log": (out + err)[-3000:]}
