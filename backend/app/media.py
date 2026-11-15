"""
Local media operations with ffmpeg / ffprobe, plus ZIP packaging and simple
HTTP downloads. Everything here is blocking: call it from a worker thread.
"""
import json
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import config

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


class MediaError(Exception):
    pass


def _run(args: List[str], timeout: int = 1800) -> subprocess.CompletedProcess:
    proc = subprocess.run(args, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace")[-1500:]
        raise MediaError(f"ffmpeg failed: {tail}")
    return proc


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------

def probe(path_or_url: str, timeout: int = 30) -> Dict:
    """Return {'duration', 'video': {...} | None, 'audio': {...} | None}."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,disposition:format=duration",
         "-of", "json", str(path_or_url)],
        capture_output=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise MediaError(proc.stderr.decode("utf-8", "replace")[-300:])
    data = json.loads(proc.stdout or b"{}")
    streams = data.get("streams", [])
    # Ignore cover-art "video" streams in MP3s.
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {"duration": duration, "video": video, "audio": audio}


def probe_basic(url: str) -> Tuple[Optional[float], Optional[bool]]:
    """(duration, has_audio) of a remote/local media file; (None, None) if ffprobe can't tell."""
    try:
        info = probe(url)
        return info.get("duration") or None, info.get("audio") is not None
    except Exception:  # noqa: BLE001 - optional info
        return None, None


def _signature(info: Dict) -> Tuple:
    """Stream parameters that must match for a lossless concat."""
    v, a = info.get("video") or {}, info.get("audio") or {}
    return (v.get("codec_name"), v.get("width"), v.get("height"), v.get("r_frame_rate"),
            a.get("codec_name"), a.get("sample_rate"), a.get("channels"))


# ---------------------------------------------------------------------------
# Joining clips
# ---------------------------------------------------------------------------

def _concat_list(files: List[Path], folder: Path) -> Path:
    listing = folder / "concat.txt"
    lines = []
    for f in files:
        escaped = str(f.resolve()).replace("\\", "/").replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return listing


def merge_clips(files: List[Path], out: Path, kind: str, fade: bool, bitrate: int = 192,
                metadata: Optional[Dict[str, str]] = None) -> str:
    """
    Join clips (in order) into `out`.

    - No fade and identical stream parameters -> concat demuxer with stream
      copy (fast, lossless). Clips cut from the same video at the same quality
      normally qualify.
    - Otherwise (fade requested, or clips differ) -> re-encode through ffmpeg's
      concat filter, normalising resolution/fps/sample rate so segments match.
    Returns "copy" or "reencode" (useful for logs/tests).
    """
    if not files:
        raise MediaError("Nothing to merge.")
    infos = [probe(str(f)) for f in files]
    meta_args = []
    for key, value in (metadata or {}).items():
        if value:
            meta_args += ["-metadata", f"{key}={value}"]

    uniform = len({_signature(i) for i in infos}) == 1
    if not fade and uniform:
        listing = _concat_list(files, out.parent)
        if kind == "video":
            args = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart",
                    *meta_args, str(out)]
        else:
            # Keep the first clip's cover art (attached picture) on the merged MP3.
            args = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-i", str(files[0]), "-map", "0:a:0", "-map", "1:v:0?", "-c", "copy",
                    "-disposition:v", "attached_pic", "-id3v2_version", "3", *meta_args, str(out)]
        try:
            _run(args)
            return "copy"
        except MediaError:
            pass  # fall through to re-encode
        finally:
            listing.unlink(missing_ok=True)

    _merge_reencode(files, infos, out, kind, fade, bitrate, meta_args)
    return "reencode"


def _merge_reencode(files, infos, out: Path, kind: str, fade: bool, bitrate: int, meta_args):
    half = config.MERGE_FADE_SECONDS / 2 if fade else 0  # fade-out + fade-in = full fade
    n = len(files)
    inputs: List[str] = []
    for f in files:
        inputs += ["-i", str(f)]

    # Clips without audio get generated silence so the concat filter lines up.
    extra_index = n
    audio_labels = []
    chains = []
    has_video = kind == "video"
    if has_video:
        first_v = next((i["video"] for i in infos if i.get("video")), None) or {}
        w = int(first_v.get("width") or 1280) // 2 * 2
        h = int(first_v.get("height") or 720) // 2 * 2
        fps = first_v.get("r_frame_rate") or "30"

    for idx, info in enumerate(infos):
        dur = max(info.get("duration") or 0, 0.1)
        fade_in = half if idx > 0 else 0
        fade_out = half if idx < n - 1 else 0

        if has_video:
            v = (f"[{idx}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                 f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p")
            if fade_in:
                v += f",fade=t=in:st=0:d={fade_in}"
            if fade_out:
                v += f",fade=t=out:st={max(dur - fade_out, 0):.3f}:d={fade_out}"
            chains.append(v + f"[v{idx}]")

        if info.get("audio"):
            a_src = f"[{idx}:a:0]"
        else:
            inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
            a_src = f"[{extra_index}:a:0]"
            extra_index += 1
        a = f"{a_src}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
        if fade_in:
            a += f",afade=t=in:st=0:d={fade_in}"
        if fade_out:
            a += f",afade=t=out:st={max(dur - fade_out, 0):.3f}:d={fade_out}"
        chains.append(a + f"[a{idx}]")
        audio_labels.append(f"[a{idx}]")

    if has_video:
        pairs = "".join(f"[v{i}][a{i}]" for i in range(n))
        chains.append(f"{pairs}concat=n={n}:v=1:a=1[v][a]")
        args = ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(chains),
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", *meta_args, str(out)]
    else:
        chains.append(f"{''.join(audio_labels)}concat=n={n}:v=0:a=1[a]")
        cover = ["-i", str(files[0])]
        cover_idx = extra_index
        args = ["ffmpeg", "-y", "-v", "error", *inputs, *cover, "-filter_complex", ";".join(chains),
                "-map", "[a]", "-map", f"{cover_idx}:v:0?", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k",
                "-c:v", "copy", "-disposition:v", "attached_pic", "-id3v2_version", "3",
                *meta_args, str(out)]
    _run(args)


# ---------------------------------------------------------------------------
# ZIP + HTTP
# ---------------------------------------------------------------------------

def zip_files(entries: List[Tuple[Path, str]], out: Path) -> Path:
    """
    Write (path, name-inside-zip) pairs into `out`. Media is already compressed,
    so files are STORED (no recompression = fast). ZIP64 handles >4 GB.
    """
    tmp = out.with_suffix(".zip.tmp")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for path, arcname in entries:
            zf.write(path, arcname)
    tmp.replace(out)
    return out


def http_download(url: str, dest: Path, max_bytes: Optional[int] = None, timeout: int = 60) -> Path:
    """Download a URL to `dest` (used for Instagram images when gallery-dl isn't available)."""
    max_bytes = max_bytes or config.MAX_FILESIZE_MB * 1024 * 1024
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Referer": "https://www.instagram.com/"})
    total = 0
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as fh:
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise MediaError("The file is larger than this server allows.")
            fh.write(chunk)
    return dest


def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
