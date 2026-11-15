"""
Tests for the pure helpers: timestamp parsing, bulk clip-list parsing,
clip validation, overlap detection, link detection and filename labels.

Run:  cd backend && python -m pytest -q
"""
import pytest

from app.utils import (
    clip_label, find_overlaps, format_time, parse_clip_line, parse_clip_lines, parse_link,
    parse_time, sanitize_filename, unique_name, validate_clip,
)


# ---------------------------------------------------------------------------
# parse_time
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text, seconds", [
    ("0", 0),
    ("45", 45),
    ("90", 90),                 # plain seconds may exceed 59
    ("2:10", 130),
    ("02:10", 130),
    ("34:33", 34 * 60 + 33),
    ("1:02:03", 3723),
    ("01:02:03", 3723),
    ("1:12:05", 4325),
    ("10:00:00", 36000),
    ("34:33.5", 2073.5),
    ("1:02:03.25", 3723.25),
    ("  3:45  ", 225),
    ("120:00", 7200),           # MM:SS with minutes > 59 is allowed
])
def test_parse_time_valid(text, seconds):
    assert parse_time(text) == pytest.approx(seconds)


@pytest.mark.parametrize("value, seconds", [(0, 0.0), (12, 12.0), (12.5, 12.5)])
def test_parse_time_numbers(value, seconds):
    assert parse_time(value) == seconds


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_parse_time_empty(empty):
    assert parse_time(empty) is None


@pytest.mark.parametrize("bad", [
    "abc", "1:2:3:4", "34:75", "1:75:00", "1:00:60", "-5", "1:", ":30", "1::30",
    "1.2.3", "12m30s", "1:2:3.4.5",
])
def test_parse_time_invalid(bad):
    with pytest.raises(ValueError):
        parse_time(bad)


def test_parse_time_negative_number():
    with pytest.raises(ValueError):
        parse_time(-1)


@pytest.mark.parametrize("seconds, text", [
    (0, "0:00"), (130, "2:10"), (2073, "34:33"), (3723, "1:02:03"), (3723.5, "1:02:03.5"),
])
def test_format_time(seconds, text):
    assert format_time(seconds) == text


# ---------------------------------------------------------------------------
# Bulk paste lines
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("line, start, end, name", [
    ("34:33 - 36:43", 2073, 2203, ""),
    ("34:33-36:43", 2073, 2203, ""),
    ("1:02:10 - 1:03:00 Intro part", 3730, 3780, "Intro part"),
    ("02:10 to 03:45", 130, 225, ""),
    ("2:10 TO 3:45 Chorus", 130, 225, "Chorus"),
    ("2:10 – 3:45", 130, 225, ""),            # en dash
    ("2:10—3:45 Bridge", 130, 225, "Bridge"),  # em dash, no spaces
    ("1:12:05 - 1:14:30", 4325, 4470, ""),
    ("34:33 - 36:43 - Best bit", 2073, 2203, "Best bit"),
    ("34:33 - 36:43: Best bit", 2073, 2203, "Best bit"),
    ("  - 0:10 - 0:20 bullet  ", 10, 20, "bullet"),
    ("1. 0:10 - 0:20 numbered", 10, 20, "numbered"),
    ("10 - 20", 10, 20, ""),
    ("0:05.5 - 0:07.25 fractions", 5.5, 7.25, "fractions"),
    ("1:00 - 2:00 5 tips for 2025", 60, 120, "5 tips for 2025"),
])
def test_parse_clip_line(line, start, end, name):
    clip = parse_clip_line(line)
    assert clip["start"] == pytest.approx(start)
    assert clip["end"] == pytest.approx(end)
    assert clip["name"] == name


def test_parse_clip_line_blank():
    assert parse_clip_line("   ") is None


@pytest.mark.parametrize("bad", ["hello", "34:33", "34:33 36:43", "34:33 ~ 36:43", "1:75 - 2:00"])
def test_parse_clip_line_invalid(bad):
    with pytest.raises(ValueError):
        parse_clip_line(bad)


