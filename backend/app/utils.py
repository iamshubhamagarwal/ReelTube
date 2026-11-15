"""
Small pure helpers (no I/O), all covered by tests/test_utils.py:

- link detection: YouTube + Instagram URL parsing / normalisation
- time parsing and formatting
- clip lists: bulk-paste parsing, validation, overlap detection, file labels
- filename sanitising and friendly error messages
"""
import re
import unicodedata
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qs, urlparse

# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
IG_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{5,64}$")

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
}
SHORT_HOSTS = {"youtu.be", "www.youtu.be"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"}


@dataclass(frozen=True)
class Link:
    platform: str   # "youtube" | "instagram"
    kind: str       # youtube: "video"; instagram: "post" | "reel" | "story" | "highlight"
    id: str         # YouTube video ID, Instagram shortcode / story ID
    url: str        # clean canonical URL (no tracking or playlist params)

    @property
    def cache_key(self) -> str:
        return f"{self.platform}:{self.kind}:{self.id}"


def _with_scheme(url: str) -> str:
    url = (url or "").strip()
    return url if re.match(r"^https?://", url, re.I) else "https://" + url


def extract_video_id(url: str) -> Optional[str]:
    """
    Return the 11-character YouTube video ID from any common URL, or None.
    watch?v= (playlist params dropped), m.youtube.com, youtu.be, /shorts/,
    /embed/, /live/, /v/ — or a bare ID.
    """
    url = (url or "").strip()
    if not url:
        return None
    if VIDEO_ID_RE.match(url):
        return url
    try:
        parsed = urlparse(_with_scheme(url))
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    parts = [p for p in parsed.path.split("/") if p]

    candidate = None
    if host in SHORT_HOSTS:
        candidate = parts[0] if parts else None
    elif host in YOUTUBE_HOSTS:
        if parsed.path.rstrip("/") == "/watch":
            candidate = parse_qs(parsed.query).get("v", [None])[0]
        elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v", "e"):
            candidate = parts[1]
    return candidate if candidate and VIDEO_ID_RE.match(candidate) else None


def canonical_url(video_id: str) -> str:
    """A clean YouTube watch URL."""
    return f"https://www.youtube.com/watch?v={video_id}"


def parse_instagram(url: str) -> Optional[Link]:
    """
    Instagram links we accept (query strings like ?igsh= are dropped):
      /p/CODE/, /reel/CODE/, /reels/CODE/, /tv/CODE/
      /<username>/p/CODE/, /<username>/reel/CODE/       (newer share format)
      /stories/<username>/<id>/                          (needs cookies)
      /stories/highlights/<id>/, /s/<id>                 (needs cookies)
    """
    try:
        parsed = urlparse(_with_scheme(url))
    except ValueError:
        return None
    if (parsed.hostname or "").lower() not in INSTAGRAM_HOSTS:
        return None
    parts = [p for p in parsed.path.split("/") if p]

    # Drop a leading username in /<user>/p/CODE style links.
    if len(parts) >= 3 and parts[1] in ("p", "reel", "reels", "tv"):
        parts = parts[1:]

    if len(parts) >= 2 and parts[0] in ("p", "tv") and IG_CODE_RE.match(parts[1]):
        return Link("instagram", "post", parts[1], f"https://www.instagram.com/p/{parts[1]}/")
    if len(parts) >= 2 and parts[0] in ("reel", "reels") and IG_CODE_RE.match(parts[1]):
        return Link("instagram", "reel", parts[1], f"https://www.instagram.com/reel/{parts[1]}/")
    if len(parts) >= 3 and parts[0] == "stories" and parts[1] == "highlights" and parts[2].isdigit():
        return Link("instagram", "highlight", parts[2], f"https://www.instagram.com/stories/highlights/{parts[2]}/")
    if len(parts) >= 2 and parts[0] == "stories" and parts[1] != "highlights":
        user = parts[1]
        if len(parts) >= 3 and parts[2].isdigit():
            return Link("instagram", "story", f"{user}/{parts[2]}",
                        f"https://www.instagram.com/stories/{user}/{parts[2]}/")
        return Link("instagram", "story", user, f"https://www.instagram.com/stories/{user}/")
    if len(parts) >= 2 and parts[0] == "s" and IG_CODE_RE.match(parts[1]):
        return Link("instagram", "highlight", parts[1], f"https://www.instagram.com/s/{parts[1]}/")
    return None


def parse_link(url: str) -> Optional[Link]:
    """Detect the platform of a pasted link. Returns None if unsupported."""
    video_id = extract_video_id(url)
    if video_id:
        return Link("youtube", "video", video_id, canonical_url(video_id))
    return parse_instagram(url)


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------

TIME_PATTERN = r"\d+(?::\d{1,2}){0,2}(?:\.\d+)?"


def parse_time(value: Union[str, int, float, None]) -> Optional[float]:
    """
    Parse "HH:MM:SS", "MM:SS", "SS" (optionally with .fraction) or a number of
    seconds. Returns seconds as float, or None for empty input.
    Raises ValueError for malformed input.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("Invalid time")
    if isinstance(value, (int, float)):
        if value < 0 or value != value:  # negative or NaN
            raise ValueError("Time cannot be negative")
        return float(value)

    text = str(value).strip()
    if not text:
        return None
    if not re.fullmatch(TIME_PATTERN, text):
        raise ValueError(f"Invalid time '{text}'. Use HH:MM:SS or MM:SS.")

    pieces = text.split(":")
    seconds = float(pieces[-1])
    minutes = int(pieces[-2]) if len(pieces) >= 2 else 0
    hours = int(pieces[-3]) if len(pieces) == 3 else 0
    if len(pieces) >= 2 and (seconds >= 60 or (len(pieces) == 3 and minutes >= 60)):
        raise ValueError(f"Invalid time '{text}': minutes and seconds must be below 60.")
    return hours * 3600 + minutes * 60 + seconds


def format_time(seconds: float) -> str:
    """3723.5 -> '1:02:03.5', 130 -> '2:10'."""
    seconds = max(0.0, float(seconds))
    whole = int(seconds)
    frac = round(seconds - whole, 3)
    h, rem = divmod(whole, 3600)
    m, s = divmod(rem, 60)
    out = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    if frac:
        out += f"{frac:.3f}".lstrip("0").rstrip("0").rstrip(".")
    return out


def section_time(seconds: float) -> str:
    """Seconds formatted for yt-dlp's --download-sections (plain seconds)."""
    return f"{seconds:.3f}".rstrip("0").rstrip(".")


def clip_label(start: float, end: float) -> str:
    """Filename-safe range label: 2073, 2203 -> '34m33s-36m43s'; hours -> '1h12m05s'."""
    def one(sec: float) -> str:
        whole = int(sec)
        frac = round(sec - whole, 1)
        h, rem = divmod(whole, 3600)
        m, s = divmod(rem, 60)
        s_txt = f"{s + frac:04.1f}" if frac else f"{s:02d}"
        if h:
            return f"{h}h{m:02d}m{s_txt}s"
        return f"{m}m{s_txt}s"
    return f"{one(start)}-{one(end)}"


# ---------------------------------------------------------------------------
# Clip lists
# ---------------------------------------------------------------------------

# "34:33 - 36:43", "1:02:10 to 1:03:00 Intro part", "2:10–3:45: Chorus"
CLIP_LINE_RE = re.compile(
    rf"^\s*(?:[-*•]\s+|\d+[.)]\s+)?"            # optional bullet / "1." / "1)"
    rf"({TIME_PATTERN})\s*(?:-|–|—|to|TO|To)\s*({TIME_PATTERN})"
    rf"(?:\s*[-–—:|]?\s*(.*?))?\s*$"
)


def parse_clip_line(line: str) -> Optional[Dict]:
    """
    Parse one bulk-paste line into {"start", "end", "name"}.
    Returns None for blank lines; raises ValueError for unparseable ones.
    """
    if not line or not line.strip():
        return None
    m = CLIP_LINE_RE.match(line)
    if not m:
        raise ValueError(f"Couldn't read '{line.strip()}'. Use e.g. 34:33 - 36:43 Name")
    start = parse_time(m.group(1))
    end = parse_time(m.group(2))
    name = (m.group(3) or "").strip()
    return {"start": start, "end": end, "name": name}


def parse_clip_lines(text: str) -> Tuple[List[Dict], List[str]]:
    """Parse a multi-line paste. Returns (clips, errors) with 1-based line numbers in errors."""
    clips, errors = [], []
    for number, line in enumerate((text or "").splitlines(), start=1):
        try:
            clip = parse_clip_line(line)
        except ValueError as exc:
            errors.append(f"Line {number}: {exc}")
            continue
        if clip:
            clips.append(clip)
    return clips, errors


def validate_clip(start: Optional[float], end: Optional[float], duration: Optional[float]) -> Optional[str]:
    """Return a friendly error for one clip, or None if it's valid."""
    if start is None or end is None:
        return "Enter both a start and an end time."
    if start < 0:
        return "Start can't be negative."
    if end <= start:
        return "End must be after start."
    if duration:
        if start >= duration:
            return f"Start is past the end of the video ({format_time(duration)})."
        if end > duration + 1:
            return f"End is past the end of the video ({format_time(duration)})."
    if end - start < 0.5:
        return "A clip must be at least 0.5 seconds long."
    return None


def find_overlaps(clips: List[Dict]) -> List[Tuple[int, int]]:
    """Index pairs (i, j), i < j, of clips whose time ranges overlap."""
    pairs = []
    for i in range(len(clips)):
        for j in range(i + 1, len(clips)):
            a, b = clips[i], clips[j]
            if a["start"] < b["end"] and b["start"] < a["end"]:
                pairs.append((i, j))
    return pairs


# ---------------------------------------------------------------------------
# Filenames & errors
# ---------------------------------------------------------------------------

def sanitize_filename(name: str, max_len: int = 120) -> str:
    """
    Make a string safe as a filename on Windows/macOS/Linux:
    strips control chars and reserved characters, collapses whitespace,
    trims trailing dots/spaces and caps the length. Unicode letters are kept.
    """
    name = unicodedata.normalize("NFC", name or "")
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r'[\\/:*?"<>|]', " ", name)
    name = re.sub(r"\s+", " ", name).strip().strip(".")
    if len(name) > max_len:
        name = name[:max_len].rstrip(" .")
    if name.upper() in {"CON", "PRN", "AUX", "NUL"} or re.match(r"^(COM|LPT)\d$", name.upper()):
        name = "_" + name
    return name or "download"


