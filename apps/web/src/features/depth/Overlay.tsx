import { depthMapFor, type Media, type MediaFormat } from '@greenlit/shared'
import { ChevronsLeftRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useViewer } from '@/components/viewer/store'
import { useT } from '@/lib/i18n'
import { toast } from '@/ui'
import { Parallax, useLoadedImage } from './Parallax'
import { useDepthView } from './store'
import { followFrames } from './sync'

type Props = { media: Media; format: MediaFormat }

/** The format's depth map when it can be shown (read, or a video that plays as it is). */
export function useShownDepth(media: Media, format: MediaFormat) {
  const found = depthMapFor(media, format)
  const map = found?.map
  if (!map) return null
  const ready = map.processing.state === 'ready'
  const src =
    map.kind === 'video'
      ? (map.urls.preview ?? (ready ? map.urls.original : null))
      : (map.urls.poster ?? (ready && /^image\/(png|jpeg|webp)$/.test(map.mime) ? map.urls.original : null))
  return src ? { ...found, src } : null
}

/**
 * Drawn exactly over the frame, under the notes: the depth map in place of the picture, on the right of the split
 * line, or the picture in 3D. A video depth map plays locked to the video's frames.
 */
export function DepthOverlay({ media, format }: Props) {
  const view = useDepthView((s) => s.view)
  const shown = useShownDepth(media, format)
  if (view === 'picture' || !shown) return null
  return <DepthLayer key={shown.map.id} media={media} format={format} src={shown.src} map={shown.map} />
}

function DepthLayer({
  media,
  format,
  map,
  src,
}: Props & {
  map: MediaFormat
  src: string
}) {
  const t = useT('depth')
  const view = useDepthView((s) => s.view)
  const setView = useDepthView((s) => s.setView)
  const split = useDepthView((s) => s.split)
  const main = useViewer((s) => s.element)
  const [depthVideo, setDepthVideo] = useState<HTMLVideoElement | null>(null)
  const video = map.kind === 'video'

  useEffect(() => {
    if (!video || !depthVideo || !(main instanceof HTMLVideoElement)) return
    return followFrames(main, depthVideo, format.fps ?? 30)
  }, [video, depthVideo, main, format.fps])

  // 3D needs the picture itself: the video on stage, or the picture's preview.
  const pictureUrl =
    view === '3d' && format.kind === 'image' ? (format.urls.poster ?? format.urls.original) : null
  const pictureImg = useLoadedImage(pictureUrl)
  const depthImg = useLoadedImage(view === '3d' && !video ? src : null)
  const picture = format.kind === 'video' ? (main instanceof HTMLVideoElement ? main : null) : pictureImg

  const style: React.CSSProperties =
    view === 'split' ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : view === '3d' ? { opacity: 0 } : {}
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-black" style={style}>
        {video ? (
          <video
            ref={setDepthVideo}
            src={src}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 size-full object-fill"
          />
        ) : (
          <img
            src={src}
            alt={t('alt', { title: media.title })}
            draggable={false}
            className="absolute inset-0 size-full object-fill"
          />
        )}
      </div>
      {view === '3d' && (
        <Parallax
          picture={picture}
          depth={video ? depthVideo : depthImg}
          near={map.depth?.near ?? 'light'}
          onFail={() => {
            toast.error(new Error(t('no3d')))
            setView('depth')
          }}
        />
      )}
    </div>
  )
}

/**
 * Above the notes while the view is split: the line between picture and depth map, dragged by its knob (or moved
 * with the arrow keys), and the two sides' names.
 */
export function DepthSplitHandle({ media, format }: Props) {
  const t = useT('depth')
  const view = useDepthView((s) => s.view)
  const split = useDepthView((s) => s.split)
  const setSplit = useDepthView((s) => s.setSplit)
  const shown = useShownDepth(media, format)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  if (view !== 'split' || !shown) return null
  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (r?.width) setSplit((clientX - r.left) / r.width)
  }
  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2 py-0.5 t-micro text-white/85 backdrop-blur-sm">
        {t('picture')}
      </span>
      <span className="absolute top-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5 t-micro text-white/85 backdrop-blur-sm">
        {shown.inherited ? t('depthFromMain') : t('depth')}
      </span>
      <div className="absolute inset-y-0" style={{ left: `${split * 100}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white/85 shadow-[0_0_0_.5px_rgba(0,0,0,.35)]" />
        <button
          type="button"
          role="slider"
          aria-label={t('splitLine')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          className="press pointer-events-auto absolute top-1/2 -mt-4 -ml-4 grid size-8 cursor-ew-resize touch-none place-items-center rounded-full bg-white text-black shadow-[0_2px_10px_rgba(0,0,0,.45)] outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = true
          }}
          onPointerMove={(e) => dragging.current && at(e.clientX)}
          onPointerUp={() => {
            dragging.current = false
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02
            if (e.key === 'ArrowLeft') setSplit(split - step)
            else if (e.key === 'ArrowRight') setSplit(split + step)
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <ChevronsLeftRight size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
