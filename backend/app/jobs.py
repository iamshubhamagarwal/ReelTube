"""
Background job system.

Vocabulary
- Item:  one link to download (YouTube or Instagram) with its own format,
         quality, optional clip list and output mode. `/api/download` creates a
         single Item; `/api/batch` creates several Items grouped in a Batch.
- Clip:  a (start, end, name) section of an Item's video. Clips are cut by
         yt-dlp with repeated --download-sections flags (only those sections
         are downloaded), then delivered separately (ZIP) or merged into one file.
- Batch: a list of Items plus a combined ZIP of everything that finished.

Execution
- Items run as asyncio tasks; an asyncio.Semaphore caps how many run at once
  (MAX_CONCURRENT_JOBS). The rest wait as "queued".
- yt-dlp / gallery-dl run in a worker thread (subprocess.Popen); their output
  is parsed line by line into stage / percent / per-clip progress, which the
  SSE endpoints stream to the browser.
- A cleanup loop deletes everything FILE_TTL_SECONDS after creation.

State lives in memory, so run the server with ONE worker process.
"""
import asyncio
import logging
import os
import re
import secrets
import shutil
import subprocess
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from . import config, media, ytdlp
from .utils import RATE_LIMIT_RE, Link, clip_label, friendly_error, sanitize_filename, unique_name

log = logging.getLogger("jobs")

STEP_LABELS = {
    "download": "Download",
    "cut": "Download + cut clips",
    "merge": "Merge video + audio",
    "convert": "Convert to MP3",
    "metadata": "Cover art + tags",
    "join": "Join clips",
    "zip": "Create ZIP",
}

# yt-dlp log prefixes -> stage keys (used for full, uncut downloads).
POSTPROCESSOR_STAGES = [
    ("[Merger]", "merge"),
    ("[VideoRemuxer]", "merge"),
    ("[ExtractAudio]", "convert"),
    ("[ThumbnailsConvertor]", "metadata"),
    ("[EmbedThumbnail]", "metadata"),
    ("[Metadata]", "metadata"),
]
STAGE_FLOOR = {"merge": 90, "convert": 80, "metadata": 93}

FORMATS_LINE_RE = re.compile(r"^\[info\] .*Downloading \d+ format\(s\): (\S+)")
DESTINATION_RE = re.compile(r"^\[download\] Destination: (.+)$")
FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)")
# "<id>_<start>_<end>.<ext>" written by yt-dlp for each section.
SECTION_FILE_RE = re.compile(r"_(\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)\.[A-Za-z0-9]+$")


class StepError(Exception):
    """A job step failed with a user-facing message."""


@dataclass
class Clip:
    start: float
    end: float
    name: str = ""
    # Optional per-row overrides (ignored when output == "merged").
    type: Optional[str] = None
    quality: Optional[int] = None
    bitrate: Optional[int] = None

    status: str = "pending"  # pending | running | done | error
    percent: float = 0.0
    file: Optional[Path] = None

    @property
    def length(self) -> float:
        return self.end - self.start

    def reset(self):
        self.status, self.percent, self.file = "pending", 0.0, None

    def public(self) -> dict:
        return {"start": self.start, "end": self.end, "name": self.name,
                "status": self.status, "percent": round(self.percent, 1)}


