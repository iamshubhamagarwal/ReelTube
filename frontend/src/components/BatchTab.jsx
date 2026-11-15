import { useState } from 'react'
import { createBatch, getInfo } from '../lib/api'
import { configProblem, defaultConfig, describeConfig, detectPlatform, splitLinks, toPayload } from '../lib/clips'
import BatchProgress from './BatchProgress'
import ItemEditor from './ItemEditor'
import PlatformBadge from './PlatformBadge'
import { Card, ErrorBox, PrimaryButton, StickyBar } from './ui'
import VideoCard from './VideoCard'

const MAX_ITEMS = 10
let nextKey = 1

/**
 * Several links, each with its own format/clips/media selection, downloaded
 * as one queued batch with per-item progress and a combined ZIP.
 */
export default function BatchTab() {
  const [text, setText] = useState('')
  const [entries, setEntries] = useState([])     // {key, url, platform, status, info, config, error}
  const [open, setOpen] = useState(null)         // key of the expanded entry
  const [error, setError] = useState('')
  const [batchId, setBatchId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const patch = (key, changes) => setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...changes } : e)))

  const load = async (entry) => {
    patch(entry.key, { status: 'loading', error: '' })
    try {
      const info = await getInfo(entry.url)
      patch(entry.key, { status: 'ready', info, config: defaultConfig(info) })
    } catch (e) {
      patch(entry.key, { status: 'error', error: e.message })
    }
  }

  const addLinks = async () => {
    const links = splitLinks(text)
    if (!links.length) {
      setError('No YouTube or Instagram links found. Paste one link per line.')
      return
    }
    setError('')
    const room = MAX_ITEMS - entries.length
    if (links.length > room) setError(`A batch holds up to ${MAX_ITEMS} links; extra links were skipped.`)
    const added = links.slice(0, Math.max(room, 0)).map((url) => ({
      key: nextKey++, url, platform: detectPlatform(url), status: 'loading', info: null, config: null, error: '',
    }))
    setEntries((list) => [...list, ...added])
    setText('')
    // Fetch one at a time: gentler on YouTube/Instagram rate limits.
    for (const entry of added) await load(entry)
  }

  const remove = (key) => setEntries((list) => list.filter((e) => e.key !== key))

  const ready = entries.filter((e) => e.status === 'ready')
  const problems = ready.map((e) => configProblem(e.info, e.config)).filter(Boolean)
  const blocked = !entries.length || ready.length !== entries.length || problems.length > 0

  const downloadAll = async () => {
    setSubmitting(true)
    setError('')
    try {
      const { batch_id } = await createBatch(entries.map((e) => toPayload(e.info, e.config)))
      setBatchId(batch_id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (batchId) {
    return <BatchProgress key={batchId} batchId={batchId} onReset={() => setBatchId(null)} />
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="batch-links" className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Paste one or more links (one per line)
        </label>
        <textarea
          id="batch-links"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addLinks() }}
          placeholder={'https://youtu.be/…\nhttps://www.instagram.com/reel/…'}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none placeholder:text-zinc-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/30 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="button" onClick={addLinks} disabled={!text.trim() || entries.length >= MAX_ITEMS}
          className="rounded-xl bg-zinc-900 px-5 py-2.5 font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          + Add to batch
        </button>
      </div>

      <ErrorBox message={error} />

      {entries.length > 0 && (
        <ol className="space-y-3">
          {entries.map((entry, i) => {
            const problem = entry.status === 'ready' ? configProblem(entry.info, entry.config) : null
            const expanded = open === entry.key && entry.status === 'ready'
            return (
              <li key={entry.key}>
                <Card className="!p-3 sm:!p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-bold dark:bg-zinc-800">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {entry.status === 'ready' ? (
                        <VideoCard info={entry.info} compact />
                      ) : (
                        <div className="space-y-1">
                          <PlatformBadge platform={entry.platform} />
                          <p className="truncate text-sm text-zinc-500">{entry.url}</p>
                          {entry.status === 'loading' && <p className="animate-pulse text-sm">Fetching info…</p>}
                          {entry.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{entry.error}</p>}
                        </div>
                      )}
                      {entry.status === 'ready' && (
                        <p className="mt-2 text-sm">
                          <span className="font-medium">{describeConfig(entry.info, entry.config)}</span>
                          {problem && <span className="text-red-600 dark:text-red-400"> · {problem}</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      {entry.status === 'ready' && (
                        <button type="button" onClick={() => setOpen(expanded ? null : entry.key)} aria-expanded={expanded}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                          {expanded ? 'Done' : 'Edit'}
                        </button>
                      )}
                      {entry.status === 'error' && (
                        <button type="button" onClick={() => load(entry)}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                          Retry
                        </button>
                      )}
                      <button type="button" onClick={() => remove(entry.key)} aria-label={`Remove item ${i + 1}`}
                        className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800">
                        Remove
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                      <ItemEditor info={entry.info} config={entry.config} limits={entry.info.limits}
                        update={(changes) => setEntries((list) => list.map((e) => (e.key === entry.key
                          ? { ...e, config: { ...e.config, ...changes } } : e)))} />
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ol>
      )}

      {entries.length > 0 && (
        <StickyBar>
          <PrimaryButton onClick={downloadAll} disabled={blocked || submitting}>
            {submitting ? 'Starting…' : `Download all ${entries.length} as one batch`}
          </PrimaryButton>
          {blocked && (
            <p className="mt-2 text-center text-sm text-zinc-500">
              {ready.length !== entries.length ? 'Waiting for every link to load (or remove the failed ones).' : 'Fix the items marked in red first.'}
            </p>
          )}
        </StickyBar>
      )}

      {!entries.length && (
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            ['Add links', 'Paste several YouTube or Instagram links at once, one per line.'],
            ['Set each one up', 'Click Edit to pick a format, cut clips or choose carousel items.'],
            ['Download all', 'Items run in a queue. Retry any that fail, then grab one ZIP.'],
          ].map(([title, text], i) => (
            <li key={title} className="rounded-2xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{i + 1}</span>
              <p className="mt-2 text-sm font-semibold">{title}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
