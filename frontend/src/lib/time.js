// Time and size helpers shared by the components (tested in time.test.js).

export const TIME_PATTERN = String.raw`\d+(?::\d{1,2}){0,2}(?:\.\d+)?`
const TIME_RE = new RegExp(`^${TIME_PATTERN}$`)

/**
 * Parse "HH:MM:SS", "MM:SS" or "SS" (fractions allowed, e.g. "34:33.5").
 * Returns seconds, null for empty input, or NaN when the text is invalid.
 */
export function parseTime(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (!TIME_RE.test(t)) return NaN
  const parts = t.split(':')
  const s = parseFloat(parts[parts.length - 1])
  const m = parts.length >= 2 ? parseInt(parts[parts.length - 2], 10) : 0
  const h = parts.length === 3 ? parseInt(parts[0], 10) : 0
  if (parts.length >= 2 && s >= 60) return NaN
  if (parts.length === 3 && m >= 60) return NaN
  return h * 3600 + m * 60 + s
}

/** 2193 -> "36:33", 3723.4 -> "1:02:03.4" (tenths shown only when present). */
export function formatTime(seconds, { tenths = true } = {}) {
  if (seconds == null || Number.isNaN(seconds)) return ''
  let total = Math.max(0, seconds)
  total = tenths ? Math.round(total * 10) / 10 : Math.floor(total)
  const whole = Math.floor(total)
  const frac = Math.round((total - whole) * 10)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n) => String(n).padStart(2, '0')
  let out = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  if (tenths && frac) out += `.${frac}`
  return out
}

/** 1536000 -> "1.5 MB" */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '?'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`
}