@dataclass
class Item:
    id: str
    ip: str
    link: Link
    info: dict                        # summary from ytdlp.get_info
    kind: str                         # "video" | "audio" | "media" (Instagram originals)
    quality: int
    bitrate: int
    clips: List[Clip] = field(default_factory=list)
    output: str = "separate"          # "separate" | "merged"
    fade: bool = False
    media_indices: List[int] = field(default_factory=list)  # Instagram carousel picks (1-based)
    batch_id: Optional[str] = None
    created: float = field(default_factory=time.time)

    status: str = "queued"            # queued | running | done | error | cancelled
    stage: str = "queued"
    steps: List[str] = field(default_factory=list)
    percent: float = 0.0
    stage_percent: Optional[float] = None
    speed: Optional[float] = None
    eta: Optional[float] = None
    downloaded: Optional[float] = None
    note: Optional[str] = None        # e.g. "Rate-limited, retrying in 15s"
    error: Optional[str] = None
    file_path: Optional[Path] = None
    download_name: Optional[str] = None
    filesize: Optional[int] = None
    parts: List[Tuple[Path, str]] = field(default_factory=list)  # deliverables (for batch ZIP)
    attempts: int = 0

    version: int = 0
    _proc: Optional[subprocess.Popen] = None
    _parts_total: int = 1
    _parts_seen: int = 0

    @property
    def title(self) -> str:
        return self.info.get("title") or "download"

    @property
    def folder(self) -> Path:
        return config.DOWNLOAD_DIR / self.id

    def touch(self, **changes):
        for key, value in changes.items():
            setattr(self, key, value)
        self.version += 1

    def public(self, queue_position: Optional[int] = None) -> dict:
        return {
            "job_id": self.id,
            "batch_id": self.batch_id,
            "platform": self.link.platform,
            "url": self.link.url,
            "title": self.title,
            "thumbnail": self.info.get("thumbnail"),
            "type": self.kind,
            "output": self.output if self.clips else None,
            "status": self.status,
            "stage": self.stage,
            "steps": [{"key": s, "label": STEP_LABELS[s]} for s in self.steps],
            "percent": round(self.percent, 1),
            "stage_percent": None if self.stage_percent is None else round(self.stage_percent, 1),
            "speed": self.speed,
            "eta": self.eta,
            "downloaded": self.downloaded,
            "note": self.note,
            "error": self.error,
            "clips": [c.public() for c in self.clips],
            "filename": self.download_name,
            "filesize": self.filesize,
            "queue_position": queue_position,
            "attempts": self.attempts,
            "expires_at": self.created + config.FILE_TTL_SECONDS,
        }


@dataclass
class Batch:
    id: str
    ip: str
    item_ids: List[str]
    created: float = field(default_factory=time.time)
    zip_path: Optional[Path] = None
    zip_key: Optional[tuple] = None   # which item versions the cached ZIP contains

    @property
    def folder(self) -> Path:
        return config.DOWNLOAD_DIR / f"batch_{self.id}"


