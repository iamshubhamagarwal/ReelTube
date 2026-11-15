import { formatBytes } from '../lib/time'

// Selectable tile used for format, quality and bitrate pickers.
export function Choice({ active, onClick, children, disabled, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        'relative flex flex-col items-center rounded-xl border px-3 py-2.5 text-sm transition ' +
        (active
          ? 'border-rose-500 bg-rose-500/10 text-rose-700 ring-1 ring-rose-500 dark:text-rose-200'
          : 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-800/50') +
        (disabled ? ' cursor-not-allowed opacity-40' : '') + ' ' + className
      }
    >
      {children}
    </button>
  )
}

const VideoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-3v10l-6-3" />
  </svg>
)
const AudioIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
)

/**
 * Format (MP4/MP3) + quality/bitrate picker for one item.
 * `sizeRatio` scales the estimated file sizes when clips are selected.
 */
export default function DownloadOptions({ info, config, update, sizeRatio }) {
  const est = (bytes) => (bytes ? `~${formatBytes(bytes * sizeRatio)}` : '')
  const { type } = config

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Choice active={type === 'video'} onClick={() => update({ type: 'video' })} className="!flex-row justify-center gap-3 !py-3">
          <VideoIcon />
          <span className="text-left leading-tight"><span className="block font-semibold">Video</span><span className="text-xs opacity-70">MP4</span></span>
        </Choice>
        <Choice active={type === 'audio'} onClick={() => update({ type: 'audio' })} disabled={info.has_audio === false}
          className="!flex-row justify-center gap-3 !py-3">
          <AudioIcon />
          <span className="text-left leading-tight">
            <span className="block font-semibold">Audio</span>
            <span className="text-xs opacity-70">{info.has_audio === false ? 'no sound' : 'MP3'}</span>
          </span>
        </Choice>
      </div>

      {type === 'video' ? (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Quality</p>
          {info.qualities.length === 0 ? (
            <p className="rounded-xl bg-zinc-100 px-3 py-2.5 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              Best available quality is used automatically.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {info.qualities.map((q) => (
                <Choice key={q.height} active={config.quality === q.height} onClick={() => update({ quality: q.height })}>
                  {q.height >= 1440 && (
                    <span className="absolute -top-2 rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                      {q.height >= 2160 ? '4K' : '2K'}
                    </span>
                  )}
                  <span className="font-semibold">
                    {q.label}
                    {q.fps > 30 && <sup className="ml-0.5 text-[10px]">{Math.round(q.fps)}</sup>}
                  </span>
                  <span className="text-xs tabular-nums opacity-70">{est(q.filesize) || 'size ?'}</span>
                </Choice>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Bitrate</p>
          <div className="grid grid-cols-3 gap-2">
            {info.audio.map((a) => (
              <Choice key={a.kbps} active={config.bitrate === a.kbps} onClick={() => update({ bitrate: a.kbps })}>
                <span className="font-semibold">{a.kbps} kbps</span>
                <span className="text-xs tabular-nums opacity-70">
                  {{ 128: 'Good', 192: 'Great', 320: 'Best' }[a.kbps]}{est(a.filesize) ? ` · ${est(a.filesize)}` : ''}
                </span>
              </Choice>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">Includes the thumbnail as cover art plus title/artist tags.</p>
        </div>
      )}
    </div>
  )
}
