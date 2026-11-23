import { Toaster as SonnerToaster, toast as sonner } from 'sonner'
import { errorMessage } from '@/lib/api'
import { Tally } from './Signal'

/**
 * Toasts say what happened with the real nouns ("Sent to Marco for review"). They never carry the only copy of
 * important information and never ask a question.
 */
export const toast = {
  done: (title: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner(title, {
      description: opts?.description,
      action: opts?.action,
      icon: <Tally tone="greenlit" size={8} />,
    }),
  info: (title: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner(title, { description: opts?.description, action: opts?.action }),
  error: (err: unknown, title?: string) =>
    sonner(title ?? errorMessage(err), {
      description: title ? errorMessage(err) : undefined,
      icon: <Tally tone="failed" size={8} />,
      duration: 7000,
    }),
  promise: sonner.promise,
  dismiss: sonner.dismiss,
}

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      gap={8}
      offset={20}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'floating flex w-[min(380px,calc(100vw-32px))] items-start gap-3 px-3.5 py-3 t-callout text-ink pointer-events-auto',
          title: 't-callout font-[550] text-ink',
          description: 'mt-0.5 t-caption text-ink-3',
          icon: 'mt-[5px] flex shrink-0',
          actionButton:
            'press ml-auto shrink-0 rounded-control bg-hover px-2.5 py-1 t-caption font-[550] text-ink hover:bg-press',
          content: 'min-w-0 flex-1',
        },
      }}
    />
  )
}
