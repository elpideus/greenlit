/**
 * Synchronous extension points: unlike events, the caller waits for every hook and can use their answers.
 * Modules declare hooks by merging into this interface:
 *   declare module '../../core/hooks.ts' {
 *     interface Hooks { 'media.usage': { args: { mediaId: string }; result: string[] } }
 *   }
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by declaration merging
export interface Hooks {}

type HookFn<K extends keyof Hooks> = Hooks[K] extends { args: infer A; result: infer R }
  ? (args: A) => Promise<R> | R
  : never

export class HookRegistry {
  private hooks = new Map<string, ((args: unknown) => unknown)[]>()

  add<K extends keyof Hooks>(name: K, fn: HookFn<K>) {
    const list = this.hooks.get(name as string) ?? []
    list.push(fn as (args: unknown) => unknown)
    this.hooks.set(name as string, list)
  }

  /** Runs every hook and returns their results in registration order. */
  async run<K extends keyof Hooks>(
    name: K,
    args: Hooks[K] extends { args: infer A } ? A : never,
  ): Promise<(Hooks[K] extends { result: infer R } ? R : never)[]> {
    const out = []
    for (const fn of this.hooks.get(name as string) ?? []) out.push(await fn(args))
    return out as never
  }
}
