"""
FastAPI entry point.

Public API
  POST   /api/info                    {url}  -> metadata (YouTube or Instagram)
  POST   /api/parse-clips             {text} -> {clips, errors}  (bulk-paste helper)
  POST   /api/download                one item -> {job_id}
  GET    /api/progress/{job_id}       SSE stream of the item's state
  GET    /api/job/{job_id}            JSON snapshot
  POST   /api/job/{job_id}/retry      re-run a failed/cancelled item
  DELETE /api/job/{job_id}            cancel
  GET    /api/file/{job_id}           finished file (MP4 / MP3 / ZIP / JPG)
  POST   /api/batch                   {items:[...]} -> {batch_id, job_ids}
  GET    /api/batch/{batch_id}        JSON snapshot
  GET    /api/batch/{batch_id}/progress  SSE stream (per item + per clip)
  GET    /api/batch/{batch_id}/zip    one ZIP with every finished item
  DELETE /api/batch/{batch_id}        cancel all items
  GET    /api/health

Item body (used by /api/download and inside /api/batch):
  {url, type: "video"|"audio"|"media", quality: 1080, bitrate: 192,
   clips?: [{start, end, name?, type?, quality?, bitrate?}],
   output?: "separate"|"merged", fade?: bool,
   media?: [1, 3]            # Instagram carousel items (1-based), type "media"
   start?, end?}             # legacy single clip, still accepted

Admin API (header "X-Admin-Token: <ADMIN_TOKEN>")
  GET    /api/admin/status
  POST   /api/admin/update-ytdlp            {channel: "stable"|"nightly"}  (also updates gallery-dl)
  POST   /api/admin/cookies?platform=youtube|instagram   multipart cookies.txt
  DELETE /api/admin/cookies?platform=youtube|instagram

Run with ONE worker (job state is in memory):
  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import json
import logging
import secrets
import shutil
from contextlib import asynccontextmanager
from typing import Callable, List, Literal, Optional, Union

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, ytdlp
from .jobs import Clip, manager
from .ratelimit import RateLimiter, client_ip
from .utils import format_time, parse_clip_lines, parse_link, parse_time, validate_clip

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await manager.start()
    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not found on PATH - merging/MP3/clips will fail")
    if not (shutil.which("deno") or shutil.which("node")):
        log.warning("No JavaScript runtime (deno/node) found - yt-dlp needs one for YouTube")
    yield
    await manager.stop()


app = FastAPI(title="ReelTube", lifespan=lifespan)

if config.CORS_ORIGINS or config.CORS_ORIGIN_REGEX:
    # Needed when the frontend is hosted on another domain (e.g. Vercel).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_origin_regex=config.CORS_ORIGIN_REGEX,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

info_limiter = RateLimiter(config.RATE_INFO_PER_MINUTE, 60, "lookup")
download_limiter = RateLimiter(config.RATE_DOWNLOADS_PER_HOUR, 3600, "download")


@app.exception_handler(ytdlp.YtdlpError)
async def ytdlp_error_handler(_request: Request, exc: ytdlp.YtdlpError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

TimeValue = Optional[Union[float, str]]


class InfoRequest(BaseModel):
    url: str = Field(..., max_length=500)


class ParseClipsRequest(BaseModel):
    text: str = Field(..., max_length=20_000)


class ClipRequest(BaseModel):
    start: TimeValue = None
    end: TimeValue = None
    name: str = Field("", max_length=100)
    # Optional per-clip overrides (only used with output="separate").
    type: Optional[Literal["video", "audio"]] = None
    quality: Optional[int] = None
    bitrate: Optional[int] = None


class ItemRequest(BaseModel):
    url: str = Field(..., max_length=500)
    type: Literal["video", "audio", "media"] = "video"
    quality: int = 1080
    bitrate: int = 192
    clips: Optional[List[ClipRequest]] = None
    output: Literal["separate", "merged"] = "separate"
    fade: bool = False
    media: Optional[List[int]] = None
    start: TimeValue = None   # legacy single-clip fields
    end: TimeValue = None


class BatchRequest(BaseModel):
    items: List[ItemRequest]


def bad_request(message: str):
    raise HTTPException(status_code=400, detail=message)


def link_or_400(url: str):
    link = parse_link(url)
    if not link:
        bad_request("That link isn't supported. Paste a YouTube (watch, youtu.be, /shorts/) "
                    "or Instagram (post, reel, video, story) link.")
    return link


def ensure_downloadable(info: dict):
    status = info.get("live_status")
    if info.get("is_live") or status == "is_live":
        bad_request("This is a live stream. You can download it after it has ended.")
    if status == "is_upcoming":
        bad_request("This video is an upcoming premiere/stream and isn't available yet.")
    if status == "post_live":
        bad_request("This stream just ended and YouTube is still processing it. Try again later.")
    if info["platform"] == "youtube" and not info.get("duration"):
        bad_request("Couldn't determine the video length, so it can't be downloaded.")


async def prepare_item(req: ItemRequest) -> dict:
    """
    Validate one item and return the kwargs for manager.create().
    Raises HTTPException(400) with a friendly message.
    """
    link = link_or_400(req.url)
    info = await ytdlp.get_info(link)  # cached after /api/info
    ensure_downloadable(info)
    base = dict(link=link, info=info, kind=req.type, quality=req.quality, bitrate=req.bitrate,
                output=req.output, fade=req.fade)

    # --- Instagram originals (images, carousels, stories) ---
    if req.type == "media":
        if link.platform != "instagram":
            bad_request("'Original files' is only available for Instagram links.")
        count = info.get("media_count", 0)
        picks = sorted(set(req.media or []))
        if any(i < 1 or i > count for i in picks):
            bad_request(f"This post has {count} item(s); pick numbers between 1 and {count}.")
        return {**base, "media_indices": picks}

    if not info.get("is_video"):
        bad_request("This Instagram post isn't a single video. Choose 'Original files' to download its "
                    "photos/videos, or pick individual items.")

    if link.platform == "youtube" and req.type == "video":
        if req.quality not in config.QUALITIES:
            bad_request(f"Quality must be one of: {', '.join(f'{q}p' for q in config.QUALITIES)}.")
        available = [q["height"] for q in info["qualities"]]
        if available and req.quality not in available:
            bad_request(f"{req.quality}p isn't available for this video.")
    if req.type == "audio" and req.bitrate not in config.BITRATES:
        bad_request("Bitrate must be 128, 192 or 320 kbps.")
    wants_audio = req.type == "audio" or any(c.type == "audio" for c in (req.clips or []))
    if wants_audio and info.get("has_audio") is False:
        bad_request("This video has no sound, so it can't be saved as MP3.")

    # --- Clips ---
    raw_clips = list(req.clips or [])
    if req.start is not None or req.end is not None:
        raw_clips.append(ClipRequest(start=req.start, end=req.end))
    duration = info.get("duration") or 0

    clips: List[Clip] = []
    if len(raw_clips) > config.MAX_CLIPS_PER_JOB:
        bad_request(f"Too many clips: the limit is {config.MAX_CLIPS_PER_JOB} per video.")
    for n, rc in enumerate(raw_clips, start=1):
        try:
            start, end = parse_time(rc.start), parse_time(rc.end)
        except ValueError as exc:
            bad_request(f"Clip {n}: {exc}")
        if duration and end is not None and duration < end <= duration + 1:
            end = duration  # player times can run a fraction past the end
        problem = validate_clip(start, end, duration)
        if problem:
            bad_request(f"Clip {n}: {problem}" if len(raw_clips) > 1 else problem)
        if rc.type == "video" and rc.quality is not None and link.platform == "youtube" \
                and rc.quality not in config.QUALITIES:
            bad_request(f"Clip {n}: invalid quality.")
        if rc.bitrate is not None and rc.bitrate not in config.BITRATES:
            bad_request(f"Clip {n}: invalid bitrate.")
        clips.append(Clip(start=start, end=end, name=rc.name.strip(),
                          type=rc.type, quality=rc.quality, bitrate=rc.bitrate))

    # A single clip covering the whole video is just a full download.
    if len(clips) == 1 and duration and clips[0].start <= 0 and clips[0].end >= duration:
        clips = []

    if clips:
        total = sum(c.length for c in clips)
        if total > config.MAX_TOTAL_CLIP_SECONDS:
            bad_request(f"The clips add up to {format_time(total)}; the limit is "
                        f"{format_time(config.MAX_TOTAL_CLIP_SECONDS)}.")
        length = total
    else:
        length = duration
    if length > config.MAX_DURATION_SECONDS:
        bad_request(f"That's longer than this server allows ({format_time(config.MAX_DURATION_SECONDS)}). "
                    "Cut a shorter clip.")

    # Estimated size check (scaled to the downloaded length).
    if duration:
        if req.type == "video":
            q = next((q for q in info["qualities"] if q["height"] == req.quality), None)
            size = q.get("filesize") if q else None
        else:
            size = req.bitrate * 1000 / 8 * duration
        if size and size * (length / duration) > config.MAX_FILESIZE_MB * 1024 * 1024:
            bad_request(f"The file would be larger than {config.MAX_FILESIZE_MB} MB. "
                        "Pick a lower quality or cut shorter clips.")

    return {**base, "clips": clips}


def check_capacity(ip: str, new_items: int):
    if manager.active_count(ip) + new_items > config.MAX_ACTIVE_JOBS_PER_IP:
        raise HTTPException(429, "You already have too many downloads in progress. Wait for some to finish.")
    if manager.active_count() + new_items > config.MAX_QUEUED_JOBS:
        raise HTTPException(503, "The server is busy right now. Please try again in a few minutes.")


async def sse(request: Request, snapshot: Callable[[], Optional[dict]], version: Callable[[], object],
              finished: Callable[[dict], bool]):
    """Generic Server-Sent Events loop: send state whenever version() changes."""
    last = object()
    idle = 0.0
    yield "retry: 2000\n\n"
    while True:
        if await request.is_disconnected():
            break
        current = version()
        if current is None:
            yield f"data: {json.dumps({'status': 'error', 'error': 'Expired.'})}\n\n"
            break
        if current != last:
            last, idle = current, 0.0
            state = snapshot()
            yield f"data: {json.dumps(state)}\n\n"
            if finished(state):
                break
        elif idle >= 15:
            idle = 0.0
            yield ": keep-alive\n\n"  # stops proxies closing an idle connection
        await asyncio.sleep(0.4)
        idle += 0.4


SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
TERMINAL = ("done", "error", "cancelled")


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/info")
async def info(body: InfoRequest, request: Request):
    info_limiter.check(client_ip(request))
    link = link_or_400(body.url)
    data = await ytdlp.get_info(link)
    ensure_downloadable(data)
    return {
        **data,
        "limits": {
            "max_duration": config.MAX_DURATION_SECONDS,
            "max_filesize_mb": config.MAX_FILESIZE_MB,
            "max_clips": config.MAX_CLIPS_PER_JOB,
            "max_total_clip_seconds": config.MAX_TOTAL_CLIP_SECONDS,
        },
    }


@app.post("/api/parse-clips")
async def parse_clips(body: ParseClipsRequest):
    clips, errors = parse_clip_lines(body.text)
    return {"clips": clips, "errors": errors}


@app.post("/api/download")
async def download(body: ItemRequest, request: Request):
    ip = client_ip(request)
    link_or_400(body.url)
    check_capacity(ip, 1)
    kwargs = await prepare_item(body)
    download_limiter.check(ip)
    job = manager.create(ip=ip, **kwargs)
    return {"job_id": job.id}


def job_or_404(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found. It may have expired.")
    return job


@app.get("/api/job/{job_id}")
async def job_status(job_id: str):
    job = job_or_404(job_id)
    return job.public(manager.queue_position(job))


@app.delete("/api/job/{job_id}")
async def cancel_job(job_id: str):
    job = job_or_404(job_id)
    manager.cancel(job)
    return job.public()


@app.post("/api/job/{job_id}/retry")
async def retry_job(job_id: str, request: Request):
    job = job_or_404(job_id)
    if job.status not in ("error", "cancelled"):
        raise HTTPException(409, "Only failed or cancelled downloads can be retried.")
    check_capacity(client_ip(request), 1)
    manager.retry(job)
    return job.public(manager.queue_position(job))


@app.get("/api/progress/{job_id}")
async def progress(job_id: str, request: Request):
    """SSE: each message is the item's JSON state; ends after done/error/cancelled."""
    job_or_404(job_id)

    def snapshot():
        job = manager.get(job_id)
        return job.public(manager.queue_position(job))

    def version():
        job = manager.get(job_id)
        return (job.version, manager.queue_position(job)) if job else None

    return StreamingResponse(sse(request, snapshot, version, lambda s: s["status"] in TERMINAL),
                             media_type="text/event-stream", headers=SSE_HEADERS)


