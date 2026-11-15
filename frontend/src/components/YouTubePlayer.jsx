import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Loads the YouTube IFrame API script once and resolves with window.YT.
let apiPromise = null
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT) }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.onerror = () => { apiPromise = null; reject(new Error('Could not load the YouTube player')) }
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

/**
 * Embedded YouTube player. Parent components control it through a ref:
 *   ref.current.getCurrentTime(), .seekTo(sec), .play(), .pause()
 */
const YouTubePlayer = forwardRef(function YouTubePlayer({ videoId }, ref) {
  const holder = useRef(null)
  const player = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !holder.current) return
        // The API replaces this inner div with an <iframe>.
        const el = document.createElement('div')
        holder.current.replaceChildren(el)
        player.current = new YT.Player(el, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      try { player.current?.destroy() } catch { /* already gone */ }
      player.current = null
    }
  }, [videoId])

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => player.current?.getCurrentTime?.() ?? null,
    seekTo: (sec) => player.current?.seekTo?.(sec, true),
    play: () => player.current?.playVideo?.(),
    pause: () => player.current?.pauseVideo?.(),
  }), [])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <div ref={holder} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-zinc-400">
          The preview player couldn't load. You can still type start and end times.
        </div>
      )}
    </div>
  )
})

export default YouTubePlayer
