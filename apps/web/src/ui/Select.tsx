import { Select as S } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

/** A single choice from a short list. More than ~12 options: use a searchable combobox instead. */
export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  size = 'md',
  className,
  disabled,
  id,
  align = 'start',
}: {
  value: V | null
  onChange: (v: V) => void
  options: SelectOption<V>[]
  placeholder?: string
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
  id?: string
  align?: 'start' | 'end'
}) {
  const current = options.find((o) => o.value === value)
  return (
    <S.Root value={value} onValueChange={(v) => v !== null && onChange(v as V)} disabled={disabled}>
      <S.Trigger
        id={id}
        className={cn(
          'press inline-flex min-w-0 items-center gap-2 rounded-control bg-well pr-2 pl-2.5 text-left text-ink outline-none',
          'shadow-[inset_0_0_0_1px_var(--line)] hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
          'focus-visible:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)] data-[disabled]:opacity-50',
          size === 'sm' ? 'h-7 t-callout' : 'h-8 t-callout',
          className,
        )}
      >
        {current?.icon}
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-ink-3')}>{current?.label ?? placeholder}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-ink-3" />
      </S.Trigger>
      <S.Portal>
        <S.Positioner className="z-[80] outline-none" sideOffset={6} align={align} alignItemWithTrigger={false}>
          <S.Popup className="gl-pop floating max-h-[min(var(--available-height),360px)] min-w-[var(--anchor-width)] overflow-y-auto p-[5px] outline-none">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex h-8 cursor-default select-none items-center gap-2.5 rounded-[7px] pr-3 pl-2 t-callout text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40"
              >
                <span className="grid w-4 place-items-center">
                  <S.ItemIndicator>
                    <Check size={14} strokeWidth={2.2} className="text-signal" />
                  </S.ItemIndicator>
                </span>
                {o.icon}
                <S.ItemText className="min-w-0 flex-1 truncate">{o.label}</S.ItemText>
                {o.hint && <span className="t-caption text-ink-3">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  )
}
