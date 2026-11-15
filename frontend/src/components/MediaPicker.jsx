// Grid of an Instagram post's items (carousel / stories) with checkboxes.
export default function MediaPicker({ info, selected, onChange }) {
  const all = info.media.map((m) => m.index)
  const allOn = selected.length === all.length
  const toggle = (index) =>
    onChange(selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index].sort((a, b) => a - b))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {info.media_count} item{info.media_count === 1 ? '' : 's'} · {selected.length} selected
        </p>
        <button type="button" onClick={() => onChange(allOn ? [] : all)}
          className="text-sm font-medium text-rose-600 hover:underline dark:text-rose-400">
          {allOn ? 'Clear' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {info.media.map((m) => {
          const on = selected.includes(m.index)
          return (
            <button
              key={m.index}
              type="button"
              onClick={() => toggle(m.index)}
              aria-pressed={on}
              aria-label={`Item ${m.index} (${m.type})`}
              className={'relative aspect-square overflow-hidden rounded-lg bg-zinc-200 ring-offset-2 dark:bg-zinc-800 dark:ring-offset-zinc-900 ' +
                (on ? 'ring-2 ring-rose-500' : 'opacity-60 hover:opacity-90')}
            >
              {m.thumbnail && <img src={m.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 text-xs font-semibold text-white">{m.index}</span>
              {m.type === 'video' && (
                <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 text-xs text-white">▶ video</span>
              )}
              <span className={'absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full border-2 text-xs font-bold ' +
                (on ? 'border-rose-500 bg-rose-500 text-white' : 'border-white bg-black/30 text-transparent')}>✓</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Photos are saved in their original JPG quality; videos as MP4. Several items arrive as a ZIP.</p>
    </div>
  )
}
