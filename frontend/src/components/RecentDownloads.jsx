import { useEffect, useState } from 'react'
import { fileUrl, getJob } from '../lib/api'
import { clearRecent, loadRecent, removeRecent } from '../lib/recent'
import { formatBytes } from '../lib/time'
import PlatformBadge from './PlatformBadge'

/** True if the server still has a finished file for this job. */
async function stillAvailable(jobId) {
  try {
    const job = await getJob(jobId)
    return job.status === 'done'
  } catch (e) {
    // 404 = expired / deleted. Network errors: assume it's there and let the click try.
    return !/not found|expired/i.test(e.message)
  }
}

// Files finished in this browser during the last hour, ready to download again.
export default function RecentDownloads() {
  const [items, setItems] = useState(loadRecent)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const refresh = () => setItems(loadRecent())
    window.addEventListener('reeltube:recent', refresh)
    const timer = setInterval(refresh, 60_000) // drop expired entries

    // Remove entries the server no longer has (e.g. after a server restart).
    let cancelled = false
    ;(async () => {
      for (const entry of loadRecent()) {
        if (cancelled) return
        if (!(await stillAvailable(entry.job_id))) removeRecent(entry.job_id)
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('reeltube:recent', refresh)
      clearInterval(timer)
    }
  }, [])

  // Check right before downloading, so a missing file shows a clear message
  // here instead of a failed download in the browser.
  const download = async (e, entry) => {
    e.preventDefault()
    setNotice('')
    if (await stillAvailable(entry.job_id)) {
      window.location.href = fileUrl(entry.job_id)
    } else {
      removeRecent(entry.job_id)
      setNotice(`“${entry.filename}” is no longer on the server (files are kept for 1 hour). Please download it again.`)
    }
  }

  if (!items.length && !notice) return null
  const minutesLeft = (e) => Math.max(1, Math.round((e.expires_at - Date.now() / 1000) / 60))

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Recent downloads</h3>
        {items.length > 0 && (
          <button type="button" onClick={clearRecent} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Clear
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="mb-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{notice}</p>
      )}
      {items.length > 0 && (
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
              <a href={fileUrl(e.job_id)} onClick={(ev) => download(ev, e)} aria-label={`Download ${e.filename}`}
                className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