MEDIA_TYPES = {".mp4": "video/mp4", ".mp3": "audio/mpeg", ".zip": "application/zip",
               ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
               ".heic": "image/heic"}


@app.get("/api/file/{job_id}")
async def get_file(job_id: str):
    job = job_or_404(job_id)
    if job.status != "done" or not job.file_path or not job.file_path.is_file():
        raise HTTPException(409, "The file isn't ready yet.")
    media_type = MEDIA_TYPES.get(job.file_path.suffix.lower(), "application/octet-stream")
    # FileResponse streams the file and builds an RFC 5987 Content-Disposition
    # header, so non-ASCII titles survive.
    return FileResponse(job.file_path, media_type=media_type, filename=job.download_name)


# ---- batch -------------------------------------------------------------------

@app.post("/api/batch")
async def create_batch(body: BatchRequest, request: Request):
    ip = client_ip(request)
    if not body.items:
        bad_request("Add at least one link.")
    if len(body.items) > config.MAX_BATCH_ITEMS:
        bad_request(f"A batch can have at most {config.MAX_BATCH_ITEMS} links.")
    for n, item in enumerate(body.items, start=1):
        if not parse_link(item.url):
            bad_request(f"Item {n}: that link isn't a supported YouTube or Instagram link.")
    check_capacity(ip, len(body.items))

    # Validate every item first (fetching info in parallel), so a mistake in
    # item 4 doesn't leave items 1-3 already running.
    async def checked(n: int, item: ItemRequest):
        try:
            return await prepare_item(item)
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Item {n}: {exc.detail}")
        except ytdlp.YtdlpError as exc:
            raise HTTPException(400, f"Item {n}: {exc}")

    prepared = await asyncio.gather(*(checked(n, it) for n, it in enumerate(body.items, start=1)))
    for _ in prepared:
        download_limiter.check(ip)
    batch = manager.create_batch(ip, list(prepared))
    return {"batch_id": batch.id, "job_ids": batch.item_ids}


