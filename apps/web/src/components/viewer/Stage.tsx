import type { Media, MediaFormat } from '@greenlit/shared'
import { AudioLines, ExternalLink, FileText } from 'lucide-react'
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Slot, useSlot } from '@/app/Slot'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, ProgressRing } from '@/ui'
import { useViewer } from './store'
import { useAudioTrack, usePlayer } from './usePlayer'

const CHECKER = 'repeating-conic-gradient(#5f605f 0% 25%, #4b4c4b 0% 50%) 0 0 / 20px 20px'

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

/** Two videos as long as each other (within a few frames): another version or shape of the same cut. */
export function sameLength(a: MediaFormat, b: MediaFormat) {
  return (
    a.kind === 'video' &&
    b.kind === 'video' &&
    !!a.duration &&
    !!b.duration &&
    Math.abs(a.duration - b.duration) <= LENGTH_TOLERANCE
  )
}
const LENGTH_TOLERANCE = 0.15

/**
 * The stage: the current format fitted on black, nothing cropped, with every `media.viewer.overlay` entry drawn exactly
 * over the picture. Clicks that no overlay handles toggle playback.
 *
 * Switching to another version or shape of the same length is seamless: the new video loads hidden at the moment on
 * screen and takes over when it has that frame (playing on if the old one was playing), so nothing restarts or
 * goes blank. Until then the old one stays on screen (`shown`).
 */
