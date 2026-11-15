import { useEffect, useRef, useState } from 'react'
import { batchProgressUrl, batchZipUrl, cancelBatch, fileUrl, getBatch, retryJob } from '../lib/api'
import { addRecent } from '../lib/recent'
import PlatformBadge from './PlatformBadge'
import { ClipChips, ProgressBar, StatusText, useJobAlerts } from './ProgressParts'

/**
 * Live view of a batch: one row per item with its own progress, per-clip
 * chips, a Retry button for failed items, and a combined ZIP at the end.
 */
export default function BatchProgress({ batchId, onReset }) {
  const [batch, setBatch] = useState(null)
  const [stream, setStream] = useState(0)  // bump to re-subscribe after a retry
  const [error, setError] = useState('')
  const remembered = useRef(new Set())   // items already added to "Recent downloads"
  const alerts = useJobAlerts(batch && { status: batch.status, percent: batch.percent, title: `${batch.done} item(s) finished` })

  useEffect(() => {
    let closed = false
    const handle = (data) => {
      if (!data.items) return
      setBatch(data)
      for (const item of data.items) {
        if (item.status === 'done' && !remembered.current.has(item.job_id)) {
          remembered.current.add(item.job_id)
          addRecent(item)
        }
      }
      if (data.status !== 'running') { closed = true; es.close() }
    }
    const es = new EventSource(batchProgressUrl(batchId))
    es.onmessage = (ev) => handle(JSON.parse(ev.data))
    es.onerror = () => {
      if (closed) return
      getBatch(batchId).then(handle).catch((e) => { closed = true; es.close(); setError(e.message) })
    }
    return () => { closed = true; es.close() }
  }, [batchId, stream])

  const retry = async (jobId) => {
    setError('')
    try {
      await retryJob(jobId)
      setStream((s) => s + 1)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!batch) {
    return <Card><p className="text-sm text-zinc-500">{error || 'Starting…'}</p></Card>
  }

  const running = batch.status === 'running'
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {running ? 'Downloading…' : batch.status === 'done' ? 'All done' : `${batch.done} of ${batch.total} finished`}
          </h2>
          <p className="text-sm text-zinc-500">
            {batch.done} done · {batch.failed} failed · {batch.total - batch.done - batch.failed} in progress
          </p>
        </div>
        {running && (
          <div className="flex items-center gap-1">
            {alerts.canAsk && (
              <button type="button" onClick={alerts.ask}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                🔔 Notify me
              </button>
            )}
            <button type="button" onClick={() => cancelBatch(batchId).catch(() => {})}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              Cancel all
            </button>
          </div>
        )}
      </div>

      <div className="mb-4"><ProgressBar job={{ status: running ? 'running' : 'done', percent: batch.percent, stage_percent: 1 }} /></div>

      <ol className="space-y-3">
        {batch.items.map((job, i) => (
          <li key={job.job_id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start gap-3">
              {job.thumbnail
                ? <img src={job.thumbnail} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-14 sm:w-20" />
                : <div className="h-12 w-12 shrink-0 rounded-md bg-zinc-200 sm:h-14 sm:w-20 dark:bg-zinc-800" />}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-400">{i + 1}</span>
                  <PlatformBadge platform={job.platform} />
                  <span className="truncate text-sm font-medium">{job.title}</span>
                </div>
                <ProgressBar job={job} thin />
                <ClipChips clips={job.clips} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <StatusText job={job} />
                  <div className="flex gap-2">
                    {['error', 'cancelled'].includes(job.status) && (
                      <button type="button" onClick={() => retry(job.job_id)}
                        className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-500">↻ Retry</button>
                    )}
                    {job.status === 'done' && (
                      <a href={fileUrl(job.job_id)} download={job.filename}
                        className="rounded-lg border border-zinc-300 px-3 py-1 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">⬇ File</a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={batch.zip_ready ? batchZipUrl(batchId) : undefined}
          aria-disabled={!batch.zip_ready}
          className={'flex-1 rounded-xl px-6 py-3 text-center font-semibold text-white ' + (batch.zip_ready
            ? 'bg-emerald-600 hover:bg-emerald-500' : 'pointer-events-none bg-zinc-400 dark:bg-zinc-700')}
        >
          ⬇ Download all as ZIP{batch.zip_ready && batch.failed ? ` (${batch.done} of ${batch.total})` : ''}
        </a>
        <button type="button" onClick={onReset}
          className="rounded-xl border border-zinc-300 px-6 py-3 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Edit batch
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-zinc-500">Files are available for 1 hour.</p>
    </Card>
  )
}

function Card({ children }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/60">{children}</div>
}
