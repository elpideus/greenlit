import type { Media, MediaFormat } from '@greenlit/shared'
import { useEffect, useRef, useState } from 'react'
import { Slot } from '@/app/Slot'
import { loadSprite, type SpriteInfo } from '@/data/media'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import { useViewer } from './store'

/** Props for `media.scrubber.markers` entries: markers drawn on the scrubber track (notes, chapters). */
export interface ScrubberMarkersProps {
  media: Media
  format: MediaFormat
  duration: number
}

/**
 * The scrubber: 1:1 with the pointer while dragging (playback pauses and resumes), a sprite frame and timecode while
 * hovering, buffered range, and the markers features add (`media.scrubber.markers`).
 */
export function Scrubber({ media, format }: { media: Media; format: MediaFormat }) {
  const track = useRef<HTMLDivElement>(null)
  const time = useViewer((s) => s.time)
  const duration = useViewer((s) => s.duration) || format.duration || 0
  const fps = useViewer((s) => s.fps)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  const [sprite, setSprite] = useState<SpriteInfo | null>(null)
  const wasPlaying = useRef(false)

  useEffect(() => {
    setSprite(null)
    if (format.urls.sprite) void loadSprite(format.urls.sprite).then(setSprite)
  }, [format.urls.sprite])

  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }

  const onDown = (e: React.PointerEvent) => {
    if (!duration) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const s = useViewer.getState()
    wasPlaying.current = s.playing
    s.controls?.pause()
    setDrag(true)
    s.controls?.seek(at(e.clientX))
  }
  const onMove = (e: React.PointerEvent) => {
    if (!duration) return
    const t = at(e.clientX)
    setHover(t)
    if (drag) useViewer.getState().controls?.seek(t)
  }
  const onUp = () => {
    if (!drag) return
    setDrag(false)
    if (wasPlaying.current) useViewer.getState().controls?.play()
  }

  const pct = duration ? (time / duration) * 100 : 0
  const hoverPct = hover !== null && duration ? (hover / duration) * 100 : null
  const trackW = track.current?.clientWidth ?? 0

  let preview: React.CSSProperties | null = null
  const pw = 168
  if (sprite && hover !== null && format.urls.sprite) {
    const i = Math.min(sprite.count - 1, Math.floor((hover / duration) * sprite.count))
    const scale = pw / sprite.w
    preview = {
      width: pw,
      height: Math.round(sprite.h * scale),
      backgroundImage: `url(${format.urls.sprite})`,
      backgroundSize: `${sprite.cols * pw}px ${sprite.rows * sprite.h * scale}px`,
      backgroundPosition: `${-(i % sprite.cols) * pw}px ${-Math.floor(i / sprite.cols) * sprite.h * scale}px`,
    }
  }

  return (
    <div
      ref={track}
      className="group relative flex h-7 cursor-default touch-none items-center"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => !drag && setHover(null)}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      tabIndex={-1}
    >
      <div
        className={cn(
          'relative h-[3px] w-full rounded-full bg-white/16 transition-[height] duration-150 ease-out',
          (drag || hover !== null) && 'h-[5px]',
        )}
      >
        {hoverPct !== null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/18"
            style={{ width: `${hoverPct}%` }}
          />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full bg-signal" style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(0,0,0,.25),0_2px_6px_rgba(0,0,0,.5)] transition-transform duration-150',
          drag ? 'scale-125' : 'scale-0 group-hover:scale-100',
        )}
        style={{ left: `${pct}%` }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full">
        <div className="pointer-events-auto">
          <Slot<ScrubberMarkersProps> name="media.scrubber.markers" props={{ media, format, duration }} />
        </div>
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-3 flex -translate-x-1/2 flex-col items-center gap-1.5"
          style={{ left: Math.max(pw / 2 + 4, Math.min(trackW - pw / 2 - 4, (hover / duration) * trackW)) }}
        >
          {preview && (
            <div
              className="overflow-hidden rounded-[8px] bg-black shadow-[0_10px_30px_-6px_rgba(0,0,0,.8),0_0_0_1px_rgba(255,255,255,.14)]"
              style={preview}
            />
          )}
          <span className="rounded-[5px] bg-black/80 px-1.5 py-0.5 t-meta text-white backdrop-blur-md">
            {formatTimecode(hover, fps)}
          </span>
        </div>
      )}
    </div>
  )
}
