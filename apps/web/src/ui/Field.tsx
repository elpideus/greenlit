import { Search, X } from 'lucide-react'
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import { cn } from '@/lib/cn'

const fieldBase = cn(
  'w-full min-w-0 rounded-control bg-well text-ink outline-none',
  'shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-150',
  'hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
  'focus:bg-[color-mix(in_oklab,var(--well),var(--canvas))] focus:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
  'disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--cut)]',
)

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg'
  leading?: ReactNode
  trailing?: ReactNode
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leading, trailing, invalid, className, ...rest },
  ref,
) {
  const h = { sm: 'h-7 t-callout', md: 'h-8 t-callout', lg: 'h-10 text-[14px]' }[size]
  if (!leading && !trailing)
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, h, 'px-2.5', className)} {...rest} />
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute left-2.5 flex text-ink-3">{leading}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(fieldBase, h, leading ? 'pl-8' : 'pl-2.5', trailing ? 'pr-8' : 'pr-2.5')}
        {...rest}
      />
      {trailing && <span className="absolute right-1.5 flex items-center text-ink-3">{trailing}</span>}
    </div>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content up to `maxRows`. */
  autoGrow?: boolean
  maxRows?: number
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { autoGrow = true, maxRows = 14, invalid, className, rows = 3, value, ...rest },
  outer,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || !autoGrow) return
    el.style.height = 'auto'
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(el.scrollHeight + 2, line * maxRows + 16)}px`
  }, [value, autoGrow, maxRows])
  return (
    <textarea
      ref={(el) => {
        inner.current = el
        if (typeof outer === 'function') outer(el)
        else if (outer) outer.current = el
      }}
      rows={rows}
      value={value}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'resize-none px-2.5 py-2 t-body leading-[1.5]', className)}
      {...rest}
    />
  )
})

/** Label + control + hint/error, stacked. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  aside,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (id: string) => ReactNode
  className?: string
  aside?: ReactNode
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="t-label">
              {label}
            </label>
          )}
          {aside && <span className="t-caption text-ink-3">{aside}</span>}
        </div>
      )}
      {children(id)}
      {error ? (
        <div className="t-caption text-cut">{error}</div>
      ) : hint ? (
        <div className="t-caption text-ink-3">{hint}</div>
      ) : null}
    </div>
  )
}

/** A plain search field with a clear button. (The library's token search lives in features/library.) */
export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }
>(function SearchInput({ value, onChange, placeholder = 'Search', ...rest }, ref) {
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      leading={<Search size={14} strokeWidth={1.9} />}
      trailing={
        value ? (
          <button
            type="button"
            className="press grid size-5 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => onChange('')}
            aria-label="Clear"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        ) : null
      }
      {...rest}
    />
  )
})
