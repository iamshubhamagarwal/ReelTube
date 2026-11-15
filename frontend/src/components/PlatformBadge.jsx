// Small "YouTube" / "Instagram" pill shown once a link is detected.
const STYLES = {
  youtube: 'bg-red-600/10 text-red-700 dark:text-red-400',
  instagram: 'bg-gradient-to-r from-amber-500/15 via-pink-500/15 to-purple-600/15 text-pink-700 dark:text-pink-300',
}
const NAMES = { youtube: 'YouTube', instagram: 'Instagram' }

export default function PlatformBadge({ platform, className = '' }) {
  if (!platform) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[platform]} ${className}`}>
      {NAMES[platform]}
    </span>
  )
}
