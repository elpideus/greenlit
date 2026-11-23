import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useStoredState } from '@/lib/dom'
import { ease } from '@/lib/motion'

/**
 * Inspector controls. Number fields scrub: drag the label sideways (Shift ×10, Alt ×0.1), or type; arrows step.
 * While scrubbing the edit is only previewed; releasing commits one op.
 */
export function NumberField({
  label,
  value,
  onPreview,
  onCommit,
  step = 1,
  min,
  max,
  unit,
  digits = 1,
  className,
  disabled,
  trailing,
  title,
}: {
  label: ReactNode
  value: number | undefined
  onPreview?: (v: number | null) => void
  onCommit: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  digits?: number
  className?: string
  disabled?: boolean
  trailing?: ReactNode
  title?: string
}) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const drag = useRef<{ x: number; start: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) =>
    Math.max(min ?? Number.NEGATIVE_INFINITY, Math.min(max ?? Number.POSITIVE_INFINITY, v))
  const fmt = (v: number | undefined) =>
    v === undefined || Number.isNaN(v) ? '—' : String(Number(v.toFixed(digits)))
  // biome-ignore lint/correctness/useExhaustiveDependencies: fmt only depends on digits
  useEffect(() => {
    if (!editing) setText(fmt(value))
  }, [value, editing])

  const commitText = () => {
    setEditing(false)
    const v = Number.parseFloat(text.replace(',', '.'))
    if (!Number.isNaN(v) && v !== value) onCommit(clamp(v))
    else setText(fmt(value))
  }

  return (
    <div
      className={cn(
        'group flex h-7 min-w-0 items-center rounded-[6px] bg-well shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
        disabled && 'opacity-50',
        className,
      )}
      title={title}
    >
      <span
        className={cn(
          'flex h-full shrink-0 cursor-ew-resize items-center pr-1 pl-2 t-caption text-ink-3 select-none group-hover:text-ink-2',
          disabled && 'cursor-default',
        )}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, start: value ?? 0, v: value ?? 0, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (!d.moved && Math.abs(dx) < 3) return
          d.moved = true
          const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
          d.v = clamp(Number((d.start + dx * step * mult).toFixed(Math.max(digits, 3))))
          setText(fmt(d.v))
          onPreview?.(d.v)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (!d) return
          if (d.moved) {
            onPreview?.(null)
            onCommit(d.v)
          }
        }}
      >
        {label}
      </span>
      <input
        value={editing ? text : fmt(value)}
        disabled={disabled}
        onFocus={(e) => {
          setEditing(true)
          setText(fmt(value))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setEditing(false)
            setText(fmt(value))
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const v = clamp((value ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * mult)
            onCommit(Number(v.toFixed(Math.max(digits, 3))))
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent pr-1 text-right t-meta text-ink outline-none"
      />
      {unit && <span className="pr-2 t-meta text-ink-4">{unit}</span>}
      {trailing}
    </div>
  )
}

/** Any CSS colour (or gradient for backgrounds); the swatch opens the system picker. */
export function ColorField({
  value,
  onCommit,
  allowEmpty,
  placeholder = 'none',
}: {
  value: string | undefined
  onCommit: (v: string) => void
  allowEmpty?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  const hex = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : '#ffffff'
  return (
    <div className="flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] bg-well pr-2 pl-1 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]">
      <label
        className="relative size-5 shrink-0 cursor-default overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.18),0_0_0_.5px_rgba(0,0,0,.4)]"
        style={{
          background: value || 'repeating-conic-gradient(#888 0 25%, #555 0 50%) 50% / 8px 8px',
        }}
      >
        <input
          type="color"
          value={hex}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
          className="absolute inset-0 cursor-default opacity-0"
        />
      </label>
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== (value ?? '') && (text || allowEmpty)) onCommit(text)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="h-full min-w-0 flex-1 bg-transparent t-meta text-ink outline-none placeholder:text-ink-4"
      />
    </div>
  )
}

/** A collapsible inspector group; open state is remembered per section. */
export function Group({
  id,
  title,
  children,
  aside,
  defaultOpen = true,
}: {
  id: string
  title: ReactNode
  children: ReactNode
  aside?: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useStoredState(`editor.group.${id}`, defaultOpen)
  return (
    <section className="border-b border-line px-3.5 py-2.5 last:border-b-0">
      <div className="flex h-7 items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="press -ml-1 flex flex-1 items-center gap-1 rounded-[5px] px-1 text-left t-caption font-[600] text-ink-2 hover:text-ink"
        >
          <ChevronRight
            size={13}
            strokeWidth={2}
            className={cn('text-ink-3 transition-transform duration-200', open && 'rotate-90')}
          />
          {title}
        </button>
        {aside}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pt-1.5 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Label left, control right, on a 2-column grid. */
export function FieldRow({
  label,
  children,
  hint,
}: {
  label: ReactNode
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <span className="truncate t-caption text-ink-3" title={typeof label === 'string' ? label : undefined}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
      {hint && <div className="col-span-2 -mt-1 t-micro text-ink-4">{hint}</div>}
    </div>
  )
}

/** Compact segmented choice for inspector rows (icons or short words). */
export function Choice<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V | undefined
  options: { value: V; label: ReactNode; title?: string }[]
  onChange: (v: V) => void
}) {
  return (
    <div className="flex h-7 items-center gap-0.5 rounded-[6px] bg-well p-[2px] shadow-[inset_0_0_0_1px_var(--line)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'press grid h-full flex-1 place-items-center rounded-[4px] t-caption',
            o.value === value
              ? 'bg-raised text-ink shadow-[0_1px_2px_rgba(0,0,0,.2),inset_0_0_0_.5px_var(--line-strong)]'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A small native select styled like the fields (long option lists: fonts, presets, easings). */
export function MiniSelect<V extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: V | undefined
  options: { value: V; label: string }[]
  onChange: (v: V) => void
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      className={cn(
        'h-7 w-full min-w-0 cursor-default appearance-none rounded-[6px] bg-well bg-[length:10px] bg-[right_8px_center] bg-no-repeat pr-6 pl-2 t-caption text-ink outline-none',
        'shadow-[inset_0_0_0_1px_var(--line)] focus:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M2 4l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.4'/%3E%3C/svg%3E\")",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
