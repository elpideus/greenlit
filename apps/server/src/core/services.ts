/**
 * Cross-module services. A module provides its public service by merging into this interface:
 *
 *   declare module '../../core/services.ts' {
 *     interface Services { media: MediaService }
 *   }
 *   ctx.services.provide('media', service)
 *
 * Mark a service optional (`places?: PlacesService`) when other modules must keep working without it.
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by declaration merging
export interface Services {}

export type ServiceRegistry = Services & {
  provide<K extends keyof Services>(name: K, impl: NonNullable<Services[K]>): void
}

export function createServiceRegistry(): ServiceRegistry {
  const reg = {
    provide(name: string, impl: unknown) {
      if (name in reg && name !== 'provide') throw new Error(`Service ${name} provided twice`)
      ;(reg as Record<string, unknown>)[name] = impl
    },
  }
  return reg as unknown as ServiceRegistry
}
