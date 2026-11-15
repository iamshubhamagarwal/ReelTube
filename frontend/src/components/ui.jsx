// Tiny shared layout pieces.

export function Card({ children, className = '' }) {
  return (
    <div className={'rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/60 dark:shadow-none ' + className}>
      {children}
    </div>
  )
}

export function ErrorBox({ message, onDismiss }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
      </svg>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-60 hover:opacity-100">✕</button>
      )}
    </div>
  )
}

export function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading video info">
      <div className="flex animate-pulse gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="aspect-video w-32 rounded-lg bg-zinc-200 sm:w-48 dark:bg-zinc-800" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 w-16 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-4/5 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-2/5 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
      <div className="h-40 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
    </div>
  )
}

/**
 * Bottom bar that sticks to the viewport while you scroll through long
 * editors, so the main action is always reachable (especially on phones).
 */
export function StickyBar({ children }) {
  return (
    // The faded top edge is click-through (pointer-events-none) so it never
    // blocks buttons scrolling underneath it; only the bar's content is clickable.
    <div className="pointer-events-none sticky bottom-0 z-40 -mx-4 mt-2 bg-gradient-to-t from-zinc-50 via-zinc-50/95 to-zinc-50/0 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] dark:from-zinc-950 dark:via-zinc-950/95 dark:to-zinc-950/0">
      <div className="pointer-events-auto">{children}</div>
    </div>
  )
}

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={'w-full rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-rose-600/25 transition hover:brightness-110 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ' + className}
    >
      {children}
    </button>
  )
}
