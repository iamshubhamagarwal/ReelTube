import { useEffect, useState } from 'react'
import { fileUrl } from '../lib/api'
import { clearRecent, loadRecent } from '../lib/recent'
import { formatBytes } from '../lib/time'
import PlatformBadge from './PlatformBadge'

// Files finished in this browser during the last hour, ready to download again.
export default function RecentDownloads() {
  const [items, setItems] = useState(loadRecent)

  useEffect(() => {
    const refresh = () => setItems(loadRecent())
    window.addEventListener('reeltube:recent', refresh)
    const timer = setInterval(refresh, 60_000) // drop expired entries
    return () => { window.removeEventListener('reeltube:recent', refresh); clearInterval(timer) }
  }, [])

  if (!items.length) return null
  const minutesLeft = (e) => Math.max(1, Math.round((e.expires_at - Date.now() / 1000) / 60))

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Recent downloads</h3>
        <button type="button" onClick={clearRecent} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Clear
        </button>
      </div>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {items.map((e) => (
          <li key={e.job_id} className="flex items-center gap-3 bg-white/60 p-2.5 dark:bg-zinc-900/40">
            {e.thumbnail
              ? <img src={e.thumbnail} alt="" referrerPolicy="no-referrer" className="h-10 w-16 shrink-0 rounded object-cover" />
              : <div className="h-10 w-16 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={e.filename}>{e.filename}</p>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <PlatformBadge platform={e.platform} />
                {e.filesize ? formatBytes(e.filesize) : ''} · expires in {minutesLeft(e)} min
              </p>
            </div>
            <a href={fileUrl(e.job_id)} download={e.filename} aria-label={`Download ${e.filename}`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              ⬇
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
