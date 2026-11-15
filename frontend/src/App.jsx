import { useState } from 'react'
import BatchTab from './components/BatchTab'
import SingleTab from './components/SingleTab'
import ThemeToggle from './components/ThemeToggle'

const TABS = [
  {
    key: 'single',
    label: 'Single',
    icon: <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
  },
  {
    key: 'batch',
    label: 'Batch',
    icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  },
]

export default function App() {
  const [tab, setTab] = useState('single')

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Soft brand glow behind the header (decorative) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 -z-10 mx-auto h-80 max-w-3xl rounded-full bg-gradient-to-r from-red-500/20 via-pink-500/20 to-purple-500/20 blur-3xl dark:from-red-600/15 dark:via-pink-600/15 dark:to-purple-600/15" />

      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
        <header className="flex items-center justify-between py-5">
          <a href="/" className="flex items-center gap-2.5" aria-label="ReelTube home">
            {/* Logo: YouTube red blending into Instagram pink/purple */}
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-red-600 via-pink-600 to-purple-600 text-white shadow-lg shadow-pink-600/25">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z" /></svg>
            </span>
            <span className="text-xl font-extrabold tracking-tight">ReelTube</span>
          </a>
          <ThemeToggle />
        </header>

        <div role="tablist" aria-label="Mode" className="mb-5 grid grid-cols-2 rounded-xl border border-zinc-200 bg-white/70 p-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={'flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ' + (tab === t.key
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>{t.icon}</svg>
              {t.label}
            </button>
          ))}
        </div>

        {/* Both tabs stay mounted so switching doesn't lose your work. */}
        <main className="flex-1">
          <section id="panel-single" role="tabpanel" hidden={tab !== 'single'}><SingleTab /></section>
          <section id="panel-batch" role="tabpanel" hidden={tab !== 'batch'}><BatchTab /></section>
        </main>

        <footer className="py-8 text-center text-xs text-zinc-400">
          Only download content you own or have permission to use. Files are deleted after 1 hour.
        </footer>
      </div>
    </div>
  )
}
