import { truncateForDisplay } from '@greenlit/platforms'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { PreviewAccount, PreviewMedia } from './types'

/** Native-app type: the platforms use the phone's own system faces, not the brand's. */
export const appFont: CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  letterSpacing: '-0.01em',
}

// ── playback ────────────────────────────────────────────────────────────────────────

export interface Playback {
  videoRef: RefObject<HTMLVideoElement | null>
  playing: boolean
  muted: boolean
  progress: number
  toggle: () => void
  setMuted: (m: boolean) => void
  flash: 'play' | 'pause' | null
}

/** Tap to pause / play, mute toggle, progress; music plays along when unmuted. */
export function usePlayback(opts: {
  autoPlay?: boolean
  startAt?: number
  originalVolume?: number
  musicSrc?: string | null
  musicStartAt?: number
  musicVolume?: number
}): Playback {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(opts.autoPlay ?? true)
  const [muted, setMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (opts.startAt) v.currentTime = opts.startAt
  }, [opts.startAt])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = muted
    v.volume = Math.max(0, Math.min(1, opts.originalVolume ?? 1))
    if (playing) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }, [playing, muted, opts.originalVolume])

  // the chosen sound, when the platform's audio is available
  useEffect(() => {
    if (!opts.musicSrc) {
      musicRef.current?.pause()
      musicRef.current = null
      return
    }
    const a = new Audio(opts.musicSrc)
    a.loop = true
    a.currentTime = opts.musicStartAt ?? 0
    musicRef.current = a
    return () => a.pause()
  }, [opts.musicSrc, opts.musicStartAt])
  useEffect(() => {
    const a = musicRef.current
    if (!a) return
    a.volume = Math.max(0, Math.min(1, opts.musicVolume ?? 1))
    if (playing && !muted) void a.play().catch(() => {})
    else a.pause()
  }, [playing, muted, opts.musicVolume, opts.musicSrc])

  // Progress a few times a second (the bar eases between readings): no re-render on every frame.
  useEffect(() => {
    const id = setInterval(() => {
      const v = videoRef.current
      if (v?.duration)
        setProgress((p) =>
          Math.abs(p - v.currentTime / v.duration) > 0.002 ? v.currentTime / v.duration : p,
        )
    }, 200)
    return () => clearInterval(id)
  }, [])

  const toggle = () => {
    setPlaying((p) => {
      setFlash(p ? 'pause' : 'play')
      setTimeout(() => setFlash(null), 520)
      return !p
    })
  }
  return { videoRef, playing, muted, progress, toggle, setMuted, flash }
}

/** The media inside a surface: video loops, pictures sit still; `fit` decides bars vs crop. */
export function MediaView({
  item,
  playback,
  fit = 'cover',
  className,
  style,
}: {
  item: PreviewMedia | undefined
  playback?: Playback
  fit?: 'cover' | 'contain'
  className?: string
  style?: CSSProperties
}) {
  if (!item?.src && !item?.poster)
    return (
      <div
        className={cn('grid place-items-center bg-[#1b1c1b] text-[11px] text-white/40', className)}
        style={style}
      >
        No media
      </div>
    )
  const obj = fit === 'cover' ? 'object-cover' : 'object-contain'
  if (item.kind === 'video' && item.src)
    return (
      <video
        ref={playback?.videoRef}
        src={item.src}
        poster={item.poster ?? undefined}
        className={cn('bg-black', obj, className)}
        style={style}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
      />
    )
  return (
    <img
      src={item.src ?? item.poster ?? ''}
      alt=""
      draggable={false}
      className={cn('bg-black', obj, className)}
      style={style}
    />
  )
}

/** How a frame sits in a vertical screen: fill when close to 9:16, else centred with bars. */
export function verticalFit(item: PreviewMedia | undefined): 'cover' | 'contain' {
  if (!item?.width || !item.height) return 'cover'
  const r = item.width / item.height
  return r > 0.5 && r < 0.62 ? 'cover' : 'contain'
}

