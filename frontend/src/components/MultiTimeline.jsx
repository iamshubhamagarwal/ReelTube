import { useRef } from 'react'
import { CLIP_COLORS } from '../lib/clips'
import { formatTime } from '../lib/time'

// Taller lanes on touch screens so segments are easy to grab with a finger.
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
const LANE_HEIGHT = COARSE ? 36 : 26
const MIN_LEN = 0.5
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

/** Ruler tick positions: a "round" step giving at most ~8 labels. */
function ticks(duration) {
  const step = TICK_STEPS.find((s) => duration / s <= 8) || 7200
  const out = []
  for (let t = 0; t <= duration + 0.001; t += step) out.push(t)
  return out
}

/** Put overlapping clips on separate lanes so every segment stays grabbable. */
function assignLanes(clips) {
  const laneEnds = []
  const lanes = new Array(clips.length).fill(0)
  clips
    .map((c, i) => ({ ...c, i }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .sort((a, b) => a.start - b.start)
    .forEach((c) => {
      let lane = laneEnds.findIndex((end) => end <= c.start)
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0) }
      laneEnds[lane] = c.end
      lanes[c.i] = lane
    })
  return { lanes, count: Math.max(1, laneEnds.length) }
}

/**
 * Shared timeline showing every clip as a coloured segment.
 * - drag a handle to move that edge, drag the segment body to move the clip
 * - handles are keyboard sliders (←/→ = 1s, Shift = 10s)
 * - `playhead` (seconds) draws the player's current position
 * - clicking empty track space calls onSeek(seconds)
 */
export default function MultiTimeline({ duration, clips, onChange, active, setActive, playhead, onSeek }) {
  const track = useRef(null)
  const drag = useRef(null)
  const { lanes, count } = assignLanes(clips)
  const pct = (t) => `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`

  const timeAt = (clientX) => {
    const rect = track.current.getBoundingClientRect()
    const t = ((clientX - rect.left) / rect.width) * duration
    return Math.round(Math.min(Math.max(t, 0), duration) * 10) / 10
  }

  const apply = (index, mode, t, offset = 0) => {
    const c = clips[index]
    if (mode === 'start') onChange(index, Math.min(t, c.end - MIN_LEN), c.end)
    else if (mode === 'end') onChange(index, c.start, Math.max(t, c.start + MIN_LEN))
    else {
      const len = c.end - c.start
      const start = Math.round(Math.min(Math.max(t - offset, 0), duration - len) * 10) / 10
      onChange(index, start, Math.round((start + len) * 10) / 10)
    }
  }

  const startDrag = (e, index, mode) => {
    e.preventDefault()
    e.stopPropagation()
    setActive(index)
    const offset = mode === 'move' ? timeAt(e.clientX) - clips[index].start : 0
    drag.current = { index, mode, offset }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    const d = drag.current
    if (d) apply(d.index, d.mode, timeAt(e.clientX), d.offset)
  }
  const endDrag = () => { drag.current = null }

  const onKey = (e, index, mode) => {
    const step = e.shiftKey ? 10 : 1
    const c = clips[index]
    const value = mode === 'start' ? c.start : c.end
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); apply(index, mode, Math.max(0, value - step)) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); apply(index, mode, Math.min(duration, value + step)) }
  }

  if (!duration) {
    return <p className="text-xs text-zinc-500">Timeline unavailable (unknown video length).</p>
  }

  const marks = ticks(duration)

  return (
    <div>
      <div
        ref={track}
        className="relative cursor-pointer touch-none rounded-lg bg-zinc-100 select-none dark:bg-zinc-800/70"
        style={{ height: count * LANE_HEIGHT + 8 }}
        onPointerDown={(e) => { if (e.target === track.current && onSeek) onSeek(timeAt(e.clientX)) }}
        title="Click to jump the player here"
      >
        {/* Grid lines at each ruler tick */}
        {marks.map((t) => (
          <div key={t} className="pointer-events-none absolute top-0 bottom-0 w-px bg-zinc-300/70 dark:bg-zinc-700/70" style={{ left: pct(t) }} />
        ))}
        {clips.map((c, i) => {
          if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start) return null
          const color = CLIP_COLORS[i % CLIP_COLORS.length]
          const isActive = i === active
          return (
            <div
              key={c.id}
              className={'absolute rounded-md ' + (isActive ? 'z-10 ring-2 ring-white dark:ring-zinc-950' : 'opacity-80')}
              style={{ left: pct(c.start), width: `calc(${pct(c.end)} - ${pct(c.start)})`, top: 4 + lanes[i] * LANE_HEIGHT, height: LANE_HEIGHT - 4, background: color, minWidth: 6 }}
            >
              {/* Body: drag to move */}
              <div
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => startDrag(e, i, 'move')}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                title={`${c.name || `Clip ${i + 1}`}: ${formatTime(c.start)} – ${formatTime(c.end)}`}
              >
                <span className="pointer-events-none block truncate px-2.5 text-[11px] font-semibold text-white" style={{ lineHeight: `${LANE_HEIGHT - 4}px` }}>
                  {i + 1}{c.name ? ` · ${c.name}` : ''}
                </span>
              </div>
              {/* Handles: wide invisible hit area, thin visible grip */}
              {['start', 'end'].map((mode) => (
                <div
                  key={mode}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Clip ${i + 1} ${mode}`}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(mode === 'start' ? c.start : c.end)}
                  aria-valuetext={formatTime(mode === 'start' ? c.start : c.end)}
                  onPointerDown={(e) => startDrag(e, i, mode)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onKey(e, i, mode)}
                  onFocus={() => setActive(i)}
                  // Hit area is centred on the edge: 16px wide with a mouse, 32px on touch screens.
                  className={'absolute top-[-4px] bottom-[-4px] z-20 flex w-4 cursor-ew-resize items-center justify-center outline-none pointer-coarse:w-8 focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-white ' +
                    (mode === 'start' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2')}
                >
                  <span className="h-full w-1.5 rounded-full bg-white shadow" />
                </div>
              ))}
            </div>
          )
        })}
        {Number.isFinite(playhead) && (
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-zinc-900 dark:bg-white" style={{ left: pct(playhead) }} />
        )}
      </div>
      {/* Ruler labels */}
      <div className="relative mt-1 h-4 text-[11px] text-zinc-500 tabular-nums">
        {marks.map((t, i) => (
          <span key={t} className="absolute"
            style={{ left: pct(t), transform: i === 0 ? 'none' : t / duration > 0.93 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {formatTime(t, { tenths: false })}
          </span>
        ))}
      </div>
    </div>
  )
}
