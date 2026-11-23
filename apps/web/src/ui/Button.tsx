import type { LucideIcon } from 'lucide-react'
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { shortcutLabel } from '@/lib/hotkeys'
import { Spinner } from './Feedback'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'review' | 'danger' | 'danger-ghost'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const variants: Record<ButtonVariant, string> = {
  // The one commit action of a view: lit like the lamp.
  primary:
    'bg-signal text-signal-ink hover-device:hover:bg-signal-hover shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_1px_2px_rgba(0,0,0,.2)]',
  secondary:
    'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line-strong),var(--shadow-lift)] hover-device:hover:bg-[color-mix(in_oklab,var(--raised),var(--ink)_6%)]',
  ghost: 'text-ink-2 hover-device:hover:bg-hover hover-device:hover:text-ink active:bg-press',
  quiet: 'text-ink-3 hover-device:hover:text-ink',
  review:
    'bg-review-soft text-review shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--review)_30%,transparent)] hover-device:hover:bg-[color-mix(in_oklab,var(--review)_22%,transparent)]',
  danger: 'bg-cut text-white hover-device:hover:bg-[color-mix(in_oklab,var(--cut),black_10%)]',
  'danger-ghost': 'text-cut hover-device:hover:bg-cut-soft',
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 gap-1 t-caption rounded-[calc(var(--r-control)*0.8)]',
  sm: 'h-7 px-2.5 gap-1.5 t-callout rounded-control',
  md: 'h-8 px-3 gap-1.5 t-callout font-[550] rounded-control',
  lg: 'h-10 px-4 gap-2 text-[14px] font-[550] tracking-[-0.01em] rounded-[calc(var(--r-control)*1.15)]',
}
const iconSize: Record<ButtonSize, number> = { xs: 13, sm: 14, md: 15, lg: 16 }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  /** Shortcut shown at the end of the button, e.g. "mod+enter". */
  kbd?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading,
    kbd,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'press relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize[size]} />
      ) : (
        Icon && <Icon size={iconSize[size]} strokeWidth={1.8} className="-ml-0.5 shrink-0" aria-hidden />
      )}
      {children}
      {IconRight && (
        <IconRight
          size={iconSize[size]}
          strokeWidth={1.8}
          className="-mr-0.5 shrink-0 opacity-80"
          aria-hidden
        />
      )}
      {kbd && (
        <span className={cn('t-meta ml-1 opacity-60', variant === 'primary' && 'opacity-70')}>
          {shortcutLabel(kbd)}
        </span>
      )}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  /** Accessible name and tooltip. */
  label: string
  shortcut?: string
  size?: ButtonSize
  variant?: 'ghost' | 'secondary' | 'quiet' | 'overlay' | 'primary'
  active?: boolean
  tooltip?: boolean | 'top' | 'bottom' | 'left' | 'right'
  badge?: ReactNode
}

const iconBtnSize: Record<ButtonSize, string> = { xs: 'size-6', sm: 'size-7', md: 'size-8', lg: 'size-10' }

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    shortcut,
    size = 'md',
    variant = 'ghost',
    active,
    tooltip = true,
    badge,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'press relative inline-flex shrink-0 items-center justify-center rounded-control disabled:pointer-events-none disabled:opacity-40',
        iconBtnSize[size],
        variant === 'ghost' &&
          'text-ink-2 hover-device:hover:bg-hover hover-device:hover:text-ink active:bg-press',
        variant === 'quiet' && 'text-ink-3 hover-device:hover:text-ink',
        variant === 'secondary' &&
          'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover-device:hover:bg-hover',
        variant === 'primary' && 'bg-signal text-signal-ink hover-device:hover:bg-signal-hover',
        variant === 'overlay' &&
          'force-dark bg-black/45 text-white backdrop-blur-md hover-device:hover:bg-black/65',
        active &&
          'bg-signal-soft text-signal hover-device:hover:bg-signal-soft hover-device:hover:text-signal',
        className,
      )}
      {...rest}
    >
      <Icon size={iconSize[size] + 1} strokeWidth={1.75} aria-hidden />
      {badge}
    </button>
  )
  if (!tooltip) return btn
  return (
    <Tooltip label={label} shortcut={shortcut} side={typeof tooltip === 'string' ? tooltip : 'bottom'}>
      {btn}
    </Tooltip>
  )
})
