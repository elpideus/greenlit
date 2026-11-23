import { Children, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A meta line: parts separated by quiet dots (false / null parts are skipped). When it wraps, the dot that would
 * start a new line is clipped away, so no line begins or ends with a separator.
 */
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  const parts = Children.toArray(children).filter(Boolean)
  return (
    <div className={cn('min-w-0 overflow-hidden', className)}>
      <div className="-ml-4 flex flex-wrap items-center gap-y-1">
        {parts.map((p, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static order
            key={i}
            className="relative flex items-center pl-4 whitespace-nowrap before:absolute before:left-[6px] before:text-ink-4 before:content-['·']"
          >
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}
