import { useEffect, useRef, useState } from 'react'
import { CLIP_COLORS } from '../lib/clips'
import { formatBytes, formatTime } from '../lib/time'

// Building blocks shared by the single-job and batch progress views.

const APP_TITLE = 'ReelTube'
const ORIGINAL_TITLE = document.title

/**
 * Mirrors progress in the browser tab title ("42% · ReelTube", "✓ Ready")
 * and shows a desktop notification when the job finishes in a background
 * tab (only if the user allowed notifications via the "Notify me" button).
 * `job` may be a single job or a batch summary ({status, percent, title?}).
 */
export function useJobAlerts(job) {
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission))
  const notified = useRef(false)
  const status = job?.status
  const percent = Math.round(job?.percent || 0)

  useEffect(() => {
    if (!status) return undefined
    if (status === 'running' || status === 'queued') {
      notified.current = false
      document.title = status === 'queued' ? `Queued · ${APP_TITLE}` : `${percent}% · ${APP_TITLE}`
    } else if (status === 'done' || status === 'partial') {
      document.title = `✓ Ready · ${APP_TITLE}`
      if (!notified.current && document.hidden && permission === 'granted') {
        notified.current = true
        try { new Notification('Your download is ready', { body: job.filename || job.title || 'ReelTube' }) } catch { /* ignore */ }
      }
    } else if (status === 'error' || status === 'cancelled') {
      document.title = `⚠ ${status === 'error' ? 'Failed' : 'Cancelled'} · ${APP_TITLE}`
    }
    return undefined
  }, [status, percent, permission, job?.filename, job?.title])

  // Restore the normal title when the panel goes away.
  useEffect(() => () => { document.title = ORIGINAL_TITLE }, [])

  return {
    canAsk: permission === 'default',
    ask: () => Notification.requestPermission().then(setPermission).catch(() => {}),
  }
}

export function StepList({ job }) {
  const steps = job.steps || []
  if (!steps.length) return null
  const stageIndex = job.status === 'done' ? steps.length : steps.findIndex((s) => s.key === job.stage)
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {steps.map((s, i) => {
        const state = i < stageIndex ? 'done' : i === stageIndex && job.status === 'running' ? 'active' : 'pending'
        return (
          <li key={s.key} className={'flex items-center gap-1.5 ' +
            (state === 'done' ? 'text-emerald-600 dark:text-emerald-400'
              : state === 'active' ? 'font-semibold' : 'text-zinc-400 dark:text-zinc-600')}>
            <span aria-hidden>{state === 'done' ? '✓' : state === 'active' ? '●' : '○'}</span>
            {s.label}
          </li>
        )
      })}
    </ol>
  )
}

export function ProgressBar({ job, thin = false }) {
  if (job.status === 'error' || job.status === 'cancelled') return null
  const indeterminate = job.status === 'running' && job.stage_percent == null
  return (
    <div className={'relative overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800 ' + (thin ? 'h-1.5' : 'h-3')}
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.percent || 0)}>
      <div className={'h-full rounded-full transition-[width] duration-300 ' + (job.status === 'done' ? 'bg-emerald-500' : 'bg-rose-500')}
        style={{ width: `${job.percent || 0}%` }} />
      {indeterminate && <div className="animate-indeterminate absolute inset-y-0 left-0 w-1/3 rounded-full bg-white/30" />}
    </div>
  )
}

/** One chip per clip: colour, number/name, its own mini progress. */
export function ClipChips({ clips }) {
  if (!clips?.length || clips.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {clips.map((c, i) => {
        const color = CLIP_COLORS[i % CLIP_COLORS.length]
        const label = c.name || `${formatTime(c.start)}–${formatTime(c.end)}`
        return (
          <li key={i} className="relative overflow-hidden rounded-md border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-700"
            title={`${label}: ${c.status}`}>
            <span className="absolute inset-y-0 left-0 opacity-20 transition-[width]"
              style={{ width: `${c.status === 'done' ? 100 : c.percent}%`, background: color }} />
            <span className="relative flex items-center gap-1">
              <span className="font-bold" style={{ color }}>{i + 1}</span>
              <span className="max-w-[9rem] truncate">{label}</span>
              {c.status === 'done' && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
              {c.status === 'error' && <span className="text-red-600">✕</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function StatusText({ job }) {
  if (job.status === 'queued') {
    return <span className="text-zinc-500">Waiting in queue{job.queue_position ? ` (#${job.queue_position})` : ''}…</span>
  }
  if (job.status === 'error') return <span className="text-red-600 dark:text-red-400">{job.error}</span>
  if (job.status === 'cancelled') return <span className="text-zinc-500">Cancelled.</span>
  if (job.status === 'done') {
    return (
      <span className="min-w-0 truncate text-zinc-500" title={job.filename}>
        {job.filename}{job.filesize ? ` · ${formatBytes(job.filesize)}` : ''}
      </span>
    )
  }
  if (job.note) return <span className="text-amber-600 dark:text-amber-400">{job.note}</span>
  const bits = [`${Math.round(job.percent || 0)}%`]
  const running = job.clips?.findIndex((c) => c.status === 'running')
  if (job.clips?.length > 1 && running >= 0) bits.push(`clip ${running + 1} of ${job.clips.length}`)
  if (job.speed) bits.push(`${formatBytes(job.speed)}/s`)
  if (job.eta) bits.push(`${formatTime(job.eta, { tenths: false })} left`)
  return <span className="text-zinc-500 tabular-nums">{bits.join(' · ')}</span>
}
