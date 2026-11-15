import { formatTime } from '../lib/time'
import PlatformBadge from './PlatformBadge'

// Thumbnail + title + channel/username + duration (+ caption for Instagram).
export default function VideoCard({ info, compact = false }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <div className={'relative shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800 ' + (compact ? 'w-24 sm:w-32' : 'w-32 sm:w-48')}>
        {info.thumbnail && (
          <img src={info.thumbnail} alt="" referrerPolicy="no-referrer"
            className={(info.platform === 'instagram' ? 'aspect-square' : 'aspect-video') + ' w-full object-cover'} />
        )}
        {info.duration > 0 && (
          <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatTime(info.duration, { tenths: false })}
          </span>
        )}
        {info.media_count > 1 && (
          <span className="absolute top-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            ⧉ {info.media_count}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <PlatformBadge platform={info.platform} />
          {info.age_limit >= 18 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">Age-restricted</span>
          )}
        </div>
        <h2 className={(compact ? 'line-clamp-2 text-sm' : 'line-clamp-3') + ' font-semibold leading-snug'}>{info.title}</h2>
        <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
          {info.platform === 'instagram' && info.channel ? '@' : ''}{info.channel}
        </p>
        {!compact && info.caption && info.caption !== info.title && (
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{info.caption}</p>
        )}
      </div>
    </div>
  )
}
