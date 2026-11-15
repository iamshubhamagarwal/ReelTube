# ReelTube

Paste a **YouTube or Instagram** link and download:

- the full video as **HD MP4** (360p–2160p on YouTube, best available on Instagram),
- **one or many clips** cut to the exact frame, as separate files in a ZIP or merged into one file,
- the audio as **MP3** with cover art and tags,
- **Instagram photos and carousels** in their original quality.

The **Batch** tab queues several links at once. Each link has its own clips and format. You get per-item progress, can retry any item that fails, and download everything as one combined ZIP.

The stack:

- **Backend:** Python FastAPI.
- **Engines:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [gallery-dl](https://github.com/mikf/gallery-dl), with ffmpeg for cutting and joining. Both engines run as subprocesses, so an update made through the admin endpoint takes effect on the next job without a restart.
- **Frontend:** React + Vite + Tailwind. It works on mobile and has dark mode.

> Only download content you own or have permission to use. Downloading other people's content may violate YouTube's or Instagram's Terms of Service.

---

## Features

### Single tab

1. Paste a link. A **YouTube / Instagram** badge appears as soon as the link is recognised. Click **Fetch** to see the thumbnail, title, channel or @username, duration, and for Instagram the caption and the number of items.
2. Pick **MP4** (with a quality) or **MP3** (128, 192 or 320 kbps). Each choice shows an estimated file size.
3. Optionally turn on **Cut clips**:
   - **Clip rows:** each clip has a Start, an End, an optional name and a delete button. Times accept `HH:MM:SS`, `MM:SS`, seconds and fractions (`34:33.5`).
   - **Player buttons:** "Set start = current time" and "Set end = current time" read the time from the embedded player. **▶ Preview** plays just that range.
   - **Shared timeline:** each clip is a coloured segment. Drag its edges to change the times, or drag the middle to move the whole clip. Overlapping clips are drawn on separate lanes. The handles also work with the keyboard: ←/→ moves 1 s, and Shift moves 10 s.
   - **Bulk paste:** paste lines such as the ones below.
     ```
     34:33 - 36:43
     1:02:10 - 1:03:00 Intro part
     2:10 to 3:45 Chorus
     ```
     The separators `-`, `–`, `—` and `to` all work, and bullets or "1." numbering are ignored. Lines that can't be read are reported with their line number.
   - **Checks:** every row is validated: the end must be after the start, and both must be within the video. Overlapping clips get a warning but are allowed.
   - **Output:** choose **Separate files** (one file per clip, delivered as a ZIP) or **Merged** (all clips joined in order, with an optional 0.5 s fade).
   - **Per-clip format:** with separate files, any row can use a different format, for example MP3 for one clip and 720p for another.
4. **Progress:** a live bar shows the stages (download and cut → join or ZIP), a chip per clip with its own progress, and a **Retry** button if something fails.

### Batch tab

- Paste several links at once, one per line. YouTube and Instagram can be mixed.
- Each link's info loads in turn. Click **Edit** on a link to set its format, clips or Instagram item selection.
- **Download all** sends everything as one batch. Items wait in the server queue (`MAX_CONCURRENT_JOBS` run at a time). Each item shows its own progress, a download link when it finishes, and **Retry** if it fails. Retrying one item doesn't restart the others.
- **Download all as ZIP** gives one archive with a folder per item, such as `01 - <title>/…`. If some items failed, the ZIP holds the ones that finished.

### Instagram

| Content | Without cookies | With Instagram cookies |
|---|---|---|
| Reels and single-video posts (MP4, MP3, clips) | ✅ via yt-dlp | ✅ |
| Carousels made only of videos | ✅ via yt-dlp | ✅ |
| Photos | ⚠️ low resolution only (Instagram serves at most ~584 px to logged-out visitors) | ✅ original quality via gallery-dl |
| Carousels with photos | ⚠️ photos may be missing or low resolution | ✅ |
| Stories, highlights, private accounts the cookie account follows | ❌ shows "needs a login" | ✅ |

- **MP3 and clip cutting** work for reels and single-video posts. Videos without sound are detected, and MP3 is turned off for them.
- **Carousels and stories:** choose individual items or **Select all**. Several items arrive as a ZIP.
- **Rate limits:** when Instagram rate-limits the server, the request is retried automatically after waiting 5 s, then 15 s, then 45 s. If it still fails, the user sees "The site is rate-limiting this server. Please try again in a few minutes."

---

## Project layout

```
yt-clipper/
├── backend/
│   ├── app/
│   │   ├── main.py       # FastAPI routes: info, download, batch, progress (SSE), files, admin
│   │   ├── jobs.py       # job queue: items, clips, batches, progress parsing, retry, cleanup
│   │   ├── ytdlp.py      # yt-dlp / gallery-dl commands, YouTube + Instagram info, update
│   │   ├── media.py      # ffmpeg merge (copy or re-encode + fades), probe, ZIP, HTTP download
│   │   ├── utils.py      # link detection, time + clip-list parsing, validation, names, errors
│   │   ├── ratelimit.py  # per-IP rate limiter
│   │   └── config.py     # all settings (env vars)
│   ├── tests/test_utils.py   # parser + validation tests (pytest)
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                     # Single / Batch tabs
│   │   ├── lib/clips.js, lib/time.js   # parsing, validation, payloads (+ *.test.js)
│   │   └── components/
│   │       ├── SingleTab.jsx, BatchTab.jsx
│   │       ├── ItemEditor.jsx          # format + clips or Instagram media picker
│   │       ├── ClipsEditor.jsx         # rows, bulk paste, output mode
│   │       ├── MultiTimeline.jsx       # shared draggable timeline
│   │       ├── ProgressPanel.jsx, BatchProgress.jsx
│   │       └── …
│   └── package.json
├── Dockerfile            # node build → python + ffmpeg + deno runtime
├── docker-compose.yml    # app (+ optional Caddy for HTTPS)
├── Caddyfile
└── .env.example
```

---

## Run locally

### Option A: Docker (easiest)

```bash
cp .env.example .env        # optional, edit settings
docker compose up -d --build
```

Open <http://localhost:8000>.

### Option B: Without Docker (for development)

Requirements:

- **Python 3.10+.**
- **Node.js 18+.**
- **ffmpeg** on your PATH. On Windows: `winget install Gyan.FFmpeg`. On macOS: `brew install ffmpeg`. On Debian/Ubuntu: `apt install ffmpeg`.
- **A JavaScript runtime for yt-dlp.** YouTube needs one. Install [Deno](https://deno.com) (recommended), or use Node and set `YTDLP_JS_RUNTIMES=node`.

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Only if you don't have Deno:  (PowerShell) $env:YTDLP_JS_RUNTIMES="node"   (bash) export YTDLP_JS_RUNTIMES=node
uvicorn app.main:app --reload --port 8000
```

**Frontend** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the backend on port 8000.

To serve everything from FastAPI on port 8000 without Vite, run `npm run build` once.

### Tests

The tests cover the timestamp parser (all formats and separators), bulk-paste parsing, clip validation, overlap detection, filename labels, link detection and request building.

```bash
cd backend && pip install -r requirements-dev.txt && python -m pytest -q    # 94 tests
cd frontend && npm test                                                    # 13 test groups, Node's built-in runner
```

---

## API

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/info` | `{url}` → platform, title, channel, duration, thumbnail, `qualities[]`, `audio[]`. Instagram adds `caption`, `media[]`, `media_count`, `is_video`, `has_audio`. |
| POST | `/api/parse-clips` | `{text}` → `{clips:[{start,end,name}], errors:[…]}` (bulk-paste parser) |
| POST | `/api/download` | one **item** (see below) → `{job_id}` |
| GET | `/api/progress/{job_id}` | Server-Sent Events. Each event is the job state: `status`, `stage`, `steps`, `percent`, `clips[]` with per-clip `status`/`percent`, `filename`, `error`, … |
| GET | `/api/job/{job_id}` | Same state as one JSON snapshot |
| POST | `/api/job/{job_id}/retry` | Re-run a failed or cancelled item with the same settings and ID |
| DELETE | `/api/job/{job_id}` | Cancel |
| GET | `/api/file/{job_id}` | The finished MP4, MP3, JPG or ZIP (`Content-Disposition: attachment; filename*=…`) |
| POST | `/api/batch` | `{items:[item, …]}` → `{batch_id, job_ids}`. Every item is validated before any of them start. |
| GET | `/api/batch/{id}` | Batch state: `status` (running/done/partial/error), `done`, `failed`, `zip_ready`, `items[]` |
| GET | `/api/batch/{id}/progress` | SSE stream of the batch state, per item and per clip |
| GET | `/api/batch/{id}/zip` | One ZIP with every finished item |
| DELETE | `/api/batch/{id}` | Cancel every item |

**Item body:**

```jsonc
{
  "url": "https://youtu.be/…",            // or an Instagram post/reel/story URL
  "type": "video",                        // "video" | "audio" | "media" (Instagram originals)
  "quality": 1080,                        // video height (YouTube)
  "bitrate": 192,                         // MP3 kbps
  "clips": [                              // optional; omit for the full video
    {"start": "34:33", "end": "36:43", "name": "Best bit"},
    {"start": "1:02:10", "end": "1:03:00", "type": "audio", "bitrate": 320}   // per-clip override
  ],
  "output": "separate",                   // "separate" (ZIP) | "merged"
  "fade": false,                          // 0.5 s fade between merged clips
  "media": [1, 3]                         // Instagram carousel items (with type "media")
}
```

The older single-clip format `{start, end}` still works.

### How it works

- **Clips:** clips that share a format are cut in **one yt-dlp run** with a repeated `--download-sections "*START-END"` flag (once per clip) plus `--force-keyframes-at-cuts`. Only those sections are downloaded, and each starts and ends on the exact frame. Clips whose rows override the format are grouped into their own run.
- **Per-clip progress:** read from ffmpeg's `time=` output while each section is cut.
- **Merged output:** the clips go through ffmpeg's concat demuxer with **stream copy** (fast, no quality loss) when they all share the same codec, resolution and frame rate. When a fade is requested or the clips differ, they are **re-encoded** through the concat filter: the resolution, frame rate and sample rate are normalised, and silent audio is generated for clips without sound.
- **File names:** `<Title> - <clip name or 34m33s-36m43s>.mp4`, `<Title> - merged 3 clips.mp4`, `<Title> - 3 clips.zip`, and `<user> - <shortcode> - 01.jpg` for Instagram.
- **Limits:** `MAX_CLIPS_PER_JOB` (20) and `MAX_TOTAL_CLIP_SECONDS` (1 h) per item, and `MAX_BATCH_ITEMS` (10) per batch. Files are deleted 1 hour after creation, and the hour restarts when you retry.

### Admin endpoints

These are off until you set `ADMIN_TOKEN`. Send the token in the `X-Admin-Token` header.

```bash
TOKEN=your-admin-token
HOST=https://clips.example.com

# Versions, ffmpeg/deno detection, cookie status, active jobs
curl -H "X-Admin-Token: $TOKEN" $HOST/api/admin/status

# Update yt-dlp AND gallery-dl (do this when downloads start failing)
curl -X POST -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
     -d '{"channel":"stable"}' $HOST/api/admin/update-ytdlp      # or {"channel":"nightly"}

# Cookies: platform=youtube (age-restricted videos) or platform=instagram
curl -X POST -H "X-Admin-Token: $TOKEN" -F "file=@instagram_cookies.txt" "$HOST/api/admin/cookies?platform=instagram"
curl -X DELETE -H "X-Admin-Token: $TOKEN" "$HOST/api/admin/cookies?platform=instagram"
```

### Exporting cookies.txt for Instagram

1. **Use a throwaway account.** Create or use a separate Instagram account, not your personal one. Instagram can flag or lock accounts used for automated downloading. Follow any private accounts you need from it.
2. **Log in.** Sign in to instagram.com with that account in a desktop browser, and open a couple of posts so the session is fully set up.
3. **Export the cookies** in **Netscape format**, either with a browser extension or with yt-dlp:
   - **Extension:** install a **"Get cookies.txt LOCALLY"** extension (Chrome/Edge or Firefox; choose one that works offline). Go to instagram.com, click the extension, and click **Export**. Save the file as `instagram_cookies.txt`.
   - **yt-dlp:** close the browser first, then run:
     ```bash
     yt-dlp --cookies-from-browser firefox --cookies instagram_cookies.txt --skip-download "https://www.instagram.com/p/BsOGulcndj-/"
     ```
     Replace `firefox` with `chrome`, `edge`, `brave` or `safari` as needed.
4. **Check the file.** It should start with `# Netscape HTTP Cookie File` and contain a `sessionid` line for `.instagram.com`.
5. **Upload it** with the `curl … ?platform=instagram` command above. Without the admin API, you can instead copy it into the data volume:
   ```bash
   docker compose cp instagram_cookies.txt app:/app/data/instagram_cookies.txt
   ```
6. **Treat it like a password.** It gives full access to that account. Re-export it when downloads start saying "needs a login", because Instagram sessions expire or get logged out.

The steps for **YouTube** cookies (age-restricted videos) are the same: log into youtube.com with a throwaway Google account, export the cookies, and upload with `?platform=youtube`.

---

## Configuration

Set these in `.env` for Docker, or as environment variables. Defaults are in [backend/app/config.py](backend/app/config.py).

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | *(empty = admin off)* | Secret for `/api/admin/*` |
| `MAX_CONCURRENT_JOBS` | 2 | Items processed at once. The rest wait in the queue. |
| `MAX_QUEUED_JOBS` | 20 | Queued + running items before the server returns "busy" |
| `MAX_ACTIVE_JOBS_PER_IP` | 10 | Queued + running items per visitor. Each batch item counts. |
| `MAX_CLIPS_PER_JOB` | 20 | Clips per link |
| `MAX_TOTAL_CLIP_SECONDS` | 3600 | Combined clip length per link |
| `MAX_BATCH_ITEMS` | 10 | Links per batch |
| `RATE_INFO_PER_MINUTE` | 30 | `/api/info` calls per IP per minute |
| `RATE_DOWNLOADS_PER_HOUR` | 30 | Items downloaded per IP per hour |
| `MAX_DURATION_SECONDS` | 10800 | Longest video, or combined clip length, allowed |
| `MAX_FILESIZE_MB` | 2048 | Rejects jobs whose estimated size is above this |
| `MAX_QUALITY` | 2160 | Hides qualities above this |
| `FILE_TTL_SECONDS` | 3600 | Files, jobs and batches are deleted this long after creation |
| `JOB_TIMEOUT_SECONDS` | 1800 | Kills a single extractor run that takes too long |
| `INSTAGRAM_RETRIES` | 3 | Retries, with backoff, when Instagram rate-limits |
| `PREFER_H264` | false | Prefer H.264/AAC (plays everywhere, max 1080p) |
| `YTDLP_JS_RUNTIMES` | *(empty = deno)* | Set to `node` if you only have Node.js |
| `CORS_ORIGINS` | *(empty)* | Only needed if the frontend is hosted on another domain |

---

## Deploy to a VPS (Hetzner, DigitalOcean, …)

These steps assume Ubuntu 24.04. A 2 vCPU / 4 GB server handles `MAX_CONCURRENT_JOBS=2` comfortably. Clips and fades cost the most CPU because they are re-encoded.

1. **Create the server** and point a DNS **A record** (for example `clips.example.com`) at its IP.
2. **Install Docker:** `ssh root@YOUR_SERVER_IP`, then `curl -fsSL https://get.docker.com | sh`.
3. **Copy the project** to `/opt/yt-clipper`, using `git clone` or `scp -r yt-clipper root@YOUR_SERVER_IP:/opt/`.
4. **Configure:**
   ```bash
   cd /opt/yt-clipper && cp .env.example .env
   nano .env     # set DOMAIN=clips.example.com and ADMIN_TOKEN=<random string>
   ```
5. **Start with HTTPS.** Caddy gets a Let's Encrypt certificate automatically:
   ```bash
   docker compose --profile https up -d --build
   ```
6. **Firewall:** `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable`.
   Port 8000 is bound to `127.0.0.1`, so it isn't reachable from outside. Keep it that way, because the app trusts `X-Forwarded-For` for rate limiting.
7. **Optional:** upload Instagram and YouTube cookies through the admin API (see above).

### Frontend on Vercel (optional)

Vercel can host the **website**, but not the **backend**. Downloads run for minutes, need ffmpeg and temporary files, and keep job state in memory, and none of that fits Vercel's short-lived serverless functions. So run the backend on a server (steps above, or Render/Railway with the Dockerfile), and put only the frontend on Vercel:

1. **Import the repo.** On vercel.com go to **Add New → Project**, then import this GitHub repo.
2. **Set the root directory** to `frontend`. Vercel picks up `frontend/vercel.json`, which sets up the Vite build and `dist` output.
3. **Add an environment variable:** `VITE_API_BASE = https://api.yourdomain.com`. This is your backend's public HTTPS URL, with no trailing slash.
4. **Click Deploy.** Every push to `main` then redeploys automatically.
5. **Allow the Vercel site on the backend** (in its `.env`), then restart the backend:
   ```bash
   CORS_ORIGINS=https://reeltube.vercel.app               # your production URL(s), comma-separated
   CORS_ORIGIN_REGEX=https://reeltube(-[a-z0-9-]+)?\.vercel\.app   # also allow preview deployments
   ```
6. **Point the backend's `DOMAIN`** (used by Caddy) at the API hostname, e.g. `api.yourdomain.com`.

The backend must be served over HTTPS, because a site on `https://…vercel.app` can't call a plain `http://` API. Caddy in `docker-compose.yml` handles that.

### Maintenance

```bash
docker compose logs -f app                          # watch logs
docker compose --profile https up -d --build        # redeploy (also installs the newest yt-dlp + gallery-dl)
curl -X POST -H "X-Admin-Token: $TOKEN" https://clips.example.com/api/admin/update-ytdlp   # hot-update both
```

Cookies live in the `appdata` volume, so they survive rebuilds. An update made through the admin API lasts until the container is re-created.

**Using nginx instead of Caddy:** proxy to `127.0.0.1:8000` with `proxy_buffering off;` and `proxy_read_timeout 1h;` for the `/progress` SSE endpoints.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The site changed something…" or signature errors | Update yt-dlp + gallery-dl through the admin endpoint (try `nightly`) |
| "The site refused the download (HTTP 403)" | Usually temporary on YouTube's side. Click **Retry**. If it keeps happening, update yt-dlp. |
| Instagram: "requires a login" | Add or refresh the Instagram cookies.txt |
| Instagram photos are small | Expected without cookies. Add cookies to get original quality. |
| "rate-limiting this server" | Wait a few minutes. On a busy server, add cookies and lower `MAX_CONCURRENT_JOBS`. |
| Formats missing / only 360p on YouTube | No JS runtime found. Install Deno, or set `YTDLP_JS_RUNTIMES=node`. |
| Clips take a while | Expected. Frame-accurate cuts re-encode each clip, at roughly 1–2× real time for 720p on a typical CPU. |
| 4K file won't play in QuickTime/Windows Photos | YouTube serves 1440p/4K only as VP9/AV1. Use VLC, or set `PREFER_H264=true` and pick ≤1080p. |
| Jobs vanish after a restart | Expected. State is held in memory, and leftover files are deleted on startup. Run with **one** worker. |

---

## How to change things

- **Qualities and bitrates:** `QUALITIES` / `BITRATES` in [backend/app/config.py](backend/app/config.py).
- **yt-dlp flags:** `build_download_args()` in [backend/app/ytdlp.py](backend/app/ytdlp.py).
- **gallery-dl flags:** `build_gallerydl_args()` in the same file.
- **Merge and fade behaviour:** `merge_clips()` in [backend/app/media.py](backend/app/media.py). The fade length is `MERGE_FADE_SECONDS` in config.
- **Bulk-paste formats:** `CLIP_LINE_RE` in [backend/app/utils.py](backend/app/utils.py) and [frontend/src/lib/clips.js](frontend/src/lib/clips.js). Keep the two in sync and extend both test files.
- **Error messages:** `_ERROR_MAP` in [backend/app/utils.py](backend/app/utils.py).
- **Progress stages and labels:** `STEP_LABELS` in [backend/app/jobs.py](backend/app/jobs.py).
- **Scaling beyond one server:** move `JobManager` state and the rate limiter to Redis, run items with RQ or Celery workers, and use shared storage for files.
