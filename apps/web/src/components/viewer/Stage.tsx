import type { Media, MediaFormat } from '@greenlit/shared'
import { AudioLines, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Slot } from '@/app/Slot'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, ProgressRing } from '@/ui'
import { useViewer } from './store'
import { usePlayer } from './usePlayer'

const BROWSER_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']

function fitRect(
  box: { width: number; height: number },
  natural: { width: number; height: number },
  pad: number,
) {
  const w = Math.max(0, box.width - pad * 2)
  const h = Math.max(0, box.height - pad * 2)
  if (!natural.width || !natural.height || !w || !h) return { x: pad, y: pad, width: w, height: h }
  const scale = Math.min(w / natural.width, h / natural.height)
  const width = Math.round(natural.width * scale)
  const height = Math.round(natural.height * scale)
  return { x: Math.round((box.width - width) / 2), y: Math.round((box.height - height) / 2), width, height }
}

/**
 * The stage: the current format fitted on black, nothing cropped, with every `media.viewer.overlay` entry drawn exactly
 * over the picture. Clicks that no overlay handles toggle playback.
 */
export function Stage({
  media,
  format,
  padding = 28,
}: {
  media: Media
  format: MediaFormat
  padding?: number
}) {
  const t = useT('viewer')
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [el, setEl] = useState<HTMLMediaElement | null>(null)
  const [naturalOverride, setNatural] = useState<{ width: number; height: number } | null>(null)
  const natural = naturalOverride ?? { width: format.width ?? 1920, height: format.height ?? 1080 }
  const frame = fitRect(
    size,
    format.kind === 'audio' || format.kind === 'document' ? { width: 16, height: 9 } : natural,
    padding,
  )
  usePlayer(el, format.fps ?? 30)

  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const ro = new ResizeObserver(
      ([e]) => e && setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    )
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    useViewer.getState().set({ frame, natural })
  }, [frame.x, frame.y, frame.width, frame.height, natural.width, natural.height])

  useEffect(() => setNatural(null), [format.id])

  const ready = format.processing.state === 'ready'
  const src = format.urls.preview ?? format.urls.original
  const imageSrc = BROWSER_IMAGES.includes(format.mime)
    ? format.urls.original
    : (format.urls.poster ?? format.urls.thumbnail)

  const toggle = () => {
    const s = useViewer.getState()
    if (!s.controls) return
    if (s.playing) s.controls.pause()
    else s.controls.play()
  }

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-stage select-none">
      <div
        className="absolute overflow-hidden"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          viewTransitionName: 'gl-frame',
        }}
        onClick={format.kind === 'video' ? toggle : undefined}
        onKeyDown={undefined}
        role="presentation"
      >
        {format.kind === 'video' && (
          <video
            key={format.id}
            ref={setEl}
            src={ready || format.urls.preview ? src : format.urls.original}
            poster={format.urls.poster ?? undefined}
            playsInline
            preload="auto"
            className="size-full bg-black object-contain"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.videoWidth && v.videoHeight && (!format.width || !format.height))
                setNatural({ width: v.videoWidth, height: v.videoHeight })
            }}
          />
        )}
        {format.kind === 'image' && imageSrc && (
          <img
            key={format.id}
            src={imageSrc}
            alt={media.title}
            draggable={false}
            className="size-full object-contain"
            onLoad={(e) => {
              const i = e.currentTarget
              if (!format.width || !format.height)
                setNatural({ width: i.naturalWidth, height: i.naturalHeight })
            }}
          />
        )}
        {format.kind === 'audio' && <AudioFace format={format} onElement={setEl} />}
        {(format.kind === 'document' || format.kind === 'other') && (
          <DocumentFace media={media} format={format} />
        )}
      </div>

      {/* Overlays sit on the picture rectangle; they receive pointer events only where they draw. */}
      <div
        className="pointer-events-none absolute"
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      >
        <Slot name="media.viewer.overlay" props={{ media, format }} />
      </div>

      {!ready && format.processing.state !== 'failed' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <span className="floating flex items-center gap-2 px-3 py-1.5 t-caption text-ink-2">
            <ProgressRing value={format.processing.progress} size={14} className="text-signal" />
            {t('processing')}
          </span>
        </div>
      )}
    </div>
  )
}

function AudioFace({
  format,
  onElement,
}: {
  format: MediaFormat
  onElement: (el: HTMLMediaElement | null) => void
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const time = useViewer((s) => s.time)
  const duration = useViewer((s) => s.duration) || format.duration || 1
  useEffect(() => {
    if (!format.urls.waveform) return
    void fetch(format.urls.waveform, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { peaks: number[] } | null) => setPeaks(d?.peaks ?? null))
      .catch(() => {})
  }, [format.urls.waveform])
  const bars = 160
  const sampled = peaks
    ? Array.from({ length: bars }, (_, i) => {
        const a = Math.floor((i / bars) * peaks.length)
        const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * peaks.length))
        let m = 0
        for (let j = a; j < b; j++) m = Math.max(m, peaks[j] ?? 0)
        return m
      })
    : null
  const played = time / duration
  return (
    <div className="flex size-full flex-col items-center justify-center gap-6 bg-[#0b0c0b] px-[6%]">
      <audio
        key={format.id}
        ref={onElement}
        src={format.urls.preview ?? format.urls.original}
        preload="auto"
      />
      {sampled ? (
        <div className="flex h-[46%] w-full items-center gap-[2px]">
          {sampled.map((p, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
              key={i}
              className={cn(
                'flex-1 rounded-full transition-colors duration-150',
                i / bars < played ? 'bg-signal' : 'bg-white/22',
              )}
              style={{ height: `${Math.max(3, p * 100)}%` }}
            />
          ))}
        </div>
      ) : (
        <AudioLines size={56} strokeWidth={1.2} className="text-white/30" />
      )}
      <div className="t-caption text-white/50">{format.filename}</div>
    </div>
  )
}

function DocumentFace({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('viewer')
  if (format.mime === 'application/pdf')
    return (
      <iframe title={media.title} src={`${format.urls.original}#view=FitH`} className="size-full bg-white" />
    )
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 bg-[#0b0c0b] text-center">
      {format.urls.poster ? (
        <img
          src={format.urls.poster}
          alt=""
          className="max-h-[70%] max-w-[80%] rounded-tile object-contain shadow-2xl"
        />
      ) : (
        <FileText size={48} strokeWidth={1.2} className="text-white/30" />
      )}
      <div className="t-callout text-white/60">{t('noPreview')}</div>
      <a href={format.urls.original} target="_blank" rel="noreferrer">
        <Button size="sm" icon={ExternalLink}>
          {t('openDocument')}
        </Button>
      </a>
    </div>
  )
}
