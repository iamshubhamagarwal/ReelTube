import { forwardRef, useImperativeHandle, useRef } from 'react'
import YouTubePlayer from './YouTubePlayer'

/**
 * One player API for both platforms, used through a ref:
 *   ref.current.getCurrentTime(), .seekTo(sec), .play(), .pause()
 * YouTube -> embedded IFrame player; Instagram -> plain <video> element.
 */
const Player = forwardRef(function Player({ info }, ref) {
  if (info.platform === 'youtube') return <YouTubePlayer ref={ref} videoId={info.id} />
  return <Html5Player ref={ref} src={info.preview_url} poster={info.thumbnail} />
})

const Html5Player = forwardRef(function Html5Player({ src, poster }, ref) {
  const video = useRef(null)
  useImperativeHandle(ref, () => ({
    getCurrentTime: () => video.current?.currentTime ?? null,
    seekTo: (sec) => { if (video.current) video.current.currentTime = sec },
    play: () => video.current?.play().catch(() => {}),
    pause: () => video.current?.pause(),
  }), [])

  if (!src) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-xl bg-black p-4 text-center text-sm text-zinc-400">
        No preview available. You can still type start and end times.
      </div>
    )
  }
  return (
    <video
      ref={video}
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      referrerPolicy="no-referrer"
      className="max-h-[60vh] w-full rounded-xl bg-black"
    />
  )
})

export default Player
