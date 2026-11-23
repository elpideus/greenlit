import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/cn'
import { rise } from '@/lib/motion'

/** A group in the composer: a title, an optional hint, the controls. */
export function Panel({
  title,
  hint,
  aside,
  children,
  className,
}: {
  title: ReactNode
  hint?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      {...rise}
      className={cn(
        'rounded-panel bg-panel px-5 pt-4 pb-5 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]',
        className,
      )}
    >
      <div className="mb-3.5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="t-headline text-ink">{title}</h2>
          {hint && <p className="mt-0.5 t-caption text-ink-3 text-pretty">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </motion.section>
  )
}

/** Tags typed one by one (hashtags, YouTube tags): Enter / comma / space adds, Backspace removes the last. */
export function TagInput({
  value,
  onChange,
  placeholder,
  prefix = '',
  disabled,
  splitOnSpace = true,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  prefix?: string
  disabled?: boolean
  splitOnSpace?: boolean
}) {
  const [text, setText] = useState('')
  const commit = (raw: string) => {
    const parts = raw
      .split(splitOnSpace ? /[,\s]+/ : /,+/)
      .map((s) => s.trim().replace(prefix ? new RegExp(`^\\${prefix}+`) : /^$/, ''))
      .filter(Boolean)
    if (!parts.length) return
    const seen = new Set(value.map((v) => v.toLowerCase()))
    onChange([...value, ...parts.filter((p) => !seen.has(p.toLowerCase()))])
    setText('')
  }
  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-control bg-well px-1.5 py-1.5 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
        disabled && 'opacity-50',
      )}
    >
      {value.map((v) => (
        <span
          key={v}
          className="inline-flex h-6 items-center gap-1 rounded-tag bg-hover pr-0.5 pl-2 t-caption text-ink shadow-[inset_0_0_0_.5px_var(--line)]"
        >
          <span className="text-ink-3">{prefix}</span>
          {v}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="press grid size-4 place-items-center rounded-[3px] text-ink-3 hover:bg-press hover:text-ink"
              aria-label="Remove"
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          )}
        </span>
      ))}
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value
          if (/[,\n]$/.test(v) || (splitOnSpace && /\s$/.test(v))) commit(v)
          else setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(text)
          }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => commit(text)}
        onPaste={(e) => {
          const p = e.clipboardData.getData('text')
          if (/[,\s]/.test(p)) {
            e.preventDefault()
            commit(text + p)
          }
        }}
        placeholder={value.length ? '' : placeholder}
        className="h-6 min-w-[140px] flex-1 bg-transparent px-1 t-callout text-ink outline-none placeholder:text-ink-3"
      />
    </div>
  )
}

/** "1,234 / 2,200" turning amber near the limit and red past it. */
export function Counter({
  count,
  max,
  className,
}: {
  count: number
  max: number | undefined
  className?: string
}) {
  if (!max) return <span className={cn('t-meta text-ink-4', className)}>{count}</span>
  const ratio = count / max
  return (
    <span
      className={cn(
        't-meta tabular',
        ratio > 1 ? 'text-cut' : ratio > 0.9 ? 'text-review' : 'text-ink-4',
        className,
      )}
    >
      {count.toLocaleString()} / {max.toLocaleString()}
    </span>
  )
}

/** Radio-like option rows (When: now / at a time). */
export function Choice({
  checked,
  onSelect,
  title,
  children,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  title: ReactNode
  children?: ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] transition-[background-color,box-shadow] duration-150',
        checked
          ? 'bg-signal-soft/50 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--signal)_40%,transparent)]'
          : 'shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-full transition-shadow duration-150',
            checked ? 'shadow-[inset_0_0_0_4.5px_var(--signal)]' : 'shadow-[inset_0_0_0_1.5px_var(--ink-3)]',
          )}
        />
        <span className="t-callout font-[550] text-ink">{title}</span>
      </button>
      {checked && children && <div className="px-3 pb-3 pl-10">{children}</div>}
    </div>
  )
}
