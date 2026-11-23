import { Checkbox as BCheckbox } from '@base-ui/react/checkbox'
import { Switch } from '@base-ui/react/switch'
import { Check, Minus } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'

/**
 * The semaphore switch: the signal lying on its side. Two sockets in a capsule; off = the lamp sits unlit on the
 * left, on = it slides right and lights green. For settings that apply at once.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  size = 'md',
  label,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  label?: string
  className?: string
}) {
  const s = size === 'sm' ? { w: 30, h: 18, d: 10, ring: 1.75 } : { w: 38, h: 22, d: 12, ring: 2 }
  const travel = s.w - s.h
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={(v) => onChange(v)}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'press group relative inline-flex shrink-0 items-center rounded-full disabled:opacity-40',
        'shadow-[inset_0_0_0_1.5px_var(--line-strong)] data-[checked]:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--signal)_55%,transparent)]',
        'bg-well data-[checked]:bg-[color-mix(in_oklab,var(--signal)_12%,var(--well))]',
        'transition-[background-color,box-shadow] duration-200',
        className,
      )}
      style={{ width: s.w, height: s.h }}
    >
      {/* the two sockets */}
      {[0, 1].map((i) => (
        <span
          key={i}
          className="absolute top-1/2 rounded-full"
          style={{
            width: s.d,
            height: s.d,
            left: (s.h - s.d) / 2 + i * travel,
            transform: 'translateY(-50%)',
            boxShadow: `inset 0 0 0 ${s.ring * 0.6}px color-mix(in oklab, var(--ink) 16%, transparent)`,
          }}
        />
      ))}
      <Switch.Thumb
        render={(props, state) => (
          <motion.span
            {...(props as object)}
            className="absolute top-1/2 rounded-full"
            initial={false}
            animate={{ x: state.checked ? travel : 0 }}
            transition={spring.snap}
            style={{
              width: s.d,
              height: s.d,
              left: (s.h - s.d) / 2,
              marginTop: -s.d / 2,
              background: state.checked ? 'var(--signal)' : 'transparent',
              boxShadow: state.checked
                ? '0 0 10px -1px color-mix(in oklab, var(--signal) 70%, transparent)'
                : `inset 0 0 0 ${s.ring}px var(--ink-2)`,
              transition: 'background-color 200ms var(--ease), box-shadow 200ms var(--ease)',
            }}
          />
        )}
      />
    </Switch.Root>
  )
}

/** Toggle with a label and an optional description, as a settings row. */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
    <label className="flex cursor-default items-start justify-between gap-6 py-3">
      <span className="min-w-0">
        <span className="block t-callout font-[550] text-ink">{title}</span>
        {description && <span className="mt-0.5 block t-caption text-ink-3">{description}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  )
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
  className,
  size = 16,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
  size?: number
}) {
  return (
    <BCheckbox.Root
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(v) => onChange(v)}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'press grid shrink-0 place-items-center rounded-[5px] bg-well text-signal-ink',
        'shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover-device:hover:shadow-[inset_0_0_0_1.5px_var(--ink-3)]',
        'data-[checked]:bg-signal data-[checked]:shadow-none data-[indeterminate]:bg-signal data-[indeterminate]:shadow-none',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <BCheckbox.Indicator className="grid place-items-center transition-transform duration-150 data-[unchecked]:scale-50">
        {indeterminate ? <Minus size={size - 5} strokeWidth={3} /> : <Check size={size - 5} strokeWidth={3} />}
      </BCheckbox.Indicator>
    </BCheckbox.Root>
  )
}
