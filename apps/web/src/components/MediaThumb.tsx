import type { Media, MediaFormat } from '@greenlit/shared'
import {
  AudioLines,
  File as FileIcon,
  FileText,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  PenTool,
  Video,
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { loadSprite, primaryFormat, type SpriteInfo } from '@/data/media'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { ProgressRing } from '@/ui'

const KIND_ICON = {
  video: Video,
  image: ImageIcon,
  audio: AudioLines,
  document: FileText,
  design: PenTool,
  slides: GalleryHorizontalEnd,
  other: FileIcon,
}

/**
 * A media frame: the thumbnail on the stage colour, fitted (`contain`, nothing cropped) or filled (`cover`).
 * Videos scrub through their sprite sheet as the pointer moves across (`scrub`). Duration as a mono timecode.
 * Processing shows a ring; archived files stay browsable.
 */
export function MediaThumb({
  media,
  format,
  fit = 'cover',
  scrub = false,
  showDuration = true,
  className,
  style,
  rounded = true,
  viewTransitionName,
}: {
  media: Pick<Media, 'id' | 'kind' | 'title' | 'thumbnailUrl' | 'formats' | 'slides'>
  format?: MediaFormat
  fit?: 'cover' | 'contain'
  scrub?: boolean
  showDuration?: boolean
  className?: string
  style?: CSSProperties
  rounded?: boolean
  viewTransitionName?: string
}) {
  const f = format ?? primaryFormat(media)
  const thumb = f?.urls.thumbnail ?? media.thumbnailUrl
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sprite, setSprite] = useState<SpriteInfo | null>(null)
  const [pos, setPos] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const Icon = KIND_ICON[media.kind] ?? FileIcon
  const processing = f && f.processing.state !== 'ready' && f.processing.state !== 'failed'

  useEffect(() => {
    if (!scrub || !f?.urls.sprite || pos === null || sprite) return
    void loadSprite(f.urls.sprite).then(setSprite)
  }, [scrub, f?.urls.sprite, pos, sprite])

  const onMove = (e: React.PointerEvent) => {
    if (!scrub || !f?.urls.sprite || e.pointerType === 'touch') return
    const r = box.current!.getBoundingClientRect()
    setPos(Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width)))
  }

  let spriteStyle: CSSProperties | null = null
  if (sprite && pos !== null && f?.urls.sprite && box.current) {
    const i = Math.floor(pos * sprite.count)
    const col = i % sprite.cols
    const row = Math.floor(i / sprite.cols)
    const bw = box.current.clientWidth
    const bh = box.current.clientHeight
    // scale one tile to cover the box
    const scale =
      fit === 'cover' ? Math.max(bw / sprite.w, bh / sprite.h) : Math.min(bw / sprite.w, bh / sprite.h)
    const tw = sprite.w * scale
    const th = sprite.h * scale
    spriteStyle = {
      backgroundImage: `url(${f.urls.sprite})`,
      backgroundSize: `${sprite.cols * tw}px ${sprite.rows * th}px`,
      backgroundPosition: `${-col * tw + (bw - tw) / 2}px ${-row * th + (bh - th) / 2}px`,
      backgroundRepeat: 'no-repeat',
    }
  }

  return (
    <div
      ref={box}
      onPointerMove={onMove}
      onPointerLeave={() => setPos(null)}
      className={cn('relative isolate overflow-hidden bg-stage', rounded && 'rounded-tile', className)}
      style={{ ...style, viewTransitionName }}
    >
      {thumb && !failed ? (
        <img
          src={thumb}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 size-full transition-[opacity,transform] duration-500 ease-out',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[#5c605d]">
          <Icon size={22} strokeWidth={1.5} />
        </div>
      )}
      {spriteStyle && <div className="absolute inset-0" style={spriteStyle} />}
      {pos !== null && spriteStyle && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/20">
          <div className="h-full bg-white" style={{ width: `${pos * 100}%` }} />
        </div>
      )}
      {processing && (
        <div className="absolute inset-0 grid place-items-center bg-black/35 text-white backdrop-blur-[2px]">
          <ProgressRing value={f.processing.progress} size={22} />
        </div>
      )}
      {showDuration && f?.duration ? (
        <span className="force-dark absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/55 px-1.5 py-px t-meta text-[11px] text-white/95 backdrop-blur-md">
          {pos !== null && sprite ? formatDuration(pos * f.duration) : formatDuration(f.duration)}
        </span>
      ) : null}
      {/* Slides: how many pictures sit behind the first one. */}
      {showDuration && media.kind === 'slides' ? (
        <span className="force-dark absolute right-1.5 bottom-1.5 flex h-[22px] items-center gap-1 rounded-[5px] bg-black/55 px-1.5 t-meta text-[11px] text-white/95 tabular-nums backdrop-blur-md">
          <GalleryHorizontalEnd size={12} strokeWidth={1.75} />
          {media.slides?.length ?? 0}
        </span>
      ) : null}
      {/* A design document's corner mark: its pictures (exports) look the same otherwise. */}
      {showDuration && media.kind === 'design' && thumb && !failed ? (
        <span className="force-dark absolute right-1.5 bottom-1.5 grid size-[22px] place-items-center rounded-[5px] bg-black/55 text-white/95 backdrop-blur-md">
          <PenTool size={12} strokeWidth={1.75} />
        </span>
      ) : null}
    </div>
  )
}

export function kindIcon(kind: string) {
  return KIND_ICON[kind as keyof typeof KIND_ICON] ?? FileIcon
}
