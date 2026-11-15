import { detectPlatform } from '../lib/clips'
import PlatformBadge from './PlatformBadge'

/**
 * The "paste a link" box.
 * - Pasting a YouTube/Instagram link fetches it right away (no extra click).
 * - Shows a platform badge as soon as the link is recognised.
 * onSubmit(url) receives the URL to fetch.
 */
export default function UrlForm({ url, setUrl, onSubmit, loading }) {
  const platform = detectPlatform(url)

  const takeLink = (text) => {
    const link = (text || '').trim()
    setUrl(link)
    if (detectPlatform(link)) onSubmit(link)
  }

  const pasteButton = async () => {
    try {
      takeLink(await navigator.clipboard.readText())
    } catch { /* clipboard permission denied - user can paste manually */ }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(url) }} className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <svg className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-400" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (detectPlatform(text)) { e.preventDefault(); takeLink(text) }
          }}
          placeholder="Paste a YouTube or Instagram link…"
          aria-label="Link"
          autoFocus
          // Right padding leaves room for the badge / clear / Paste buttons.
          className={(url ? (platform ? 'pr-36' : 'pr-12') : 'pr-20') +
            ' w-full rounded-xl border border-zinc-300 bg-white py-3.5 pl-11 text-base shadow-sm outline-none placeholder:text-zinc-400 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 dark:border-zinc-700 dark:bg-zinc-900'}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          <PlatformBadge platform={platform} />
          {url ? (
            <button type="button" onClick={() => setUrl('')} aria-label="Clear link"
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          ) : navigator.clipboard?.readText && (
            <button type="button" onClick={pasteButton}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              Paste
            </button>
          )}
        </div>
      </div>
      <button type="submit" disabled={loading || !url.trim()}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3.5 font-semibold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
        {loading ? 'Fetching' : 'Fetch'}
      </button>
    </form>
  )
}
