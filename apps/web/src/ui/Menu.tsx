import { Menu as M } from '@base-ui/react/menu'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { type ReactElement, type ReactNode, useCallback, useRef } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/cn'
import { shortcutLabel } from '@/lib/hotkeys'

/**
 * Menus. Everything that can be right-clicked has a menu, and the same items appear behind its ⋯ button.
 * Order: open / rename, the workflow actions, file actions, Delete last (danger). A menu on a selection acts on the
 * selection and says so ("Delete 3 items").
 */
export interface MenuAction {
  label: ReactNode
  icon?: LucideIcon
  shortcut?: string
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect?: () => void
  /** A submenu. */
  items?: MenuEntry[]
  keepOpen?: boolean
}
export type MenuEntry = MenuAction | 'separator' | { group: ReactNode } | false | null | undefined

const itemClass = cn(
  'relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-[7px] px-2 pr-2.5 t-callout text-ink outline-none',
  'data-[highlighted]:bg-hover data-[disabled]:opacity-40 data-[popup-open]:bg-hover',
)

function clean(entries: MenuEntry[]) {
  const out: Exclude<MenuEntry, false | null | undefined>[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === 'separator' && (out.length === 0 || out.at(-1) === 'separator')) continue
    out.push(e)
  }
  while (out.at(-1) === 'separator') out.pop()
  return out
}

export function MenuItems({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {clean(items).map((e, i) => {
        if (e === 'separator') return <M.Separator key={`s${i}`} className="mx-2 my-1 h-px bg-line" />
        if ('group' in e)
          return (
            <div key={`g${i}`} className="px-2 pt-2 pb-1 t-micro text-ink-3">
              {e.group}
            </div>
          )
        const Icon = e.icon
        const body = (
          <>
            <span className={cn('grid w-4 place-items-center', e.danger ? 'text-cut' : 'text-ink-2')}>
              {e.checked ? (
                <Check size={14} strokeWidth={2.2} className="text-signal" />
              ) : (
                Icon && <Icon size={15} strokeWidth={1.75} />
              )}
            </span>
            <span className={cn('min-w-0 flex-1 truncate', e.danger && 'text-cut')}>{e.label}</span>
            {e.hint && <span className="t-caption text-ink-3">{e.hint}</span>}
            {e.shortcut && <span className="t-meta pl-4 text-ink-3">{shortcutLabel(e.shortcut)}</span>}
          </>
        )
        if (e.items) {
          return (
            <M.SubmenuRoot key={`m${i}`}>
              <M.SubmenuTrigger className={itemClass} disabled={e.disabled}>
                {body}
                <ChevronRight size={14} className="-mr-1 text-ink-3" />
              </M.SubmenuTrigger>
              <M.Portal>
                <M.Positioner className="z-[80] outline-none" sideOffset={-4} alignOffset={-5}>
                  <M.Popup className="gl-pop floating min-w-[200px] p-[5px] outline-none">
                    <MenuItems items={e.items} />
                  </M.Popup>
                </M.Positioner>
              </M.Portal>
            </M.SubmenuRoot>
          )
        }
        return (
          <M.Item
            key={`i${i}`}
            className={itemClass}
            disabled={e.disabled}
            closeOnClick={!e.keepOpen}
            onClick={() => e.onSelect?.()}
          >
            {body}
          </M.Item>
        )
      })}
    </>
  )
}

/** A dropdown menu on a trigger (⋯ buttons, "New", sort pickers). */
export function Menu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  width = 220,
  header,
}: {
  trigger: ReactElement
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  width?: number
  header?: ReactNode
}) {
  return (
    <M.Root>
      <M.Trigger render={trigger} />
      <M.Portal>
        <M.Positioner className="z-[80] outline-none" side={side} align={align} sideOffset={6}>
          <M.Popup className="gl-pop floating p-[5px] outline-none" style={{ minWidth: width }}>
            {header}
            <MenuItems items={items} />
          </M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.Root>
  )
}

// ── right-click menus ──────────────────────────────────────────────────────────────

interface ContextState {
  open: boolean
  x: number
  y: number
  items: MenuEntry[]
  header?: ReactNode
  show: (x: number, y: number, items: MenuEntry[], header?: ReactNode) => void
  close: () => void
}
const useContextStore = create<ContextState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items, header) => set({ open: true, x, y, items, header }),
  close: () => set({ open: false }),
}))

/** Opens the shared right-click menu at a point (also used by ⋯ buttons that want the same items). */
export function openContextMenu(x: number, y: number, items: MenuEntry[], header?: ReactNode) {
  useContextStore.getState().show(x, y, items, header)
}

/**
 * Spread on any element to give it a right-click menu (`<div {...menu}>`). A long press opens it on touch screens.
 * `items` is called when the menu opens, so it always reflects the current selection.
 */
export function useContextMenu(
  items: () => MenuEntry[],
  opts: { disabled?: boolean; header?: () => ReactNode } = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const headerRef = useRef(opts.header)
  headerRef.current = opts.header
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (opts.disabled) return
      const list = itemsRef.current()
      if (!clean(list).length) return
      e.preventDefault()
      e.stopPropagation()
      openContextMenu(e.clientX, e.clientY, list, headerRef.current?.())
    },
    [opts.disabled],
  )
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (opts.disabled) return
      const t = e.touches[0]
      if (!t) return
      const { clientX, clientY } = t
      timer.current = setTimeout(() => {
        navigator.vibrate?.(8)
        openContextMenu(clientX, clientY, itemsRef.current(), headerRef.current?.())
      }, 480)
    },
    [opts.disabled],
  )
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  return { onContextMenu, onTouchStart, onTouchEnd: cancel, onTouchMove: cancel }
}

/** Mounted once at the app root. */
export function ContextMenuHost() {
  const { open, x, y, items, header, close } = useContextStore()
  const anchor = {
    getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
  }
  return (
    <M.Root open={open} onOpenChange={(o) => !o && close()} modal={false}>
      <M.Portal>
        <M.Positioner
          anchor={anchor}
          className="z-[85] outline-none"
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
        >
          <M.Popup className="gl-pop floating min-w-[220px] p-[5px] outline-none">
            {header}
            <MenuItems items={items} />
          </M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.Root>
  )
}