/** Big play / pause glyph that flashes in the middle when you tap. */
export function TapFlash({ flash }: { flash: Playback['flash'] }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.2 }}
          transition={{ duration: 0.22 }}
          className="pointer-events-none absolute top-1/2 left-1/2 z-20 grid size-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
        >
          {flash === 'pause' ? (
            <Pause size={30} fill="currentColor" />
          ) : (
            <Play size={30} fill="currentColor" className="ml-1" />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function MuteButton({ playback, className }: { playback: Playback; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        playback.setMuted(!playback.muted)
      }}
      className={cn(
        'grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md',
        className,
      )}
      aria-label={playback.muted ? 'Unmute' : 'Mute'}
    >
      {playback.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
    </button>
  )
}

// ── people ──────────────────────────────────────────────────────────────────────────

export function AppAvatar({
  account,
  size = 32,
  ring,
  className,
}: {
  account: PreviewAccount
  size?: number
  ring?: string
  className?: string
}) {
  const letter = (account.name || account.handle || '?').replace(/^@/, '').slice(0, 1).toUpperCase()
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#3a3c3a] font-semibold text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
      }}
    >
      {account.avatarUrl ? (
        <img src={account.avatarUrl} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        letter
      )}
    </span>
  )
}

export const handleOf = (a: PreviewAccount) => (a.handle || a.name).replace(/^@/, '')

// ── text ────────────────────────────────────────────────────────────────────────────

/** Caption cut the way the app cuts it, with its own "more"; tap to expand. Hashtags and mentions tinted. */
export function Caption({
  text,
  display,
  lead,
  className,
  tagClass = 'text-[#e0f1ff]',
  moreClass = 'text-white/60',
  clamp,
}: {
  text: string
  display?: { chars?: number; lines?: number; more: string }
  lead?: ReactNode
  className?: string
  tagClass?: string
  moreClass?: string
  clamp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { visible, truncated } = open
    ? { visible: text, truncated: false }
    : truncateForDisplay(text, display)
  if (!text && !lead) return null
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: preview only
    // biome-ignore lint/a11y/noStaticElementInteractions: preview only
    <div
      className={cn(
        'whitespace-pre-wrap break-words',
        clamp && open && 'max-h-[40vh] overflow-y-auto',
        className,
      )}
      onClick={(e) => {
        if (!truncated && !open) return
        e.stopPropagation()
        setOpen((o) => !o)
      }}
    >
      {lead}
      {rich(visible, tagClass)}
      {truncated && (
        <span className={moreClass}>
          {display?.more?.startsWith('.') ? '' : '… '}
          {display?.more || 'more'}
        </span>
      )}
    </div>
  )
}

function rich(text: string, tagClass: string) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[\w.]+)/u)
  return parts.map((p, i) =>
    /^[#@]/.test(p) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split
      <span key={i} className={tagClass}>
        {p}
      </span>
    ) : (
      p
    ),
  )
}

/** A line of text that scrolls when it doesn't fit (music tickers). */
export function Ticker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'relative block overflow-hidden whitespace-nowrap [mask-image:linear-gradient(90deg,#000_80%,transparent)]',
        className,
      )}
    >
      <motion.span
        className="inline-block pr-8"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 9, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
      >
        {children}
        <span className="pl-8">{children}</span>
      </motion.span>
    </span>
  )
}

/** A heart (or any glyph) that pops when tapped. */
export function LikeButton({
  liked,
  onToggle,
  render,
  className,
}: {
  liked: boolean
  onToggle: () => void
  render: (liked: boolean) => ReactNode
  className?: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.8 }}
      animate={liked ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={{ duration: 0.32 }}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn('flex flex-col items-center', className)}
    >
      {render(liked)}
    </motion.button>
  )
}

export function compact(n: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