class JobManager:
    def __init__(self):
        self.jobs: Dict[str, Item] = {}
        self.batches: Dict[str, Batch] = {}
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._zip_lock = asyncio.Lock()

    # ---- lifecycle --------------------------------------------------------

    async def start(self):
        config.DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        self._semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_JOBS)
        # Leftovers from a previous run can't be served (state was in memory).
        for child in config.DOWNLOAD_DIR.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
        for job in self.jobs.values():
            self._kill(job)

    # ---- queries ----------------------------------------------------------

    def get(self, job_id: str) -> Optional[Item]:
        return self.jobs.get(job_id)

    def get_batch(self, batch_id: str) -> Optional[Batch]:
        return self.batches.get(batch_id)

    def queue_position(self, job: Item) -> Optional[int]:
        if job.status != "queued":
            return None
        waiting = sorted((j for j in self.jobs.values() if j.status == "queued"), key=lambda j: j.created)
        return next((i + 1 for i, j in enumerate(waiting) if j.id == job.id), None)

    def active_count(self, ip: Optional[str] = None) -> int:
        return sum(1 for j in self.jobs.values()
                   if j.status in ("queued", "running") and (ip is None or j.ip == ip))

    def batch_public(self, batch: Batch) -> dict:
        items = [self.jobs[i] for i in batch.item_ids if i in self.jobs]
        statuses = [i.status for i in items]
        running = any(s in ("queued", "running") for s in statuses)
        done = statuses.count("done")
        failed = sum(1 for s in statuses if s in ("error", "cancelled"))
        if running:
            status = "running"
        elif done == len(items) and items:
            status = "done"
        elif done:
            status = "partial"
        else:
            status = "error"
        return {
            "batch_id": batch.id,
            "status": status,
            "total": len(items),
            "done": done,
            "failed": failed,
            "percent": round(sum(i.percent for i in items) / len(items), 1) if items else 0,
            "zip_ready": done > 0 and not running,
            "items": [i.public(self.queue_position(i)) for i in items],
            "expires_at": batch.created + config.FILE_TTL_SECONDS,
        }

    def batch_version(self, batch: Batch) -> tuple:
        return tuple((i, self.jobs[i].version, self.queue_position(self.jobs[i]))
                     for i in batch.item_ids if i in self.jobs)

    # ---- create / cancel / retry -----------------------------------------

    def create(self, **kwargs) -> Item:
        item = Item(id=secrets.token_urlsafe(16), **kwargs)
        self._plan_steps(item)
        self.jobs[item.id] = item
        asyncio.create_task(self._run(item))
        return item

    def create_batch(self, ip: str, items: List[dict]) -> Batch:
        batch = Batch(id=secrets.token_urlsafe(12), ip=ip, item_ids=[])
        self.batches[batch.id] = batch
        for kwargs in items:
            batch.item_ids.append(self.create(ip=ip, batch_id=batch.id, **kwargs).id)
        return batch

    def cancel(self, item: Item):
        if item.status in ("queued", "running"):
            item.touch(status="cancelled", stage="cancelled", error="Cancelled.", note=None)
            self._kill(item)

    def retry(self, item: Item) -> bool:
        """Re-queue a failed/cancelled item with the same settings and ID."""
        if item.status not in ("error", "cancelled"):
            return False
        shutil.rmtree(item.folder, ignore_errors=True)
        for clip in item.clips:
            clip.reset()
        now = time.time()
        item.created = now  # restart the 1-hour expiry
        if item.batch_id and item.batch_id in self.batches:
            self.batches[item.batch_id].created = now
        item.touch(status="queued", stage="queued", percent=0.0, stage_percent=None, error=None, note=None,
                   speed=None, eta=None, downloaded=None, file_path=None, download_name=None,
                   filesize=None, parts=[], _parts_seen=0, _parts_total=1)
        self._plan_steps(item)
        asyncio.create_task(self._run(item))
        return True

    @staticmethod
    def _kill(item: Item):
        proc = item._proc
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    @staticmethod
    def _plan_steps(item: Item):
        if item.kind == "media":
            many = len(item.media_indices or []) > 1 or (not item.media_indices and item.info.get("media_count", 1) > 1)
            item.steps = ["download"] + (["zip"] if many else [])
        elif not item.clips:
            item.steps = ["download", "merge"] if item.kind == "video" else ["download", "convert", "metadata"]
            item._parts_total = 2 if item.kind == "video" else 1
        else:
            item.steps = ["cut"]
            if len(item.clips) > 1:
                item.steps.append("join" if item.output == "merged" else "zip")

    # ---- running an item --------------------------------------------------

    async def _run(self, item: Item):
        assert self._semaphore is not None
        async with self._semaphore:
            if item.status == "cancelled":
                return
            item.attempts += 1
            item.touch(status="running", stage=item.steps[0], stage_percent=None)
            shutil.rmtree(item.folder, ignore_errors=True)
            item.folder.mkdir(parents=True, exist_ok=True)
            try:
                if item.kind == "media":
                    await self._run_media(item)
                elif item.clips:
                    await self._run_clips(item)
                else:
                    await self._run_full(item)
            except StepError as exc:
                if item.status != "cancelled":
                    item.touch(status="error", stage="error", error=str(exc), note=None, speed=None, eta=None)
                return
            except asyncio.TimeoutError:
                self._kill(item)
                item.touch(status="error", stage="error", error="The job took too long and was stopped.")
                return
            except Exception as exc:  # noqa: BLE001 - report anything to the user
                log.exception("job %s crashed", item.id)
                item.touch(status="error", stage="error", error=f"Server error: {exc}")
                return

            if item.status == "cancelled":
                shutil.rmtree(item.folder, ignore_errors=True)
                return
            item.touch(status="done", stage="done", percent=100.0, stage_percent=100.0,
                       speed=None, eta=None, note=None,
                       filesize=item.file_path.stat().st_size if item.file_path else None)

    async def _exec(self, item: Item, args: List[str], on_line: Callable[[str], None]) -> Tuple[int, str]:
        """
        Run an extractor command (with the job timeout). Instagram commands are
        retried with exponential backoff when the site rate-limits us.
        """
        retries = config.INSTAGRAM_RETRIES if item.link.platform == "instagram" else 0
        delay = 5.0
        for attempt in range(retries + 1):
            log.info("job %s: %s", item.id, " ".join(args[3:]))
            code, tail = await asyncio.wait_for(
                asyncio.to_thread(self._run_process, item, args, on_line),
                timeout=config.JOB_TIMEOUT_SECONDS,
            )
            if item.status == "cancelled":
                raise StepError("Cancelled.")
            if code == 0 or not RATE_LIMIT_RE.search(tail) or attempt == retries:
                return code, tail
            item.touch(note=f"Instagram is rate-limiting us, retrying in {int(delay)}s…")
            await asyncio.sleep(delay)
            item.touch(note=None)
            delay *= 3
        return code, tail  # pragma: no cover

    @staticmethod
    def _run_process(item: Item, args: List[str], on_line: Callable[[str], None]) -> Tuple[int, str]:
        """Blocking: runs in a thread. Returns (exit_code, last_output_lines)."""
        tail: deque = deque(maxlen=80)
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
        # text=True => universal newlines, so ffmpeg's "\r"-separated status
        # lines ("time=00:00:12.34") arrive as separate lines too.
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, text=True, encoding="utf-8", errors="replace", **kwargs)
        item._proc = proc
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            if not line.startswith("PROG|") and "time=" not in line:
                tail.append(line)
            try:
                on_line(line)
            except Exception:  # noqa: BLE001 - never let parsing kill the job
                log.exception("progress parse error")
        return proc.wait(), "\n".join(tail)

    # ---- full (uncut) download -------------------------------------------

    async def _run_full(self, item: Item):
        args = ytdlp.build_download_args(item.link, item.folder, item.kind, item.quality, item.bitrate)
        code, tail = await self._exec(item, args, lambda line: self._on_full_line(item, line))
        if code != 0:
            log.warning("job %s failed:\n%s", item.id, tail)
            raise StepError(friendly_error(tail))
        output = self._find_output(item.folder, item.kind)
        if not output:
            raise StepError("The file was not created (it may exceed the size limit).")
        suffix = (f" {item.quality}p" if item.link.platform == "youtube" else "") if item.kind == "video" \
            else f" {item.bitrate}kbps"
        name = sanitize_filename(item.title + suffix, 150) + output.suffix.lower()
        item.parts = [(output, name)]
        item.file_path, item.download_name = output, name

    def _on_full_line(self, item: Item, line: str):
        if line.startswith("PROG|"):
            self._on_progress(item, line)
            return
        m = FORMATS_LINE_RE.search(line)
        if m:
            item._parts_total = len(m.group(1).split("+"))
            return
        if line.startswith("[download] Destination:"):
            item._parts_seen += 1
            return
        for prefix, stage in POSTPROCESSOR_STAGES:
            if line.startswith(prefix) and stage in item.steps:
                item.touch(stage=stage, stage_percent=None, speed=None, eta=None,
                           percent=max(item.percent, STAGE_FLOOR[stage]))
                return

    def _on_progress(self, item: Item, line: str):
        # PROG|status|downloaded|total|total_estimate|speed|eta
        parts = line.split("|")
        if len(parts) < 7:
            return

        def num(value: str) -> Optional[float]:
            try:
                return float(value)
            except ValueError:  # "NA" / "None"
                return None

        downloaded, total, estimate = num(parts[2]), num(parts[3]), num(parts[4])
        total = total or estimate
        frac = min(downloaded / total, 1.0) if downloaded and total else None
        share = 85.0 if item.kind == "video" else 75.0
        parts_total = max(item._parts_total, item._parts_seen, 1)
        part_index = max(item._parts_seen - 1, 0)
        overall = item.percent
        if frac is not None:
            overall = max(item.percent, share * (part_index + frac) / parts_total)
        item.touch(stage=item.steps[0], stage_percent=None if frac is None else frac * 100,
                   percent=min(overall, share), speed=num(parts[5]), eta=num(parts[6]), downloaded=downloaded)

    # ---- clips -------------------------------------------------------------

    def _clip_settings(self, item: Item, clip: Clip) -> Tuple[str, int, int]:
        """Effective (type, quality, bitrate) for a clip. Merged output forces the item's settings."""
        if item.output == "merged":
            return item.kind, item.quality, item.bitrate
        return clip.type or item.kind, clip.quality or item.quality, clip.bitrate or item.bitrate

    async def _run_clips(self, item: Item):
        total_seconds = sum(c.length for c in item.clips) or 1.0
        cut_share = 97.0 if len(item.clips) == 1 else 90.0
        done_seconds = [0.0]

        # One yt-dlp run per distinct format (rows can override type/quality).
        groups: Dict[Tuple[str, int, int], List[Clip]] = {}
        for clip in item.clips:
            groups.setdefault(self._clip_settings(item, clip), []).append(clip)

        for g, ((kind, quality, bitrate), clips) in enumerate(groups.items()):
            folder = item.folder / f"g{g}"
            folder.mkdir(parents=True, exist_ok=True)
            # Identical ranges are downloaded once and copied afterwards.
            sections = list(dict.fromkeys((c.start, c.end) for c in clips))
            args = ytdlp.build_download_args(item.link, folder, kind, quality, bitrate, sections)
            state = {"current": None}

            def on_line(line: str, clips=clips, state=state):
                m = DESTINATION_RE.match(line)
                if m:
                    self._clip_finished(state["current"], done_seconds)
                    clip = self._match_section(Path(m.group(1)).name, clips)
                    state["current"] = clip
                    if clip:
                        clip.status = "running"
                        item.touch(stage="cut", stage_percent=0.0)
                    return
                m = FFMPEG_TIME_RE.search(line)
                current = state["current"]
                if m and current:
                    t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                    frac = min(t / max(current.length, 0.1), 1.0)
                    current.percent = frac * 100
                    overall = cut_share * (done_seconds[0] + frac * current.length) / total_seconds
                    item.touch(stage_percent=frac * 100, percent=max(item.percent, min(overall, cut_share)))
                elif line.startswith("PROG|") and current is None:
                    self._on_progress(item, line)

            code, tail = await self._exec(item, args, on_line)
            self._clip_finished(state["current"], done_seconds)

            # Map "<id>_<start>_<end>.<ext>" files back to clips.
            for f in folder.iterdir():
                m = SECTION_FILE_RE.search(f.name)
                if not m or f.suffix.lower() in (".jpg", ".webp", ".png", ".part", ".ytdl"):
                    continue
                s, e = float(m.group(1)), float(m.group(2))
                for clip in clips:
                    if abs(clip.start - s) < 0.01 and abs(clip.end - e) < 0.01:
                        clip.file = f
            missing = [c for c in clips if not c.file]
            for c in clips:
                c.status = "done" if c.file else "error"
                c.percent = 100.0 if c.file else c.percent
            item.touch()
            if code != 0 or missing:
                log.warning("job %s clip group failed:\n%s", item.id, tail)
                raise StepError(friendly_error(tail) if code != 0 else
                                f"{len(missing)} clip(s) could not be cut.")

        await self._deliver_clips(item)

    @staticmethod
    def _match_section(filename: str, clips: List[Clip]) -> Optional[Clip]:
        m = SECTION_FILE_RE.search(filename)
        if not m:
            return None
        s, e = float(m.group(1)), float(m.group(2))
        return next((c for c in clips if abs(c.start - s) < 0.01 and abs(c.end - e) < 0.01
                     and c.status != "done"), None)

    @staticmethod
    def _clip_finished(clip: Optional[Clip], done_seconds: list):
        if clip and clip.status == "running":
            clip.status, clip.percent = "done", 100.0
            done_seconds[0] += clip.length

    def _clip_filename(self, item: Item, clip: Clip, ext: str) -> str:
        label = clip.name.strip() or clip_label(clip.start, clip.end)
        return sanitize_filename(f"{item.title} - {label}", 150) + ext

    async def _deliver_clips(self, item: Item):
        clips = item.clips
        if len(clips) > 1 and item.output == "merged":
            item.touch(stage="join", stage_percent=None, percent=max(item.percent, 90.0))
            ext = ".mp4" if item.kind == "video" else ".mp3"
            out = item.folder / f"merged{ext}"
            how = await asyncio.to_thread(
                media.merge_clips, [c.file for c in clips], out, item.kind, item.fade, item.bitrate,
                {"title": item.title, "artist": item.info.get("channel", "")},
            )
            log.info("job %s merged %d clips (%s)", item.id, len(clips), how)
            name = sanitize_filename(f"{item.title} - merged {len(clips)} clips", 150) + ext
            item.parts = [(out, name)]
            item.file_path, item.download_name = out, name
            return

        taken: set = set()
        item.parts = [(c.file, unique_name(self._clip_filename(item, c, c.file.suffix.lower()), taken))
                      for c in clips]
        if len(item.parts) == 1:
            item.file_path, item.download_name = item.parts[0]
            return
        item.touch(stage="zip", stage_percent=None, percent=max(item.percent, 95.0))
        out = item.folder / "clips.zip"
        await asyncio.to_thread(media.zip_files, item.parts, out)
        item.file_path = out
        item.download_name = sanitize_filename(f"{item.title} - {len(clips)} clips", 150) + ".zip"

    # ---- Instagram originals (images / carousels / stories) ---------------

    async def _run_media(self, item: Item):
        info = item.info
        all_media = info.get("media") or []
        indices = item.media_indices or [m["index"] for m in all_media]
        chosen = [m for m in all_media if m["index"] in indices]
        if not chosen:
            raise StepError("Choose at least one item to download.")
        files: Dict[int, Path] = {}
        progress = {"n": 0}

        def bump(_line: str = ""):
            progress["n"] += 1
            item.touch(stage="download", stage_percent=None,
                       percent=min(90.0, 90.0 * progress["n"] / len(chosen)))

        if info.get("source") == "gallery-dl":
            args = ytdlp.build_gallerydl_args(item.link, item.folder, indices)
            # gallery-dl prints one path per finished file.
            code, tail = await self._exec(item, args, lambda line: bump() if item.folder.name in line else None)
            by_media_id = {m.get("media_id"): m["index"] for m in chosen}
            for f in item.folder.iterdir():
                if f.stem in by_media_id:
                    files[by_media_id[f.stem]] = f
            if code != 0 and not files:
                raise StepError(friendly_error(tail))
        else:
            videos = [m["index"] for m in chosen if m["type"] == "video"]
            if videos:
                args = ytdlp.build_ytdlp_playlist_args(item.link, item.folder, videos)
                code, tail = await self._exec(
                    item, args, lambda line: bump() if line.startswith("[download] Destination:") else None)
                if code != 0:
                    raise StepError(friendly_error(tail))
                for f in item.folder.iterdir():
                    if f.stem.isdigit() and int(f.stem) in videos and f.suffix.lower() in (".mp4", ".mkv", ".webm"):
                        files[int(f.stem)] = f
            for m in chosen:
                if m["type"] == "image" and m.get("url"):
                    dest = item.folder / f"img{m['index']}.jpg"
                    try:
                        await asyncio.to_thread(media.http_download, m["url"], dest)
                    except Exception as exc:  # noqa: BLE001
                        raise StepError(f"Couldn't download image {m['index']}: {exc}")
                    files[m["index"]] = dest
                    bump()

        missing = [m["index"] for m in chosen if m["index"] not in files]
        if missing and not files:
            raise StepError("Nothing could be downloaded from this post.")

        user = info.get("channel") or "instagram"
        base = sanitize_filename(f"{user} - {item.link.id.replace('/', '-')}", 120)
        taken: set = set()
        ordered = sorted(files.items())
        if len(ordered) == 1:
            index, path = ordered[0]
            name = unique_name(base + path.suffix.lower(), taken)
            item.parts = [(path, name)]
            item.file_path, item.download_name = path, name
        else:
            item.parts = [(p, unique_name(f"{base} - {i:02d}{p.suffix.lower()}", taken)) for i, p in ordered]
            item.touch(stage="zip", percent=95.0)
            out = item.folder / "media.zip"
            await asyncio.to_thread(media.zip_files, item.parts, out)
            item.file_path, item.download_name = out, base + ".zip"
        if missing:
            item.note = f"{len(missing)} item(s) couldn't be downloaded: #{', #'.join(map(str, missing))}"

    # ---- output helpers ---------------------------------------------------

    @staticmethod
    def _find_output(folder: Path, kind: str) -> Optional[Path]:
        wanted = ".mp4" if kind == "video" else ".mp3"
        files = [p for p in folder.glob("*") if p.is_file()]
        exact = [p for p in files if p.suffix.lower() == wanted]
        pool = exact or [p for p in files if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mp3", ".m4a")]
        return max(pool, key=lambda p: p.stat().st_size) if pool else None

    async def batch_zip(self, batch: Batch) -> Optional[Path]:
        """Build (or reuse) one ZIP with every finished item of a batch."""
        # Keep each item's position in the batch, so folder "03 - ..." is always item 3.
        items = [(n, self.jobs[i]) for n, i in enumerate(batch.item_ids, start=1)
                 if i in self.jobs and self.jobs[i].status == "done"]
        if not items:
            return None
        key = tuple((i.id, i.version) for _, i in items)
        async with self._zip_lock:
            if batch.zip_key == key and batch.zip_path and batch.zip_path.is_file():
                return batch.zip_path
            entries, taken = [], set()
            for n, item in items:
                folder = sanitize_filename(f"{n:02d} - {item.title}", 80)
                for path, name in item.parts:
                    entries.append((path, unique_name(f"{folder}/{name}", taken)))
            batch.folder.mkdir(parents=True, exist_ok=True)
            out = batch.folder / "batch.zip"
            await asyncio.to_thread(media.zip_files, entries, out)
            batch.zip_path, batch.zip_key = out, key
            return out

    # ---- cleanup ----------------------------------------------------------

    async def _cleanup_loop(self):
        while True:
            try:
                self.cleanup()
            except Exception:  # noqa: BLE001
                log.exception("cleanup failed")
            await asyncio.sleep(config.CLEANUP_INTERVAL_SECONDS)

    def cleanup(self):
        now = time.time()
        for item in list(self.jobs.values()):
            if now - item.created > config.FILE_TTL_SECONDS:
                self._kill(item)
                shutil.rmtree(item.folder, ignore_errors=True)
                self.jobs.pop(item.id, None)
                log.info("expired job %s", item.id)
        for batch in list(self.batches.values()):
            if now - batch.created > config.FILE_TTL_SECONDS:
                shutil.rmtree(batch.folder, ignore_errors=True)
                self.batches.pop(batch.id, None)


manager = JobManager()
