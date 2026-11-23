import { cn } from '@/lib/cn'
import { useConfig } from '@/lib/session'
import { useMode } from '@/lib/theme'
import { Signal, Wordmark } from '@/ui'

/**
 * The instance's brand in the top bar: its own logo when Settings → Branding has one, otherwise the signal and the
 * instance name (Greenlit's own wordmark when the name is Greenlit).
 */
export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  const { data } = useConfig()
  const { mode } = useMode(data?.theme.defaultMode)
  const b = data?.branding
  const logo = mode === 'dark' ? (b?.logoDark ?? b?.logoLight) : (b?.logoLight ?? b?.logoDark)
  const name = b?.appName ?? 'Greenlit'
  if (logo && !compact)
    return <img src={logo} alt={name} className={cn('h-6 w-auto max-w-[180px] object-contain', className)} draggable={false} />
  if (compact && b?.mark) return <img src={b.mark} alt={name} className={cn('size-6 object-contain', className)} draggable={false} />
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Signal tone="greenlit" size={22} animate={false} title={name} />
      {!compact &&
        (name === 'Greenlit' ? (
          <Wordmark height={17} />
        ) : (
          <span className="t-headline font-display tracking-[var(--gl-display-tracking)] [text-transform:var(--gl-display-transform)]">
            {name}
          </span>
        ))}
    </span>
  )
}
