import { Popover as P } from '@base-ui/react/popover'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTimecode, initials } from '@/lib/format'
import { shortcutLabel } from '@/lib/hotkeys'
import { Tooltip } from './Tooltip'

// ── people ────────────────────────────────────────────────────────────────────────────

const AVATAR_TINTS = ['#42D77B', '#6AA7F4', '#F9B73F', '#F75D59', '#B49B74', '#A78BFA', '#5EC8C0', '#E58CB8']
function tintFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length]!
}

export function Avatar({
  user,
  size = 24,
  className,
  ring,
}: {
  user: { id: string; displayName: string; avatarUrl: string | null } | null | undefined
  size?: number
  className?: string
  /** A ring in the canvas colour, for stacks. */
  ring?: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (!user)
    return (
      <span
        className={cn('inline-block shrink-0 rounded-full bg-hover', className)}
        style={{ width: size, height: size }}
      />
    )
  const tint = tintFor(user.id)
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `color-mix(in oklab, ${tint} 22%, var(--raised))`,
        color: `color-mix(in oklab, ${tint} 85%, var(--ink))`,
        fontSize: Math.max(9, size * 0.4),
        fontWeight: 600,
        letterSpacing: '-0.02em',
        boxShadow: ring ? '0 0 0 2px var(--canvas)' : 'inset 0 0 0 .5px var(--line-strong)',
      }}
      title={user.displayName}
    >
      {user.avatarUrl && !failed ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        initials(user.displayName)
      )}
    </span>
  )
}

export function AvatarStack({
  users,
  max = 4,
  size = 22,
}: {
  users: { id: string; displayName: string; avatarUrl: string | null }[]
  max?: number
  size?: number
}) {
  const shown = users.slice(0, max)
  const more = users.length - shown.length
  return (
    <span className="flex items-center">
      {shown.map((u, i) => (
        <span key={u.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar user={u} size={size} ring />
        </span>
      ))}
      {more > 0 && (
        <span
          className="grid place-items-center rounded-full bg-raised t-micro text-ink-2 shadow-[0_0_0_2px_var(--canvas)]"
          style={{ width: size, height: size, marginLeft: -size * 0.3 }}
        >
          +{more}
        </span>
      )}
    </span>
  )
}

// ── small labels ──────────────────────────────────────────────────────────────────────

export function Kbd({ combo, className }: { combo: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-hover px-1 t-meta text-ink-3 shadow-[inset_0_-1px_0_var(--line-strong),inset_0_0_0_.5px_var(--line)]',
        className,
      )}
    >
      {shortcutLabel(combo)}
    </kbd>
  )
}

/** A count or short state next to a label. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'signal' | 'review' | 'cut' | 'cue' | 'solid'
  className?: string
}) {
  const tones = {
    neutral: 'bg-hover text-ink-2',
    signal: 'bg-signal-soft text-signal',
    review: 'bg-review-soft text-review',
    cut: 'bg-cut-soft text-cut',
    cue: 'bg-cue-soft text-cue',
    solid: 'bg-signal text-signal-ink',
  }
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 rounded-tag px-1.5 t-micro tabular whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A removable chip: tags, search tokens, recipients. */
export function Chip({
  children,
  onRemove,
  icon: Icon,
  className,
  onClick,
  active,
}: {
  children: ReactNode
  onRemove?: () => void
  icon?: LucideIcon
  className?: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 rounded-tag pr-1 pl-2 t-caption',
        active ? 'bg-signal-soft text-signal' : 'bg-hover text-ink-2 shadow-[inset_0_0_0_.5px_var(--line)]',
        onClick && 'press cursor-default hover-device:hover:text-ink',
        !onRemove && 'pr-2',
        className,
      )}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {Icon && <Icon size={12} strokeWidth={1.9} className="shrink-0" />}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="press -mr-0.5 grid size-4 place-items-center rounded-[3px] text-ink-3 hover:bg-press hover:text-ink"
          aria-label="Remove"
        >
          <X size={11} strokeWidth={2.2} />
        </button>
      )}
    </span>
  )
}

/** Mono timecode; `frames` adds :ff. */
export function Timecode({
  seconds,
  fps = 30,
  frames,
  className,
}: {
  seconds: number
  fps?: number
  frames?: boolean
  className?: string
}) {
  const text = frames ? formatTimecode(seconds, fps) : formatTimecode(seconds, fps).replace(/:\d+$/, '')
  return <span className={cn('t-meta tabular', className)}>{text}</span>
}

// ── popover ───────────────────────────────────────────────────────────────────────────

export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  width,
  open,
  onOpenChange,
  className,
  sideOffset = 8,
}: {
  trigger: ReactElement
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  width?: number
  open?: boolean
  onOpenChange?: (o: boolean) => void
  className?: string
  sideOffset?: number
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      <P.Trigger render={trigger} />
      <P.Portal>
        <P.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={10}
          className="z-[80] outline-none"
        >
          <P.Popup className={cn('gl-pop floating outline-none', className)} style={{ width }}>
            {children}
          </P.Popup>
        </P.Positioner>
      </P.Portal>
    </P.Root>
  )
}

// ── inline rename ─────────────────────────────────────────────────────────────────────

/**
 * Text that becomes an input on double-click (or when `editing` is set): Enter saves, Escape cancels, blur saves.
 */
export function InlineEdit({
  value,
  onSave,
  className,
  inputClassName,
  editing: controlled,
  onEditingChange,
  placeholder,
  disabled,
  tooltip = 'Double-click to rename',
}: {
  value: string
  onSave: (v: string) => void
  className?: string
  inputClassName?: string
  editing?: boolean
  onEditingChange?: (e: boolean) => void
  placeholder?: string
  disabled?: boolean
  tooltip?: string | null
}) {
  const [local, setLocal] = useState(false)
  const editing = controlled ?? local
  const setEditing = (e: boolean) => (onEditingChange ? onEditingChange(e) : setLocal(e))
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      setDraft(value)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.select()
      })
    }
  }, [editing, value])
  if (editing)
    return (
      <input
        ref={ref}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft.trim() && draft !== value) onSave(draft.trim())
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          // preventDefault: the same Enter must not also press a button in a dialog the save opens.
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'min-w-0 rounded-[5px] bg-well px-1 -mx-1 text-ink outline-none shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
          className,
          inputClassName,
        )}
      />
    )
  const text = (
    <span
      className={cn('min-w-0 truncate', !value && 'text-ink-3', className)}
      onDoubleClick={(e) => {
        if (disabled) return
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {value || placeholder}
    </span>
  )
  return tooltip && !disabled ? <Tooltip label={tooltip}>{text}</Tooltip> : text
}
