import { Check } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { ease } from '@/lib/motion'

/**
 * The frame of one Settings section (each feature renders its own): a title, what the section is for, at most one
 * primary action, then groups. Used by every feature that registers a `settings` section.
 */
export function SettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="pb-24">
      <header className="mb-8 flex flex-col gap-x-6 gap-y-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="t-title-1 text-ink">{title}</h1>
          {description && <p className="mt-2 max-w-[62ch] t-body text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-9">{children}</div>
    </div>
  )
}

/** A titled group of rows inside a section. */
export function SettingsGroup({
  title,
  description,
  aside,
  children,
  className,
  bare,
}: {
  title?: ReactNode
  description?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  /** No card around the content (grids of tiles, lists that draw their own surfaces). */
  bare?: boolean
}) {
  return (
    <section className={className}>
      {(title || aside) && (
        <div className="mb-3 flex items-end gap-4 px-0.5">
          <div className="min-w-0 flex-1">
            {title && <h2 className="t-headline text-ink">{title}</h2>}
            {description && <p className="mt-1 max-w-[64ch] t-callout text-ink-3">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {bare ? (
        children
      ) : (
        <div className="rounded-panel bg-panel px-4 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)] [&>*+*]:border-t [&>*+*]:border-line">
          {children}
        </div>
      )}
    </section>
  )
}

/** A row inside a SettingsGroup: label and description left, control right; stacks on narrow screens. */
export function SettingsRow({
  label,
  description,
  children,
  className,
  htmlFor,
  stack,
  inline,
}: {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
  htmlFor?: string
  /** Control under the label (wide inputs, lists). */
  stack?: boolean
  /** Control stays beside the label even on phones (switches). */
  inline?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 gap-x-8 gap-y-2.5 py-3.5',
        stack
          ? 'flex-col'
          : inline
            ? 'flex-row items-center justify-between'
            : 'flex-col justify-between sm:flex-row sm:items-center',
        className,
      )}
    >
      <div className={cn('min-w-0', inline ? 'flex-1 sm:max-w-[70%]' : 'sm:max-w-[52%]')}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block t-callout font-[550] text-ink">
            {label}
          </label>
        ) : (
          <div className="t-callout font-[550] text-ink">{label}</div>
        )}
        {description && <div className="mt-0.5 t-caption text-ink-3 text-pretty">{description}</div>}
      </div>
      {children !== undefined && (
        <div
          className={cn(
            'flex min-w-0 items-center gap-2',
            stack ? 'w-full' : inline ? 'shrink-0' : 'sm:justify-end',
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** A small "Saved" that lights and fades after an automatic save. Bump `tick` after each save. */
export function SavedHint({ tick, label = 'Saved' }: { tick: number; label?: string }) {
  const [show, setShow] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setShow(true)
    const t = setTimeout(() => setShow(false), 1600)
    return () => clearTimeout(t)
  }, [tick])
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease }}
          className="inline-flex items-center gap-1 t-caption text-signal"
        >
          <Check size={12} strokeWidth={2.6} />
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/**
 * A text field that saves itself when you leave it or press Enter (settings apply at once). Escape restores the
 * saved value. Shows "Saved" next to it after a save.
 */
export function AutosaveInput({
  value,
  onSave,
  placeholder,
  id,
  className,
  required,
  type = 'text',
  validate,
  maxLength,
}: {
  value: string
  onSave: (v: string) => Promise<unknown>
  placeholder?: string
  id?: string
  className?: string
  required?: boolean
  type?: string
  validate?: (v: string) => string | null
  maxLength?: number
}) {
  const [draft, setDraft] = useState(value)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(value), [value])
  const commit = async () => {
    const v = draft.trim()
    if (v === value) return
    if (required && !v) {
      setDraft(value)
      return
    }
    const problem = validate?.(v) ?? null
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await onSave(v)
      setTick((n) => n + 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn('flex w-full flex-col gap-1 sm:w-[300px]', className)}>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(value)
              setError(null)
            }
          }}
          className={cn(
            'h-8 w-full min-w-0 rounded-control bg-well px-2.5 pr-16 t-callout text-ink outline-none',
            'shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow] duration-150 hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
            'focus:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--cut)]',
            busy && 'opacity-70',
          )}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
          <SavedHint tick={tick} />
        </span>
      </div>
      {error && <span className="t-caption text-cut">{error}</span>}
    </div>
  )
}

/** A block of copyable text: commands, tokens, credentials. */
export function CopyBlock({
  text,
  display,
  className,
  label = 'Copy',
}: {
  text: string
  display?: ReactNode
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 rounded-tile bg-well px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]',
        className,
      )}
    >
      <code className="min-w-0 flex-1 t-meta leading-[1.6] text-ink-2 select-all [overflow-wrap:anywhere]">
        {display ?? text}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className={cn(
          'press -my-1 -mr-1.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 t-caption font-[550]',
          copied ? 'text-signal' : 'text-ink-2 hover:bg-hover hover:text-ink',
        )}
      >
        {copied ? <Check size={13} strokeWidth={2.6} /> : null}
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}
