import { Slider as S } from '@base-ui/react/slider'
import { cn } from '@/lib/cn'

/** A continuous value (volume, zoom, tile size). Thumb grows on press; the fill is the signal. */
export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  label,
  tone = 'signal',
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  label?: string
  tone?: 'signal' | 'ink'
  disabled?: boolean
}) {
  return (
    <S.Root
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? 0) : (v as number))}
      onValueCommitted={(v) => onCommit?.(Array.isArray(v) ? (v[0] ?? 0) : (v as number))}
      className={cn('relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-40', className)}
      aria-label={label}
    >
      <S.Control className="flex h-5 w-full items-center">
        <S.Track className="relative h-1 w-full rounded-full bg-[color-mix(in_oklab,var(--ink)_14%,transparent)]">
          <S.Indicator className={cn('rounded-full', tone === 'signal' ? 'bg-signal' : 'bg-ink')} />
          <S.Thumb
            className={cn(
              'block size-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.35),0_0_0_.5px_rgba(0,0,0,.2)] outline-none',
              'transition-transform duration-150 ease-out data-[dragging]:scale-[1.18] focus-visible:shadow-[0_0_0_3px_var(--signal-soft),0_1px_3px_rgba(0,0,0,.35)]',
            )}
          />
        </S.Track>
      </S.Control>
    </S.Root>
  )
}