export function Stage({
  media,
  format: wanted,
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
  const [nextEl, setNextEl] = useState<HTMLVideoElement | null>(null)
  const [shown, setShown] = useState(wanted)
  // A different length (or not a video): switch at once, from the start. The same file with new data: take it.
  if (wanted.id !== shown.id ? !(sameLength(shown, wanted) && el) : wanted !== shown) setShown(wanted)
  const pending = wanted.id !== shown.id ? wanted : null
  const format = shown
  const [naturalOverride, setNatural] = useState<{ width: number; height: number } | null>(null)
  const natural = naturalOverride ?? { width: format.width ?? 1920, height: format.height ?? 1080 }
  const frame = fitRect(
    size,
    format.kind === 'audio' || format.kind === 'document' || format.kind === 'design'
      ? { width: 16, height: 9 }
      : natural,
    padding,
  )
  usePlayer(el, format.fps ?? 30)
  const trackKey = useViewer((s) => s.audioTrack)
  const track = format.kind === 'video' ? media.audioTracks.find((a) => a.key === trackKey) : undefined
  useAudioTrack(el, track ? (track.urls.preview ?? track.urls.original) : null)

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

  // A file whose size isn't known yet (still being prepared) takes the video's own.
  useEffect(() => {
    const v = el instanceof HTMLVideoElement ? el : null
    setNatural(
      v?.videoWidth && (!format.width || !format.height)
        ? { width: v.videoWidth, height: v.videoHeight }
        : null,
    )
  }, [format.id, el])

  // The seamless hand-over to `pending` (see handOver).
  useEffect(() => {
    if (!pending || !nextEl || !(el instanceof HTMLVideoElement)) return
    return handOver(el, nextEl, () => setShown(pending))
  }, [pending?.id, nextEl, el])

  const ready = format.processing.state === 'ready'
  const imageSrc = BROWSER_IMAGES.includes(format.mime)
    ? format.urls.original
    : (format.urls.poster ?? format.urls.thumbnail)

  // A feature that shows this kind of file itself (a design document in FigCraft) takes the whole stage.
  const faces = useSlot('media.viewer.stage', { media, format })
  const Face = faces[0]?.component

  const toggle = () => {
    const s = useViewer.getState()
    if (!s.controls) return
    if (s.playing) s.controls.pause()
    else s.controls.play()
  }

  if (Face)
    return (
      <div ref={box} className="relative h-full w-full overflow-hidden bg-stage">
        <Suspense fallback={null}>
          <Face media={media} format={format} />
        </Suspense>
      </div>
    )

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
        {format.kind === 'video' &&
          // The one on screen, and the one taking over (hidden, silent) while it lines up. Keys keep each element
          // when it changes role, so the hand-over never reloads it.
          [format, ...(pending ? [pending] : [])].map((f) => {
            const current = f.id === format.id
            const fReady = f.processing.state === 'ready'
            const fSrc = f.urls.preview ?? f.urls.original
            return (
              <video
                key={f.id}
                ref={current ? setEl : setNextEl}
                src={fReady || f.urls.preview ? fSrc : f.urls.original}
                poster={f.urls.poster ?? undefined}
                playsInline
                preload="auto"
                className="absolute inset-0 size-full bg-black object-contain"
                style={{ opacity: current ? 1 : 0 }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (current && v.videoWidth && v.videoHeight && (!f.width || !f.height))
                    setNatural({ width: v.videoWidth, height: v.videoHeight })
                }}
              />
            )
          })}
        {format.kind === 'image' && imageSrc && (
          <img
            key={format.id}
            src={imageSrc}
            alt={media.title}
            draggable={false}
            className="size-full object-contain"
            // Pictures that can be transparent (logos, icons) sit on a grey checkerboard: white and dark artwork
            // both read on it, and an opaque picture covers it.
            style={
              /^image\/(png|svg\+xml|webp|gif|avif)$/.test(format.mime) ? { background: CHECKER } : undefined
            }
            onLoad={(e) => {
              const i = e.currentTarget
              if (!format.width || !format.height)
                setNatural({ width: i.naturalWidth, height: i.naturalHeight })
            }}
          />
        )}
        {format.kind === 'audio' && <AudioFace format={format} onElement={setEl} />}
        {(format.kind === 'document' || format.kind === 'design' || format.kind === 'other') && (
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

/**
 * Lines `next` up with `current` and hands over to it: paused, it seeks to the same moment and swaps once that frame
 * is drawn; playing, it waits a little ahead of the playhead and swaps (and plays on) when the old video gets
 * there. Seeks, pauses or speed changes on the old one meanwhile just make it line up again. A video that won't
 * get ready in a few seconds takes over anyway. Returns a cancel function.
 */
function handOver(current: HTMLVideoElement, next: HTMLVideoElement, done: () => void) {
  /** How far past the lined-up frame the old video may be at the swap (two frames): more would show as a jump back. */
  const MAX_LATE = 0.08
  let cancelled = false
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const once = (v: HTMLVideoElement, events: string[], timeout: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        for (const e of events) v.removeEventListener(e, finish)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeout)
      for (const e of events) v.addEventListener(e, finish)
    })
  const seek = async (t: number) => {
    if (next.readyState < 1) await once(next, ['loadedmetadata', 'error'], 4000)
    const target = Math.max(0, Math.min(t, Number.isFinite(next.duration) ? next.duration : t))
    if (Math.abs(next.currentTime - target) > 0.001) {
      const seeked = once(next, ['seeked', 'error'], 4000)
      next.currentTime = target
      await seeked
    }
    return target
  }
  /** Ready to show (paused) or to play on (playing) from where it is. */
  const ready = (enough: number) =>
    next.readyState >= enough
      ? Promise.resolve()
      : once(next, ['canplay', 'canplaythrough', 'loadeddata', 'error'], 4000)
  const swap = () => {
    if (cancelled) return
    next.playbackRate = current.playbackRate
    next.loop = current.loop
    next.volume = current.volume
    next.muted = current.muted
    next.style.opacity = '1'
    // The old one goes silent now and stops when it leaves the page (its pause is then ignored, see usePlayer).
    current.muted = true
    if (!current.paused) void next.play().catch(() => {})
    done()
  }

  void (async () => {
    next.muted = true
    for (let attempt = 1; attempt <= 4 && !cancelled; attempt++) {
      if (current.paused) {
        const t = current.currentTime
        await seek(t)
        await ready(2)
        if (cancelled) return
        if (current.paused && Math.abs(current.currentTime - t) < 0.001) return swap()
        continue
      }
      // Playing: get ahead of the playhead, by more after each miss (a slow connection).
      const lead = 0.35 * attempt * Math.max(1, current.playbackRate)
      const target = await seek(current.currentTime + lead)
      await ready(3)
      if (cancelled) return
      if (current.paused || current.currentTime > target) continue
      // Wait for the playhead (a timer, not animation frames: those stop in a background tab), then take over
      // if it got there in time; too late (the tab slept), line up again.
      const deadline = performance.now() + (lead / Math.max(0.25, current.playbackRate)) * 1000 + 500
      while (!cancelled && !current.paused && performance.now() < deadline) {
        const left = (target - current.currentTime) / Math.max(0.25, current.playbackRate)
        if (left <= 0) break
        await wait(left > 0.03 ? (left - 0.02) * 1000 : 2)
      }
      if (cancelled) return
      const late = current.currentTime - target
      if (!current.paused && late >= 0 && late < MAX_LATE) return swap()
    }
    // Never lined up (a slow or broken file): take over at the moment on screen anyway.
    if (!cancelled) {
      next.currentTime = current.currentTime
      await wait(0)
      swap()
    }
  })()
  return () => {
    cancelled = true
  }
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
