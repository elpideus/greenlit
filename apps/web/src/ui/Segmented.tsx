import type { LucideIcon } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import { Tooltip } from './Tooltip'

export interface SegmentOption<V extends string> {
  value: V
  label?: ReactNode
  icon?: LucideIcon
  /** Tooltip / accessible name for icon-only segments. */
  title?: string
  badge?: ReactNode
}

/**
 * 2–4 views of one thing. The selected segment is a raised tile that glides between options.
 */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  stretch,
}: {
  value: V
  onChange: (v: V) => void
  options: SegmentOption<V>[]
  size?: 'sm' | 'md'
  className?: string
  stretch?: boolean
}) {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <div
        role="radiogroup"
        className={cn(
          'relative inline-flex shrink-0 items-center gap-0.5 rounded-control bg-well p-[3px] shadow-[inset_0_0_0_1px_var(--line)]',
          stretch && 'flex w-full',
          className,
        )}
      >
        {options.map((o) => {
          const active = o.value === value
          const Icon = o.icon
          const btn = (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={o.title}
              onClick={() => onChange(o.value)}
              className={cn(
                'press relative z-0 inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--r-control)-3px)] whitespace-nowrap',
                size === 'sm' ? 'h-6 px-2 t-caption' : 'h-[26px] px-2.5 t-callout',
                !o.label && (size === 'sm' ? 'w-7 px-0' : 'w-8 px-0'),
                stretch && 'flex-1',
                active ? 'font-[550] text-ink' : 'text-ink-3 hover-device:hover:text-ink-2',
              )}
            >
              {active && (
                <motion.span
                  layoutId="seg"
                  transition={spring.snap}
                  className="absolute inset-0 -z-10 rounded-[calc(var(--r-control)-3px)] bg-raised shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_0_0_.5px_var(--line-strong),inset_0_1px_0_var(--highlight)]"
                />
              )}
              {Icon && <Icon size={size === 'sm' ? 13 : 14} strokeWidth={1.8} />}
              {o.label}
              {o.badge}
            </button>
          )
          return o.title && !o.label ? (
            <Tooltip key={o.value} label={o.title}>
              {btn}
            </Tooltip>
          ) : (
            btn
          )
        })}
      </div>
    </LayoutGroup>
  )
}

/** Page-level tabs: text with a sliding underline lamp. */
export function Tabs<V extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: V
  onChange: (v: V) => void
  tabs: { value: V; label: ReactNode; count?: number | null }[]
  className?: string
}) {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <div role="tablist" className={cn('flex items-center gap-5', className)}>
        {tabs.map((t) => {
          const active = t.value === value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn(
                'press relative flex h-9 items-center gap-1.5 t-callout',
                active ? 'font-[550] text-ink' : 'text-ink-3 hover-device:hover:text-ink-2',
              )}
            >
              {t.label}
              {t.count != null && <span className="t-meta text-ink-3">{t.count}</span>}
              {active && (
                <motion.span
                  layoutId="tab"
                  transition={spring.snap}
                  className="absolute right-0 -bottom-px left-0 h-[2px] rounded-full bg-ink"
                />
              )}
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
