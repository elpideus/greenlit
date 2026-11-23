import type { Media, MediaFormat } from '@greenlit/shared'
import { Maximize, Minimize, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { IconButton, Menu, Popover, Slider } from '@/ui'
import { AudioTrackMenu } from './AudioTracks'
import { Scrubber } from './Scrubber'
import { useViewer } from './store'

const RATES = [0.25, 0.5, 1, 1.5, 2]

/** Playback controls under the stage (video and audio). */
export function Transport({
  media,
  format,
  fullscreen,
  onFullscreen,
}: {
  media: Media
  format: MediaFormat
  fullscreen: boolean
  onFullscreen: () => void
}) {
  const t = useT('viewer')
  const playing = useViewer((s) => s.playing)
  const time = useViewer((s) => s.time)
  const duration = useViewer((s) => s.duration) || format.duration || 0
  const fps = useViewer((s) => s.fps)
  const rate = useViewer((s) => s.rate)
  const loop = useViewer((s) => s.loop)
  const volume = useViewer((s) => s.volume)
  const muted = useViewer((s) => s.muted)
  const set = useViewer((s) => s.set)
  const controls = useViewer((s) => s.controls)
  const [frames, setFrames] = useState(false)
  const tc = (s: number) => (frames ? formatTimecode(s, fps) : formatTimecode(s, fps).replace(/:\d+$/, ''))
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="flex flex-col gap-1 px-4 pt-1 pb-3">
      <Scrubber media={media} format={format} />
      <div className="flex h-9 items-center gap-1">
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? t('pause') : t('play')}
          shortcut="space"
          tooltip="top"
          onClick={() => (playing ? controls?.pause() : controls?.play())}
          className="-ml-1.5 text-white"
        />
        <button
          type="button"
          onClick={() => setFrames((f) => !f)}
          className="press rounded-[6px] px-1.5 py-1 t-meta text-[12px] text-white/90 hover:bg-white/8"
          title={t('frames')}
        >
          {tc(time)}
          <span className="text-white/35"> / {tc(duration)}</span>
        </button>
        <span className="flex-1" />
        {format.kind === 'video' && <AudioTrackMenu media={media} />}
        <Menu
          side="top"
          align="end"
          width={140}
          trigger={
            <button
              type="button"
              className="press h-7 rounded-[6px] px-2 t-meta text-white/70 hover:bg-white/8 hover:text-white"
              aria-label={t('speed')}
            >
              {rate}×
            </button>
          }
          items={RATES.map((r) => ({
            label: `${r}×`,
            checked: r === rate,
            onSelect: () => set({ rate: r }),
          }))}
        />
        <IconButton
          icon={Repeat}
          label={t('loop')}
          tooltip="top"
          active={loop || undefined}
          onClick={() => set({ loop: !loop })}
          size="sm"
        />
        <Popover
          side="top"
          align="center"
          width={44}
          trigger={
            <IconButton
              icon={VolumeIcon}
              label={muted ? t('unmute') : t('mute')}
              shortcut="m"
              tooltip={false}
              size="sm"
            />
          }
        >
          <div className="flex h-32 flex-col items-center gap-2 py-3">
            <div className="flex h-full w-5 items-center justify-center">
              <div className="w-24 -rotate-90">
                <Slider
                  value={muted ? 0 : volume}
                  onChange={(v) => set({ volume: v, muted: v === 0 })}
                  label="Volume"
                />
              </div>
            </div>
            <button
              type="button"
              className="press t-micro text-ink-3 hover:text-ink"
              onClick={() => set({ muted: !muted })}
            >
              {muted ? t('unmute') : t('mute')}
            </button>
          </div>
        </Popover>
        <IconButton
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
          shortcut="f"
          tooltip="top"
          size="sm"
          onClick={onFullscreen}
          className={cn('-mr-1')}
        />
      </div>
    </div>
  )
}
