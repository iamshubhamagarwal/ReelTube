import { useEffect, useState } from 'react'
import { cancelJob, fileUrl, getJob, progressUrl, retryJob } from '../lib/api'
import { addRecent } from '../lib/recent'
import { formatBytes } from '../lib/time'
import { ClipChips, ProgressBar, StatusText, StepList, useJobAlerts } from './ProgressParts'

const TERMINAL = ['done', 'error', 'cancelled']

/**
 * Subscribes to /api/progress/{jobId} (Server-Sent Events) and shows the
 * stages, a progress bar, per-clip chips and finally the Download button.
 */
export default function ProgressPanel({ jobId, onReset }) {
  const [job, setJob] = useState(null)
  const [stream, setStream] = useState(0)   // bump to re-subscribe (after Retry)
  const [retryError, setRetryError] = useState('')
  const alerts = useJobAlerts(job)

  useEffect(() => {
    let closed = false
    const handle = (data) => {
      setJob(data)
      if (data.status === 'done') addRecent(data)
      if (TERMINAL.includes(data.status)) { closed = true; es.close() }
    }
    const es = new EventSource(progressUrl(jobId))
    es.onmessage = (ev) => handle(JSON.parse(ev.data))
    // EventSource reconnects by itself; if the job vanished, stop trying.
    es.onerror = () => {
      if (closed) return
      getJob(jobId).then(handle).catch((err) => {
        closed = true
        es.close()
        setJob({ status: 'error', error: err.message, steps: [] })
      })
    }
    return () => { closed = true; es.close() }
  }, [jobId, stream])

  const retry = async () => {
    setRetryError('')
    try {
      setJob(await retryJob(jobId))
      setStream((s) => s + 1)
    } catch (e) {
      setRetryError(e.message)
    }
  }

  if (!job) {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-rose-500" /> Starting…
        </p>
      </Card>
    )
  }

  if (job.status === 'done') {
    const isZip = job.filename?.endsWith('.zip')
    return (
      <Card>
        <div className="flex flex-col items-center py-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-2xl text-emerald-600 dark:text-emerald-400">✓</span>
          <h2 className="mt-3 text-lg font-semibold">Your {isZip ? 'files are' : 'file is'} ready</h2>
          <p className="mt-1 max-w-full truncate text-sm text-zinc-500" title={job.filename}>{job.filename}</p>
          {job.note && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{job.note}</p>}
        </div>
        <ClipChips clips={job.clips} />
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a href={fileUrl(jobId)} download={job.filename}
            className="flex-1 rounded-xl bg-emerald-600 px-6 py-3.5 text-center font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500">
            ⬇ Download {isZip ? 'ZIP' : ''} {job.filesize ? `(${formatBytes(job.filesize)})` : ''}
          </a>
          <button type="button" onClick={onReset} className={secondary}>Change options</button>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-500">Available for 1 hour. Also listed under “Recent downloads”.</p>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-3">
        <StepList job={job} />
        <ProgressBar job={job} />
        <ClipChips clips={job.clips} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <StatusText job={job} />
          {['queued', 'running'].includes(job.status) && (
            <div className="flex items-center gap-1">
              {alerts.canAsk && (
                <button type="button" onClick={alerts.ask}
                  className="rounded-lg px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                  🔔 Notify me
                </button>
              )}
              <button type="button" onClick={() => cancelJob(jobId).catch(() => {})}
                className="rounded-lg px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                Cancel
              </button>
            </div>
          )}
        </div>
        {job.status === 'running' && (
          <p className="text-xs text-zinc-400">You can switch tabs — the tab title shows the progress.</p>
        )}
      </div>

      {['error', 'cancelled'].includes(job.status) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={retry}
            className="rounded-xl bg-rose-600 px-6 py-2.5 font-semibold text-white hover:bg-rose-500">↻ Retry</button>
          <button type="button" onClick={onReset} className={secondary}>Change options</button>
          {retryError && <p className="w-full text-sm text-red-600 dark:text-red-400">{retryError}</p>}
        </div>
      )}
    </Card>
  )
}

const secondary = 'rounded-xl border border-zinc-300 px-6 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'

function Card({ children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/60">{children}</div>
  )
}
