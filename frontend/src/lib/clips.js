// Clip-list logic: bulk-paste parsing, validation, overlaps, platform
// detection and request building. Pure functions, tested in clips.test.js.

import { TIME_PATTERN, formatTime, parseTime } from './time.js'

// "34:33 - 36:43", "1:02:10 to 1:03:00 Intro part", "2:10–3:45: Chorus"
const CLIP_LINE_RE = new RegExp(
  String.raw`^\s*(?:[-*•]\s+|\d+[.)]\s+)?` +
  `(${TIME_PATTERN})\\s*(?:-|–|—|to|TO|To)\\s*(${TIME_PATTERN})` +
  String.raw`(?:\s*[-–—:|]?\s*(.*?))?\s*$`,
)

/** One line -> {start, end, name}; null for blank lines; throws for bad lines. */
export function parseClipLine(line) {
  if (!line || !line.trim()) return null
  const m = CLIP_LINE_RE.exec(line)
  if (!m) throw new Error(`Couldn't read "${line.trim()}". Use e.g. 34:33 - 36:43 Name`)
  const start = parseTime(m[1])
  const end = parseTime(m[2])
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Invalid time in "${line.trim()}"`)
  return { start, end, name: (m[3] || '').trim() }
}

/** Multi-line paste -> {clips, errors} (errors mention 1-based line numbers). */
export function parseClipLines(text) {
  const clips = []
  const errors = []
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    try {
      const clip = parseClipLine(line)
      if (clip) clips.push(clip)
    } catch (e) {
      errors.push(`Line ${i + 1}: ${e.message}`)
    }
  })
  return { clips, errors }
}

/** Friendly error for one clip, or null when valid. duration 0/undefined = unknown. */
export function validateClip(start, end, duration) {
  if (start === null || end === null || start === undefined || end === undefined) {
    return 'Enter both a start and an end time.'
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return 'Times must look like 34:33 or 1:02:03.'
  if (start < 0) return "Start can't be negative."
  if (end <= start) return 'End must be after start.'
  if (duration) {
    if (start >= duration) return `Start is past the end of the video (${formatTime(duration)}).`
    if (end > duration + 1) return `End is past the end of the video (${formatTime(duration)}).`
  }
  if (end - start < 0.5) return 'A clip must be at least 0.5 seconds long.'
  return null
}

/** Index pairs [i, j] (i < j) of clips whose ranges overlap (touching is fine). */
export function findOverlaps(clips) {
  const pairs = []
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i]
      const b = clips[j]
      if ([a.start, a.end, b.start, b.end].some((v) => !Number.isFinite(v))) continue
      if (a.start < b.end && b.start < a.end) pairs.push([i, j])
    }
  }
  return pairs
}

/** Total seconds of all valid clips. */
export function totalLength(clips) {
  return clips.reduce((sum, c) => (Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start
    ? sum + (c.end - c.start) : sum), 0)
}

/** 'youtube' | 'instagram' | null, from a pasted URL (before fetching). */
export function detectPlatform(url) {
  const u = String(url || '').trim().toLowerCase()
  if (/^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//.test(u)) return 'youtube'
  if (/^(https?:\/\/)?((www|m)\.)?(instagram\.com|instagr\.am)\//.test(u)) return 'instagram'
  return null
}

/** Pull every URL-looking token out of pasted text (one or many links). */
export function splitLinks(text) {
  return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => detectPlatform(s))
}

let nextId = 1
/** A new clip row for the editor. */
export function newClip(start = 0, end = 10, name = '') {
  return { id: nextId++, start, end, name, override: '' }
}

/** Default per-item settings after info is fetched. */
export function defaultConfig(info) {
  const heights = (info.qualities || []).map((q) => q.height)
  const isMedia = info.platform === 'instagram' && !info.is_video
  return {
    type: isMedia ? 'media' : 'video',
    quality: heights.find((h) => h <= 1080) ?? heights[heights.length - 1] ?? 1080,
    bitrate: 192,
    clipsOn: false,
    clips: [newClip(0, Math.min(info.duration || 10, 10))],
    output: 'separate',
    fade: false,
    media: (info.media || []).map((m) => m.index),
  }
}

/** Returns a reason the item can't be downloaded yet, or null. */
export function configProblem(info, config) {
  if (config.type === 'media') {
    return config.media.length ? null : 'Select at least one item.'
  }
  if (config.type === 'audio' && info.has_audio === false) return 'This video has no sound.'
  if (!config.clipsOn) return null
  if (!config.clips.length) return 'Add at least one clip, or turn off "Cut clips".'
  const bad = config.clips.findIndex((c) => validateClip(c.start, c.end, info.duration))
  if (bad >= 0) return `Clip ${bad + 1}: ${validateClip(config.clips[bad].start, config.clips[bad].end, info.duration)}`
  return null
}

/** Build the /api/download (or batch item) payload from editor state. */
export function toPayload(info, config) {
  const payload = { url: info.url, type: config.type, quality: config.quality, bitrate: config.bitrate }
  if (config.type === 'media') return { ...payload, media: config.media }
  if (config.clipsOn) {
    payload.output = config.output
    payload.fade = config.output === 'merged' && config.fade
    payload.clips = config.clips.map((c) => {
      const clip = { start: c.start, end: c.end, name: c.name || '' }
      if (c.override && config.output === 'separate') {
        const [type, value] = c.override.split(':')
        clip.type = type
        if (type === 'video') clip.quality = Number(value)
        else clip.bitrate = Number(value)
      }
      return clip
    })
  }
  return payload
}

/** Short human summary, e.g. "MP4 1080p · 3 clips → ZIP". */
export function describeConfig(info, config) {
  if (config.type === 'media') return `${config.media.length} of ${info.media_count} item(s)`
  const fmt = config.type === 'video'
    ? `MP4 ${info.platform === 'youtube' ? `${config.quality}p` : 'best'}`
    : `MP3 ${config.bitrate} kbps`
  if (!config.clipsOn) return `${fmt} · full`
  const n = config.clips.length
  const out = n > 1 ? (config.output === 'merged' ? ' → merged' : ' → ZIP') : ''
  return `${fmt} · ${n} clip${n === 1 ? '' : 's'}${out}`
}

/** Rough output size in bytes (null when unknown). Per-clip overrides are ignored. */
export function estimateSize(info, config) {
  if (config.type === 'media' || !info.duration) return null
  const length = config.clipsOn ? totalLength(config.clips) : info.duration
  if (!length) return null
  if (config.type === 'audio') return (config.bitrate * 1000 / 8) * length
  const q = (info.qualities || []).find((x) => x.height === config.quality)
  return q?.filesize ? q.filesize * (length / info.duration) : null
}

export const CLIP_COLORS =['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d']
