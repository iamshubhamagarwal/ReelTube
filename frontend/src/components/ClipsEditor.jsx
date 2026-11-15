import { useEffect, useRef, useState } from 'react'
import { CLIP_COLORS, findOverlaps, newClip, parseClipLines, totalLength, validateClip } from '../lib/clips'
import { formatTime } from '../lib/time'
import MultiTimeline from './MultiTimeline'
import Player from './Player'
import TimeInput from './TimeInput'

// Touch screens (pointer-coarse) get bigger tap targets; keyboard hints are hidden there.
const btn = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 pointer-coarse:min-h-10 dark:border-zinc-700 dark:hover:bg-zinc-800'
const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 pointer-coarse:h-10 pointer-coarse:w-10 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'

const Kbd = ({ children }) => (
  <kbd className="pointer-coarse:hidden rounded border border-zinc-300 bg-zinc-100 px-1 font-mono text-[10px] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{children}</kbd>
)

// "⇤" / "⇥" style icons for the "set to current time" buttons.
const SetStartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M4 4v16M20 12H8m4-4-4 4 4 4" />
  </svg>
)
const SetEndIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M20 4v16M4 12h12m-4-4 4 4-4 4" />
  </svg>
)

/**
 * Multi-clip editor: player, toolbar, shared timeline, one compact row per
 * clip, bulk paste and output options (separate ZIP vs merged).
 * Keyboard (when not typing): I = set start, O = set end, N = new clip,
 * P = preview the selected clip.
 *
 * `config` is the item's settings object; `update(patch)` merges changes.
 */
