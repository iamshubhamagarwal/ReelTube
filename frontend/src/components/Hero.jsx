// Shown on the Single tab before a link is loaded: what the app does + an example.

const FEATURES = [
  {
    title: 'HD up to 4K',
    text: 'MP4 with the best video and audio merged.',
    icon: <path d="M3 5h18v14H3zM7 9v6M7 12h3M10 9v6M14 9h2a2 2 0 0 1 0 6h-2z" />,
  },
  {
    title: 'Cut many clips',
    text: 'Frame-accurate, as a ZIP or merged into one.',
    icon: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></>,
  },
  {
    title: 'MP3 audio',
    text: '128–320 kbps with cover art and tags.',
    icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  },
  {
    title: 'Instagram too',
    text: 'Reels, videos, photos and carousels.',
    icon: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></>,
  },
]

export const EXAMPLE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

export default function Hero({ onExample }) {
  return (
    <section className="pt-4 pb-2 text-center">
      <h2 className="mx-auto max-w-xl text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        Download & clip videos from{' '}
        <span className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 bg-clip-text text-transparent">
          YouTube and Instagram
        </span>
      </h2>
      <p className="mx-auto mt-3 max-w-md text-zinc-500 dark:text-zinc-400">
        Paste a link above. No sign-up, nothing to install.
      </p>
      <button
        type="button"
        onClick={() => onExample(EXAMPLE_URL)}
        className="mt-3 text-sm font-medium text-rose-600 underline-offset-4 hover:underline dark:text-rose-400"
      >
        Try it with an example video →
      </button>

      <ul className="mt-8 grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-2xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className="text-rose-500" aria-hidden>
              {f.icon}
            </svg>
            <p className="mt-2 text-sm font-semibold">{f.title}</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{f.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
