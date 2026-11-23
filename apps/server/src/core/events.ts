import type { Logger } from './logger.ts'

/**
 * Typed in-process events. Modules add their events by merging into this interface:
 *   declare module '../../core/events.ts' { interface Events { 'media.updated': { id: string } } }
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by declaration merging
export interface Events {}

type Handler<T> = (payload: T) => void | Promise<void>

export class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>()
  private any = new Set<(name: string, payload: unknown) => void>()
  private log: Logger
  constructor(log: Logger) {
    this.log = log
  }

  on<K extends keyof Events>(name: K, handler: Handler<Events[K]>): () => void {
    const set = this.handlers.get(name as string) ?? new Set()
    set.add(handler as Handler<unknown>)
    this.handlers.set(name as string, set)
    return () => set.delete(handler as Handler<unknown>)
  }

  onAny(handler: (name: string, payload: unknown) => void) {
    this.any.add(handler)
  }

  /** Fire and forget: handlers run after the current tick; errors are logged, never thrown at the emitter. */
  emit<K extends keyof Events>(name: K, payload: Events[K]) {
    queueMicrotask(() => {
      for (const h of this.any) {
        try {
          h(name as string, payload)
        } catch (err) {
          this.log.error({ err, event: name }, 'event listener failed')
        }
      }
      for (const h of this.handlers.get(name as string) ?? []) {
        Promise.resolve()
          .then(() => h(payload))
          .catch((err) => this.log.error({ err, event: name }, 'event handler failed'))
      }
    })
  }
}