export default function ClipsEditor({ info, config, update, limits }) {
  const root = useRef(null)
  const player = useRef(null)
  const stopTimer = useRef(null)
  const [active, setActive] = useState(0)
  const [playhead, setPlayhead] = useState(null)
  const duration = info.duration || 0
  const clips = config.clips
  const maxClips = limits?.max_clips ?? 20

  // Follow the player's position on the timeline.
  useEffect(() => {
    const id = setInterval(() => {
      const t = player.current?.getCurrentTime?.()
      if (Number.isFinite(t)) setPlayhead(t)
    }, 250)
    return () => { clearInterval(id); clearInterval(stopTimer.current) }
  }, [])

  const setClips = (next) => update({ clips: next })
  const patchClip = (i, patch) => setClips(clips.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const now = () => {
    const t = player.current?.getCurrentTime?.()
    return Number.isFinite(t) ? Math.round(t * 10) / 10 : null
  }

  const addClip = () => {
    if (clips.length >= maxClips) return
    // Start at the playhead, or right after the last clip.
    const last = clips[clips.length - 1]
    let start = now() ?? (last && Number.isFinite(last.end) ? last.end : 0)
    if (duration) start = Math.min(start, Math.max(duration - 1, 0))
    const end = duration ? Math.min(start + 10, duration) : start + 10
    setClips([...clips, newClip(start, end)])
    setActive(clips.length)
  }

  const removeClip = (i) => {
    setClips(clips.filter((_, j) => j !== i))
    setActive((a) => Math.max(0, a >= i ? a - 1 : a))
  }

  const setStartNow = (i) => {
    const t = now()
    const c = clips[i]
    if (t == null || !c) return
    patchClip(i, { start: t, end: Number.isFinite(c.end) && c.end > t ? c.end : Math.min(t + 10, duration || t + 10) })
  }
  const setEndNow = (i) => {
    const t = now()
    const c = clips[i]
    if (t == null || !c) return
    patchClip(i, { end: t, start: Number.isFinite(c.start) && c.start < t ? c.start : Math.max(t - 10, 0) })
  }

  // Plays from start and pauses automatically at end.
  const preview = (i) => {
    const c = clips[i]
    if (!c || validateClip(c.start, c.end, duration)) return
    setActive(i)
    player.current?.seekTo(c.start)
    player.current?.play()
    clearInterval(stopTimer.current)
    stopTimer.current = setInterval(() => {
      const t = player.current?.getCurrentTime?.()
      if (t != null && t >= c.end) {
        player.current.pause()
        clearInterval(stopTimer.current)
      }
    }, 100)
  }

  // Keyboard shortcuts (ignored while typing in a field).
  const actions = useRef({})
  actions.current = { setStartNow, setEndNow, addClip, preview, active }
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      // Skip when this editor is hidden (e.g. the other tab is showing).
      if (!root.current || root.current.offsetParent === null) return
      if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return
      const a = actions.current
      const key = e.key.toLowerCase()
      if (key === 'i') a.setStartNow(a.active)
      else if (key === 'o') a.setEndNow(a.active)
      else if (key === 'n') a.addClip()
      else if (key === 'p') a.preview(a.active)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const overlaps = findOverlaps(clips)
  const overlapping = new Set(overlaps.flat())
  const total = totalLength(clips)
  const separate = config.output === 'separate'
  const activeColor = CLIP_COLORS[active % CLIP_COLORS.length]

  return (
    <div ref={root} className="space-y-4">
      <Player ref={player} info={info} />

      {/* Toolbar: acts on the selected clip */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800/60">
        <span className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm tabular-nums shadow-sm dark:bg-zinc-900" title="Player position">
          {formatTime(playhead ?? 0)}
        </span>
        {clips.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: activeColor }} />
            Selected: clip {active + 1}
          </span>
        )}
        {/* On phones the three actions share one row and "Add clip" takes the next. */}
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" onClick={() => setStartNow(active)} disabled={!clips.length} className={btn + ' flex-1 bg-white sm:flex-none dark:bg-zinc-900'}>
            <SetStartIcon /> Start <Kbd>I</Kbd>
          </button>
          <button type="button" onClick={() => setEndNow(active)} disabled={!clips.length} className={btn + ' flex-1 bg-white sm:flex-none dark:bg-zinc-900'}>
            End <Kbd>O</Kbd> <SetEndIcon />
          </button>
          <button type="button" onClick={() => preview(active)} disabled={!clips.length} className={btn + ' flex-1 bg-white sm:flex-none dark:bg-zinc-900'}>
            ▶ Preview <Kbd>P</Kbd>
          </button>
        </div>
        <button type="button" onClick={addClip} disabled={clips.length >= maxClips}
          className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 pointer-coarse:min-h-10 sm:ml-auto sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          + Add clip <Kbd>N</Kbd>
        </button>
      </div>

      <MultiTimeline
        duration={duration}
        clips={clips}
        active={active}
        setActive={setActive}
        playhead={playhead}
        onSeek={(t) => player.current?.seekTo(t)}
        onChange={(i, start, end) => patchClip(i, { start, end })}
      />

      {/* Clip rows */}
      <ol className="space-y-2">
        {clips.map((c, i) => {
          const error = validateClip(c.start, c.end, duration)
          const color = CLIP_COLORS[i % CLIP_COLORS.length]
          const isActive = i === active
          return (
            <li
              key={c.id}
              onClick={() => setActive(i)}
              onFocusCapture={() => setActive(i)}
              className={'rounded-xl border-l-4 border-y border-r p-2.5 transition ' + (isActive
                ? 'border-y-zinc-300 border-r-zinc-300 bg-zinc-50 dark:border-y-zinc-600 dark:border-r-zinc-600 dark:bg-zinc-800/40'
                : 'border-y-zinc-200 border-r-zinc-200 dark:border-y-zinc-800 dark:border-r-zinc-800')}
              style={{ borderLeftColor: color }}
            >
              {/* Line 1: just the times, so the inputs get the full width on phones */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-center text-sm font-bold" style={{ color }}>{i + 1}</span>
                <button type="button" onClick={() => setStartNow(i)} className={iconBtn}
                  title="Set start = current time" aria-label={`Clip ${i + 1}: set start = current time`}><SetStartIcon /></button>
                <div className="min-w-0 flex-1">
                  <TimeInput label={`Clip ${i + 1} start`} compact value={c.start} onValue={(v) => patchClip(i, { start: v })}
                    invalid={Boolean(error) && (Number.isNaN(c.start) || c.start === null || (Number.isFinite(c.end) && c.end <= c.start))} />
                </div>
                <span className="text-zinc-400" aria-hidden>→</span>
                <div className="min-w-0 flex-1">
                  <TimeInput label={`Clip ${i + 1} end`} compact value={c.end} onValue={(v) => patchClip(i, { end: v })}
                    invalid={Boolean(error) && (Number.isNaN(c.end) || c.end === null || c.end <= c.start || (duration && c.end > duration + 1))} />
                </div>
                <button type="button" onClick={() => setEndNow(i)} className={iconBtn}
                  title="Set end = current time" aria-label={`Clip ${i + 1}: set end = current time`}><SetEndIcon /></button>
              </div>

              {/* Line 2: length, name, per-clip format, preview, delete */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]">
                <span className="w-12 shrink-0 font-mono text-xs text-zinc-500 tabular-nums" title="Clip length">
                  {error ? '—' : formatTime(c.end - c.start)}
                </span>
                <input
                  type="text"
                  value={c.name}
                  maxLength={100}
                  onChange={(e) => patchClip(i, { name: e.target.value })}
                  placeholder="Name (optional)"
                  aria-label={`Clip ${i + 1} name`}
                  className="h-9 min-w-0 flex-1 basis-32 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-rose-500 focus:bg-white dark:border-zinc-800 dark:hover:border-zinc-700 dark:focus:bg-zinc-900"
                />
                {separate && (
                  <select
                    value={c.override}
                    onChange={(e) => patchClip(i, { override: e.target.value })}
                    aria-label={`Clip ${i + 1} format`}
                    className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">Same format</option>
                    {info.platform === 'youtube'
                      ? info.qualities.map((q) => <option key={q.height} value={`video:${q.height}`}>MP4 {q.label}</option>)
                      : <option value="video:1080">MP4 best</option>}
                    {info.has_audio !== false && [128, 192, 320].map((k) => <option key={k} value={`audio:${k}`}>MP3 {k} kbps</option>)}
                  </select>
                )}
                <div className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => preview(i)} disabled={Boolean(error)} className={iconBtn + ' disabled:opacity-40'}
                    title="Preview this clip" aria-label={`Preview clip ${i + 1}`}>▶</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeClip(i) }} className={iconBtn + ' hover:!text-red-600'}
                    title="Delete clip" aria-label={`Delete clip ${i + 1}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                  </button>
                </div>
                <span className="w-full text-xs empty:hidden">
                  {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
                  {!error && overlapping.has(i) && <span className="text-amber-600 dark:text-amber-400">⚠ Overlaps another clip (allowed)</span>}
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-zinc-500">
          {clips.length} clip{clips.length === 1 ? '' : 's'} · total <span className="font-mono tabular-nums">{formatTime(total)}</span>
          {overlaps.length > 0 && <span className="text-amber-600 dark:text-amber-400"> · {overlaps.length} overlap{overlaps.length > 1 ? 's' : ''}</span>}
        </span>
        <span className="text-xs text-zinc-400">
          <span className="pointer-coarse:hidden">Tip: drag segments on the timeline, click it to seek</span>
          <span className="hidden pointer-coarse:inline">Tip: drag the coloured bars, tap the timeline to seek</span>
        </span>
      </div>

      <BulkPaste onAdd={(parsed) => {
        const rows = parsed.map((p) => newClip(p.start, p.end, p.name))
        // Replace the untouched default row instead of appending to it.
        const pristine = clips.length === 1 && !clips[0].name && clips[0].start === 0
        setClips((pristine ? rows : [...clips, ...rows]).slice(0, maxClips))
        setActive(pristine ? 0 : clips.length)
      }} />

      {/* Output mode */}
      {clips.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Output</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[['separate', 'Separate files', `${clips.length} files in one ZIP`],
              ['merged', 'Merged', 'One file, clips joined in order']].map(([value, label, hint]) => (
              <label key={value} className={'flex cursor-pointer gap-2.5 rounded-xl border p-3 text-sm transition ' + (config.output === value
                ? 'border-rose-500 bg-rose-500/10 ring-1 ring-rose-500' : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700')}>
                <input type="radio" name={`output-${info.id}`} checked={config.output === value}
                  onChange={() => update({ output: value })} className="mt-0.5 accent-rose-600" />
                <span><span className="font-semibold">{label}</span><span className="block text-xs text-zinc-500">{hint}</span></span>
              </label>
            ))}
          </div>
          {config.output === 'merged' && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={config.fade} onChange={(e) => update({ fade: e.target.checked })} className="accent-rose-600" />
              0.5s fade between clips <span className="text-xs text-zinc-500">(re-encodes, slower)</span>
            </label>
          )}
          {config.output === 'merged' && clips.some((c) => c.override) && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Per-clip formats are ignored when merging.</p>
          )}
        </fieldset>
      )}
    </div>
  )
}

/** Collapsible textarea that turns "34:33 - 36:43 Name" lines into clip rows. */
function BulkPaste({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [errors, setErrors] = useState([])

  const add = () => {
    const { clips, errors: errs } = parseClipLines(text)
    setErrors(errs)
    if (clips.length) {
      onAdd(clips)
      if (!errs.length) { setText(''); setOpen(false) }
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M9 4h6v3H9zM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5" />
        </svg>
        Paste a list of timestamps
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <label className="block text-sm font-medium" htmlFor="bulk-paste">Paste one clip per line</label>
      <textarea
        id="bulk-paste"
        rows={4}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder={'34:33 - 36:43\n1:02:10 - 1:03:00 Intro part\n2:10 to 3:45 Chorus'}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={add} disabled={!text.trim()}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40">Add clips</button>
        <button type="button" onClick={() => { setOpen(false); setErrors([]) }} className={btn}>Cancel</button>
        <span className="text-xs text-zinc-500">HH:MM:SS or MM:SS · "-", "–" or "to" · optional name after</span>
      </div>
    </div>
  )
}
