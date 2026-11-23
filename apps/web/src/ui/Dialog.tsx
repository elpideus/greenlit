import { Dialog as D } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/cn'
import { Button } from './Button'

/**
 * A modal task: dims the page, centred, one primary action. Use for short focused tasks
 * (create, send for review, confirm). Longer work gets its own page.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
  className,
  bare,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
  /** No padding or header: the content draws everything. */
  bare?: boolean
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <D.Portal>
        <D.Backdrop className="gl-backdrop fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
        <D.Popup
          className={cn(
            'gl-dialog fixed top-1/2 left-1/2 z-[71] max-h-[min(86dvh,900px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2',
            'flex flex-col overflow-hidden rounded-sheet bg-raised outline-none',
            'shadow-[var(--shadow-sheet),inset_0_0_0_.5px_var(--line-strong),inset_0_1px_0_var(--highlight)]',
            className,
          )}
          style={{ maxWidth: width }}
        >
          {bare ? (
            children
          ) : (
            <>
              {(title || description) && (
                <div className="flex items-start gap-3 px-6 pt-5 pb-1">
                  <div className="min-w-0 flex-1">
                    {title && <D.Title className="t-title-2 text-ink">{title}</D.Title>}
                    {description && (
                      <D.Description className="mt-1 t-callout text-ink-3">{description}</D.Description>
                    )}
                  </div>
                  <D.Close
                    className="press -mt-0.5 -mr-2 grid size-7 place-items-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </D.Close>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
              {footer && <div className="flex items-center justify-end gap-2 px-6 pt-1 pb-5">{footer}</div>}
            </>
          )}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}

/** A panel that slides in from the right without blocking the page flow (details, inspectors). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  width = 420,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  children: ReactNode
  width?: number
  footer?: ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <D.Portal>
        <D.Backdrop className="gl-backdrop fixed inset-0 z-[70] bg-scrim/50" />
        <D.Popup
          className="gl-sheet-right fixed top-2 right-2 bottom-2 z-[71] flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-sheet bg-raised shadow-[var(--shadow-sheet),inset_0_0_0_.5px_var(--line-strong)] outline-none"
          style={{ maxWidth: width }}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 px-5">
            <D.Title className="t-headline min-w-0 flex-1 truncate text-ink">{title}</D.Title>
            <D.Close
              className="press grid size-7 place-items-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
              aria-label="Close"
            >
              <X size={16} />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}

// ── confirmation for destructive, irreversible actions only ─────────────────────────────

interface ConfirmRequest {
  title: ReactNode
  body?: ReactNode
  confirm: string
  cancel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}
const useConfirmStore = create<{ req: ConfirmRequest | null; set: (r: ConfirmRequest | null) => void }>(
  (set) => ({
    req: null,
    set: (req) => set({ req }),
  }),
)

/** `if (await confirm({ title: 'Delete 3 items?', confirm: 'Delete', danger: true })) …` */
export function confirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }))
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore()
  const [busy, setBusy] = useState(false)
  const close = (ok: boolean) => {
    req?.resolve(ok)
    setBusy(false)
    set(null)
  }
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close(false)}
      title={req?.title}
      description={req?.body}
      width={400}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {req?.cancel ?? 'Cancel'}
          </Button>
          <Button
            variant={req?.danger ? 'danger' : 'primary'}
            loading={busy}
            autoFocus
            onClick={() => {
              setBusy(true)
              close(true)
            }}
          >
            {req?.confirm}
          </Button>
        </>
      }
    />
  )
}
