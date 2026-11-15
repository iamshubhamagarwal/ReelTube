import { totalLength } from '../lib/clips'
import ClipsEditor from './ClipsEditor'
import DownloadOptions from './DownloadOptions'
import MediaPicker from './MediaPicker'

export function SectionTitle({ step, title, hint, children }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {step && (
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
            {step}
          </span>
        )}
        <div>
          <h3 className="font-semibold leading-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * All settings for one link: format/quality, the "Cut clips" editor, or the
 * Instagram media picker. Used by both the Single and Batch tabs.
 *   config: see defaultConfig() in lib/clips.js
 *   update(patch): merge a change into config
 */
export default function ItemEditor({ info, config, update, limits }) {
  // Instagram carousels / image posts / stories: pick items to download.
  if (info.platform === 'instagram' && !info.is_video) {
    return (
      <div>
        <SectionTitle step="1" title="Choose items" hint="Tap to select the photos and videos you want." />
        <MediaPicker info={info} selected={config.media} onChange={(media) => update({ media })} />
      </div>
    )
  }

  const sizeRatio = config.clipsOn && info.duration ? Math.min(totalLength(config.clips) / info.duration, 1) || 1 : 1

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle step="1" title="Format" />
        <DownloadOptions info={info} config={config} update={update} sizeRatio={sizeRatio} />
      </div>

      <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <SectionTitle step="2" title="Cut clips" hint="Optional. Only the parts you choose are downloaded.">
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input type="checkbox" className="peer sr-only" checked={config.clipsOn}
              onChange={(e) => update({ clipsOn: e.target.checked })} aria-label="Cut clips" />
            <span className="relative h-6 w-11 rounded-full bg-zinc-300 transition peer-checked:bg-rose-600 peer-focus-visible:ring-2 peer-focus-visible:ring-rose-500/50 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5 dark:bg-zinc-700" />
          </label>
        </SectionTitle>
        {config.clipsOn && <ClipsEditor info={info} config={config} update={update} limits={limits} />}
      </div>
    </div>
  )
}
