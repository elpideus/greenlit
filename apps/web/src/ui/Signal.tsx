import wordmarkSvg from '../../../../brand/greenlit-wordmark-on-dark.svg?raw'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'

/**
 * The signal: Greenlit's mark and its one recurring idea. A capsule with two lamps: the upper one holds
 * (review amber, changes red), the lower one lights green when work is greenlit (or blue when it is cued up).
 * It is never decoration: wherever it appears it says the state of something.
 */
export type Tone = 'draft' | 'review' | 'changes' | 'greenlit' | 'scheduled' | 'failed' | 'live'

const TONE: Record<Tone, { upper: string | null; lower: string | null; label: string }> = {
  draft: { upper: null, lower: null, label: 'Draft' },
  review: { upper: 'var(--review)', lower: null, label: 'In review' },
  changes: { upper: 'var(--cut)', lower: null, label: 'Changes requested' },
  greenlit: { upper: null, lower: 'var(--signal)', label: 'Greenlit' },
  scheduled: { upper: null, lower: 'var(--cue)', label: 'Scheduled' },
  failed: { upper: 'var(--cut)', lower: null, label: 'Failed' },
  live: { upper: null, lower: 'var(--signal)', label: 'Published' },
}

/** Maps any Greenlit status (media, review, post, target, account) to a lamp. */
export function toneFor(status: string | null | undefined): Tone {
  switch (status) {
    case 'in_review':
    case 'open':
    case 'queued':
    case 'preparing':
    case 'uploading':
    case 'publishing':
    case 'connecting':
    case 'partial':
      return 'review'
    case 'changes_requested':
    case 'needs_login':
      return 'changes'
    case 'failed':
    case 'error':
      return 'failed'
    case 'approved':
    case 'done':
    case 'connected':
      return 'greenlit'
    case 'published':
      return 'live'
    case 'scheduled':
      return 'scheduled'
    default:
      return 'draft'
  }
}

/** The full mark: housing + two lamps. `tone` lights the lamps; sizes 14–64 px. */
export function Signal({
  tone = 'greenlit',
  size = 28,
  className,
  title,
  animate = true,
}: {
  tone?: Tone
  size?: number
  className?: string
  title?: string
  animate?: boolean
}) {
  const t = TONE[tone]
  const housing = 'currentColor'
  return (
    <svg
      width={(size * 136) / 218}
      height={size}
      viewBox="60 19 136 218"
      className={cn('shrink-0 text-ink', className)}
      role="img"
      aria-label={title ?? t.label}
    >
      <path
        fill={housing}
        fillRule="evenodd"
        d="M128 19c37.56 0 68 30.44 68 68v82c0 37.56-30.44 68-68 68s-68-30.44-68-68V87c0-37.56 30.44-68 68-68Zm0 18c-27.61 0-50 22.39-50 50v82c0 27.61 22.39 50 50 50s50-22.39 50-50V87c0-27.61-22.39-50-50-50Z"
      />
      <Lamp cx={128} cy={87} color={t.upper} animate={animate} />
      <Lamp cx={128} cy={169} color={t.lower} animate={animate} />
    </svg>
  )
}

function Lamp({ cx, cy, color, animate }: { cx: number; cy: number; color: string | null; animate: boolean }) {
  return (
    <g>
      {/* the unlit socket: a ring */}
      <path
        fill="currentColor"
        fillOpacity={color ? 0 : 1}
        fillRule="evenodd"
        d={`M${cx} ${cy - 32}a32 32 0 1 1 0 64 32 32 0 0 1 0-64Zm0 18a14 14 0 1 0 0 28 14 14 0 0 0 0-28Z`}
        style={{ transition: 'fill-opacity 160ms var(--ease)' }}
      />
      <motion.circle
        cx={cx}
        cy={cy}
        r={32}
        fill={color ?? 'transparent'}
        initial={false}
        animate={{ scale: color ? 1 : 0.3, opacity: color ? 1 : 0 }}
        transition={animate ? spring.lamp : { duration: 0 }}
        style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'view-box' }}
      />
    </g>
  )
}

/**
 * A tally light: the lamp alone, for rows, tiles and chips. Draft = an empty ring.
 */
export function Tally({ tone, size = 8, className, pulse }: { tone: Tone; size?: number; className?: string; pulse?: boolean }) {
  const t = TONE[tone]
  const color = t.lower ?? t.upper
  return (
    <span
      className={cn('relative inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: color ?? 'transparent',
        boxShadow: color
          ? `0 0 0 0.5px color-mix(in oklab, ${color} 60%, black), 0 0 ${size}px -1px color-mix(in oklab, ${color} 55%, transparent)`
          : `inset 0 0 0 ${Math.max(1.25, size / 5)}px var(--ink-3)`,
        animation: pulse ? 'gl-pulse 1.6s var(--ease-in-out) infinite' : undefined,
      }}
      aria-hidden
    />
  )
}

/** Tally + label, e.g. in a status chip or the viewer's decision area. */
export function StatusLabel({ status, label, className }: { status: string; label: string; className?: string }) {
  const tone = toneFor(status)
  return (
    <span className={cn('inline-flex items-center gap-1.5 t-caption text-ink-2', className)}>
      <Tally tone={tone} size={7} pulse={['queued', 'preparing', 'uploading', 'publishing', 'connecting'].includes(status)} />
      {label}
    </span>
  )
}

/** The signal on its side, a semaphore: the base of every on/off switch. */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return <Signal tone="greenlit" size={size} className={className} animate={false} title="Greenlit" />
}

/** "Greenlit" with the green lamp as the dot of the i. Colours follow the text colour. */
export function Wordmark({ height = 18, className }: { height?: number; className?: string }) {
  const svg = wordmarkSvg
    .replace(/fill="#EDEFED"/gi, 'fill="currentColor"')
    .replace(/fill="#42D77B"/gi, 'fill="var(--signal)"')
    .replace('<svg ', `<svg height="${height}" style="display:block" `)
  return (
    <span
      className={cn('inline-block shrink-0 text-ink', className)}
      style={{ height, aspectRatio: '3766 / 790' }}
      // The SVG ships with the repository's brand kit.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static brand asset
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label="Greenlit"
    />
  )
}
