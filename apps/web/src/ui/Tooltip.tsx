import { Tooltip as T } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { shortcutLabel } from '@/lib/hotkeys'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delay={450} closeDelay={60} timeout={500}>
      {children}
    </T.Provider>
  )
}

/** A label for an icon or a truncated value. Short; never the only way to learn something essential. */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
  disabled,
}: {
  label: ReactNode
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactElement
  disabled?: boolean
}) {
  if (disabled || !label) return children
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={7} className="z-[90]">
          <T.Popup className="gl-tip force-dark pointer-events-none flex items-center gap-2 rounded-[7px] bg-[#232523]/95 px-2 py-1 t-caption text-[#edefed] shadow-[0_6px_20px_-6px_rgba(0,0,0,.6),inset_0_0_0_.5px_rgba(255,255,255,.12)] backdrop-blur-md">
            <span>{label}</span>
            {shortcut && <span className="t-meta text-[#a8aca9]">{shortcutLabel(shortcut)}</span>}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  )
}
