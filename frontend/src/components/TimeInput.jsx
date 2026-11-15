import { useEffect, useRef, useState } from 'react'
import { formatTime, parseTime } from '../lib/time'

/**
 * Text input for a time value. Keeps its own draft text so the user can type
 * freely ("3", "34:", "34:3"...), and reports the parsed number upward on
 * every keystroke (null = empty, NaN = invalid). When the value changes from
 * elsewhere (timeline, player button) the text is refreshed — unless the user
 * is typing in it.
 */
export default function TimeInput({ label, value, onValue, invalid, compact = false }) {
  const [draft, setDraft] = useState(formatTime(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current && Number.isFinite(value)) setDraft(formatTime(value))
  }, [value])

  return (
    <label className="block min-w-0">
      <span className={(compact ? 'sr-only' : 'mb-1 block') + ' text-xs font-medium text-zinc-500 dark:text-zinc-400'}>
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="MM:SS"
        aria-label={label}
        aria-invalid={invalid || undefined}
        onFocus={() => { focused.current = true }}
        onBlur={() => {
          focused.current = false
          if (Number.isFinite(value)) setDraft(formatTime(value)) // normalise "34:3" -> "34:03"
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          onValue(parseTime(e.target.value))
        }}
        className={
          'w-full rounded-lg border bg-white px-2.5 py-1.5 font-mono tabular-nums outline-none focus:ring-2 dark:bg-zinc-900 ' +
          (invalid
            ? 'border-red-500 focus:ring-red-500/30'
            : 'border-zinc-300 focus:border-rose-500 focus:ring-rose-500/30 dark:border-zinc-700')
        }
      />
    </label>
  )
}