def batch_or_404(batch_id: str):
    batch = manager.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found. It may have expired.")
    return batch


@app.get("/api/batch/{batch_id}")
async def batch_status(batch_id: str):
    return manager.batch_public(batch_or_404(batch_id))


@app.get("/api/batch/{batch_id}/progress")
async def batch_progress(batch_id: str, request: Request):
    """
    SSE: each message is the whole batch state (items + per-clip progress).
    The stream stays open while anything runs; after a retry the browser
    simply reconnects.
    """
    batch_or_404(batch_id)

    def snapshot():
        return manager.batch_public(manager.get_batch(batch_id))

    def version():
        batch = manager.get_batch(batch_id)
        return manager.batch_version(batch) if batch else None

    return StreamingResponse(sse(request, snapshot, version, lambda s: s["status"] != "running"),
                             media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/batch/{batch_id}/zip")
async def batch_zip(batch_id: str):
    batch = batch_or_404(batch_id)
    state = manager.batch_public(batch)
    if state["status"] == "running":
        raise HTTPException(409, "The batch is still running.")
    path = await manager.batch_zip(batch)
    if not path:
        raise HTTPException(409, "Nothing in this batch finished successfully.")
    return FileResponse(path, media_type="application/zip", filename=f"batch-{state['done']}-items.zip")


@app.delete("/api/batch/{batch_id}")
async def cancel_batch(batch_id: str):
    batch = batch_or_404(batch_id)
    for job_id in batch.item_ids:
        job = manager.get(job_id)
        if job:
            manager.cancel(job)
    return manager.batch_public(batch)


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

def require_admin(x_admin_token: str = Header(default="")):
    if not config.ADMIN_TOKEN:
        raise HTTPException(404, "Admin API is disabled (set ADMIN_TOKEN).")
    if not secrets.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise HTTPException(401, "Invalid admin token.")


class UpdateRequest(BaseModel):
    channel: Literal["stable", "nightly"] = "stable"


Platform = Literal["youtube", "instagram"]


def cookies_path(platform: str):
    return config.INSTAGRAM_COOKIES_FILE if platform == "instagram" else config.COOKIES_FILE


@app.get("/api/admin/status", dependencies=[Depends(require_admin)])
async def admin_status():
    return {
        "versions": await ytdlp.versions(),
        "ffmpeg": shutil.which("ffmpeg"),
        "js_runtime": shutil.which("deno") or shutil.which("node"),
        "cookies": {"youtube": config.COOKIES_FILE.is_file(), "instagram": config.INSTAGRAM_COOKIES_FILE.is_file()},
        "active_jobs": manager.active_count(),
        "jobs_in_memory": len(manager.jobs),
        "batches_in_memory": len(manager.batches),
    }


@app.post("/api/admin/update-ytdlp", dependencies=[Depends(require_admin)])
async def admin_update(body: UpdateRequest = UpdateRequest()):
    return await ytdlp.update(body.channel)


@app.post("/api/admin/cookies", dependencies=[Depends(require_admin)])
async def admin_upload_cookies(file: UploadFile = File(...), platform: Platform = Query("youtube")):
    content = await file.read()
    if len(content) > 1_000_000:
        bad_request("cookies.txt is too large.")
    text = content.decode("utf-8", "replace")
    if "# Netscape HTTP Cookie File" not in text and "# HTTP Cookie File" not in text:
        bad_request("That isn't a Netscape-format cookies.txt file.")
    path = cookies_path(platform)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    ytdlp.clear_cache()
    return {"ok": True, "platform": platform}


@app.delete("/api/admin/cookies", dependencies=[Depends(require_admin)])
async def admin_delete_cookies(platform: Platform = Query("youtube")):
    cookies_path(platform).unlink(missing_ok=True)
    ytdlp.clear_cache()
    return {"ok": True, "platform": platform}


# ---------------------------------------------------------------------------
# Frontend (built React app). Mounted last so /api/* routes win.
# ---------------------------------------------------------------------------

if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
else:
    @app.get("/")
    async def no_frontend():
        return {"message": "API is running. Build the frontend (cd frontend && npm run build) "
                           "or use the Vite dev server on :5173."}