def test_parse_clip_lines_mixed():
    text = "34:33 - 36:43\n\n1:02:10 - 1:03:00 Intro part\nnot a clip\n2:10 to 3:45"
    clips, errors = parse_clip_lines(text)
    assert [(c["start"], c["end"], c["name"]) for c in clips] == [
        (2073, 2203, ""), (3730, 3780, "Intro part"), (130, 225, ""),
    ]
    assert len(errors) == 1 and errors[0].startswith("Line 4:")


# ---------------------------------------------------------------------------
# Clip validation
# ---------------------------------------------------------------------------

DURATION = 600.0  # a 10-minute video


@pytest.mark.parametrize("start, end", [(0, 10), (130, 225), (590, 600), (599.5, 600.5)])
def test_validate_clip_ok(start, end):
    assert validate_clip(start, end, DURATION) is None


@pytest.mark.parametrize("start, end, fragment", [
    (None, 10, "both"),
    (10, None, "both"),
    (20, 10, "after start"),
    (10, 10, "after start"),
    (-1, 10, "negative"),
    (600, 610, "past the end"),
    (500, 700, "past the end"),
    (10, 10.2, "at least"),
])
def test_validate_clip_errors(start, end, fragment):
    message = validate_clip(start, end, DURATION)
    assert message and fragment in message


def test_validate_clip_unknown_duration():
    # Instagram sometimes has no duration: only ordering rules apply.
    assert validate_clip(100, 5000, 0) is None
    assert validate_clip(50, 40, 0) is not None


def test_find_overlaps():
    clips = [
        {"start": 0, "end": 10},
        {"start": 5, "end": 15},    # overlaps 0
        {"start": 15, "end": 20},   # touches 1, no overlap
        {"start": 30, "end": 40},
        {"start": 32, "end": 35},   # inside 3
    ]
    assert find_overlaps(clips) == [(0, 1), (3, 4)]
    assert find_overlaps([]) == []


# ---------------------------------------------------------------------------
# Labels & names
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("start, end, label", [
    (2073, 2203, "34m33s-36m43s"),
    (130, 225, "2m10s-3m45s"),
    (4325, 4470, "1h12m05s-1h14m30s"),
    (5.5, 7, "0m05.5s-0m07s"),
])
def test_clip_label(start, end, label):
    assert clip_label(start, end) == label


def test_sanitize_and_unique():
    assert sanitize_filename('a/b:c*?"<>|  d.  ') == "a b c d"
    taken = set()
    assert unique_name("x.mp4", taken) == "x.mp4"
    assert unique_name("x.mp4", taken) == "x (2).mp4"
    assert unique_name("X.MP4", taken) == "X (3).MP4"


# ---------------------------------------------------------------------------
# Link detection
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url, platform, kind, ident, canonical", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&index=2", "youtube", "video", "dQw4w9WgXcQ",
     "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ("youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "video", "dQw4w9WgXcQ", None),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ", None),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ", None),
    ("https://www.instagram.com/p/BsOGulcndj-/?igsh=xyz", "instagram", "post", "BsOGulcndj-",
     "https://www.instagram.com/p/BsOGulcndj-/"),
    ("https://instagram.com/reel/CWqAgUZgCku", "instagram", "reel", "CWqAgUZgCku",
     "https://www.instagram.com/reel/CWqAgUZgCku/"),
    ("https://www.instagram.com/reels/CWqAgUZgCku/", "instagram", "reel", "CWqAgUZgCku", None),
    ("https://www.instagram.com/tv/B8hEvJjFbiK/", "instagram", "post", "B8hEvJjFbiK", None),
    ("https://www.instagram.com/someuser/p/BsOGulcndj-/", "instagram", "post", "BsOGulcndj-", None),
    ("https://www.instagram.com/stories/someuser/3123456789012345678/", "instagram", "story",
     "someuser/3123456789012345678", None),
    ("https://www.instagram.com/stories/highlights/17912345678901234/", "instagram", "highlight",
     "17912345678901234", None),
])
def test_parse_link(url, platform, kind, ident, canonical):
    link = parse_link(url)
    assert link is not None
    assert (link.platform, link.kind, link.id) == (platform, kind, ident)
    if canonical:
        assert link.url == canonical


@pytest.mark.parametrize("url", [
    "https://example.com/watch?v=dQw4w9WgXcQ", "hello", "https://www.instagram.com/", "https://www.instagram.com/someuser/",
])
def test_parse_link_rejects(url):
    assert parse_link(url) is None
