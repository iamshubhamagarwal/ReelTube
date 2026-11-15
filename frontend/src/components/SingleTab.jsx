import { useState } from 'react'
import { getInfo, startDownload } from '../lib/api'
import { configProblem, defaultConfig, describeConfig, detectPlatform, estimateSize, toPayload } from '../lib/clips'
import { formatBytes } from '../lib/time'
import Hero from './Hero'
import ItemEditor from './ItemEditor'
import ProgressPanel from './ProgressPanel'
import RecentDownloads from './RecentDownloads'
import { Card, ErrorBox, PrimaryButton, Skeleton, StickyBar } from './ui'
import UrlForm from './UrlForm'
import VideoCard from './VideoCard'

// One link: fetch info -> choose options/clips -> download with live progress.
export default function SingleTab() {
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)

  const update = (patch) => setConfig((c) => ({ ...c, ...patch }))

  const fetchInfo = async (target = url) => {
    if (!target.trim() || loading) return
    setUrl(target)
    setLoading(true)
    setError('')
    setInfo(null)
    setJobId(null)
    try {
      const data = await getInfo(target)
      setInfo(data)
      setConfig(defaultConfig(data))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const { job_id } = await startDownload(toPayload(info, config))
      setJobId(job_id)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Drop a link (dragged from the address bar or another page) anywhere here.
  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text')
    const link = text.split(/\s+/).find((t) => detectPlatform(t))
    if (link) fetchInfo(link)
  }

  const problem = info && config ? configProblem(info, config) : null
  const size = info && config ? estimateSize(info, config) : null

  return (
    <div
      className="relative space-y-5"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute -inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-rose-500 bg-rose-500/10 text-sm font-semibold text-rose-600 backdrop-blur-sm dark:text-rose-300">
          Drop the link to fetch it
        </div>
      )}

      <UrlForm url={url} setUrl={setUrl} onSubmit={fetchInfo} loading={loading} />
      <ErrorBox message={error} onDismiss={() => setError('')} />

      {!info && !loading && (
        <>
          <Hero onExample={fetchInfo} />
          <RecentDownloads />
        </>
      )}
      {loading && <Skeleton />}

      {info && config && (
        <>
          <Card><VideoCard info={info} /></Card>
          {jobId ? (
            <ProgressPanel key={jobId} jobId={jobId} onReset={() => setJobId(null)} />
          ) : (
            <>
              <Card><ItemEditor info={info} config={config} update={update} limits={info.limits} /></Card>
              <StickyBar>
                <PrimaryButton onClick={submit} disabled={submitting || Boolean(problem)}>
                  {submitting ? 'Starting…' : (
                    // Phones: "Download" on one line, the summary below it. Wider: one line.
                    <span className="flex flex-col items-center sm:flex-row sm:justify-center sm:gap-2">
                      <span>Download</span>
                      <span className="text-sm font-normal opacity-90 sm:text-base">
                        <span className="hidden sm:inline">· </span>
                        {describeConfig(info, config)}{size ? ` · ~${formatBytes(size)}` : ''}
                      </span>
                    </span>
                  )}
                </PrimaryButton>
                {problem && <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">{problem}</p>}
              </StickyBar>
            </>
          )}
        </>
      )}
    </div>
  )
}
