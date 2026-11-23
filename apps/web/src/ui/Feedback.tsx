import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { rise } from '@/lib/motion'

/** A thin ring that turns; for waits under a few seconds. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0 animate-[gl-spin_0.8s_linear_infinite]', className)}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.6" />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton rounded-control', className)} style={style} aria-hidden />
}

/** Determinate progress. `tone` follows the state colours. */
export function ProgressBar({
  value,
  className,
  tone = 'signal',
}: {
  value: number | null
  className?: string
  tone?: 'signal' | 'review' | 'cut' | 'cue' | 'ink'
}) {
  const color = { signal: 'bg-signal', review: 'bg-review', cut: 'bg-cut', cue: 'bg-cue', ink: 'bg-ink' }[tone]
  return (
    <div className={cn('relative h-1 overflow-hidden rounded-full bg-hover', className)} role="progressbar" aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      {value === null ? (
        <div className={cn('absolute inset-y-0 w-1/3 animate-[gl-shimmer_1.2s_linear_infinite] rounded-full', color)} />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', color)}
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  )
}

/** A ring that fills (uploads, processing on a tile). */
export function ProgressRing({ value, size = 18, className }: { value: number; size?: number; className?: string }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className={cn('-rotate-90', className)} aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  )
}

/**
 * What appears here and how to add the first one. No illustration: one quiet icon, a sentence, an action.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <motion.div
      {...rise}
      className={cn('mx-auto flex max-w-sm flex-col items-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-20', className)}
    >
      {Icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-panel bg-hover text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
          <Icon size={20} strokeWidth={1.6} />
        </div>
      )}
      <div className={cn(compact ? 't-headline' : 't-title-2', 'text-ink')}>{title}</div>
      {body && <div className="t-callout text-ink-3 text-pretty">{body}</div>}
      {action && <div className="mt-2 flex gap-2">{action}</div>}
    </motion.div>
  )
}

/** Inline problem with what to do next. */
export function ErrorState({ title = 'This could not be loaded', error, retry }: { title?: string; error?: unknown; retry?: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
      <div className="t-headline text-ink">{title}</div>
      {error ? <div className="t-callout text-ink-3">{error instanceof Error ? error.message : String(error)}</div> : null}
      {retry && (
        <button type="button" onClick={retry} className="press mt-2 rounded-control px-3 py-1.5 t-callout text-signal hover:bg-signal-soft">
          Try again
        </button>
      )}
    </div>
  )
}