def unique_name(name: str, taken: set) -> str:
    """'a.mp4' -> 'a (2).mp4' if 'a.mp4' is already in `taken` (case-insensitive). Adds result to taken."""
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    candidate, n = name, 2
    while candidate.lower() in taken:
        candidate = f"{stem} ({n}).{ext}" if ext else f"{stem} ({n})"
        n += 1
    taken.add(candidate.lower())
    return candidate


RATE_LIMIT_RE = re.compile(r"429|too many requests|rate.?limit|please wait a few minutes|try again later", re.I)

# Patterns in yt-dlp / gallery-dl output -> friendly message. First match wins.
_ERROR_MAP = [
    (r"confirm your age|age[- ]restricted|inappropriate for some users",
     "This video is age-restricted. The server admin needs to add a cookies.txt file from a logged-in account to download it."),
    (r"private video", "This video is private."),
    (r"members[- ]only|join this channel", "This video is for channel members only."),
    # Instagram
    (r"redirect to login|login required|requires? (a )?log ?in|empty media response|not logged in|login_required",
     "Instagram requires a login to see this. The server admin needs to add an Instagram cookies.txt."),
    (r"this account is private|private (account|profile)",
     "This Instagram account is private. Only content visible to the admin's cookie account can be downloaded."),
    (r"no video in this post", "This Instagram post has no video. Choose 'Images' to download the pictures."),
    (r"(user|post|media).*(could not be found|not found|unavailable)|HTTP Error 404",
     "That Instagram post or account doesn't exist or was deleted."),
    # Rate limits (both platforms)
    (r"not a bot|429|too many requests|rate.?limit|please wait a few minutes",
     "The site is rate-limiting this server. Please try again in a few minutes."),
    (r"unable to obtain file audio codec|does not contain any stream|Output file .* does not contain",
     "This video has no sound, so it can't be saved as MP3."),
    (r"403 Forbidden|HTTP Error 403",
     "The site refused the download (HTTP 403). Retry in a moment; if it keeps happening, the admin should update yt-dlp."),
    (r"premiere|will begin|is upcoming|this live event", "This video is an upcoming premiere or live event and can't be downloaded yet."),
    (r"live stream|is live", "Live streams can't be downloaded until they have ended."),
    (r"copyright", "This video has been removed for copyright reasons."),
    (r"not available in your country|geo.?restrict", "This video isn't available in the server's country."),
    (r"video unavailable|has been removed|does not exist|account .* terminated", "This video is unavailable."),
    (r"requested format is not available", "That quality isn't available for this video. Pick another one."),
    (r"ffmpeg.*not found|ffprobe.*not found", "Server error: ffmpeg is not installed."),
    (r"max-filesize|larger than max-filesize|File is larger", "The file is larger than this server allows."),
    (r"unable to extract|signature|nsig|player response|js runtime|n challenge",
     "The site changed something and the downloader needs an update. Admin: run the yt-dlp update."),
]


def friendly_error(output: str) -> str:
    text = output or ""
    for pattern, message in _ERROR_MAP:
        if re.search(pattern, text, re.I):
            return message
    # Fall back to the last "ERROR:" line, trimmed.
    errors = [ln for ln in text.splitlines() if "ERROR" in ln or "error" in ln[:20].lower()]
    if errors:
        msg = re.sub(r"^.*?ERROR:\s*(\[[^\]]+\]\s*\S+:\s*)?", "", errors[-1]).strip()
        return msg[:300] or "Download failed."
    return "Something went wrong while processing this link."
