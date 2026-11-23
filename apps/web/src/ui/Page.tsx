import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { rise } from '@/lib/motion'

/** A page inside the shell: max width, gutters, entrance. Full-bleed pages (viewer, editor, map) skip it. */
export function Page({ children, className, width = 'wide' }: { children: ReactNode; className?: string; width?: 'wide' | 'text' | 'full' }) {
  return (
    <motion.main
      {...rise}
      className={cn(
        'mx-auto w-full px-[var(--gutter)] pt-6 pb-24',
        width === 'wide' && 'max-w-[1680px]',
        width === 'text' && 'max-w-[880px]',
        className,
      )}
    >
      {children}
    </motion.main>
  )
}

/** Title, a meta line, at most one primary action; an optional toolbar row under it. */
export function PageHeader({
  title,
  meta,
  actions,
  toolbar,
  leading,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  leading?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex min-h-10 flex-wrap items-end gap-x-6 gap-y-3">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="t-title-1 truncate text-ink">{title}</h1>
          {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 t-callout text-ink-3">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="mt-5 flex flex-wrap items-center gap-2">{toolbar}</div>}
    </header>
  )
}

/** A titled group of content on a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-10', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            {title && <h2 className="t-headline text-ink">{title}</h2>}
            {description && <p className="mt-0.5 t-callout text-ink-3">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/** A panel surface (settings groups, side cards). Rows inside are separated by hairlines. */
export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]',
        padded && 'px-4 py-1',
        '[&>*+*]:border-t [&>*+*]:border-line',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A labelled row inside a Card: label left, control right. */
export function Row({ label, description, children, className }: { label: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-6 py-2.5', className)}>
      <div className="min-w-0">
        <div className="t-callout font-[550] text-ink">{label}</div>
        {description && <div className="mt-0.5 t-caption text-ink-3">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
