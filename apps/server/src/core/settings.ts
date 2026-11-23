import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Db } from './db.ts'
import type { EventBus } from './events.ts'
import { settings } from './schema.ts'

declare module './events.ts' {
  interface Events {
    'settings.changed': { key: string; value: unknown }
  }
}

interface SettingDef<T> {
  schema: z.ZodType<T>
  default: () => T
  /** Visible without signing in (branding, theme). */
  public?: boolean
}

/**
 * Typed key/value settings. A module defines its keys with a schema and default; values are cached in memory
 * and every change is announced with `settings.changed`.
 */
export class SettingsStore {
  private defs = new Map<string, SettingDef<unknown>>()
  private cache = new Map<string, unknown>()
  private loaded = false

  private db: Db
  private events: EventBus
  constructor(db: Db, events: EventBus) {
    this.db = db
    this.events = events
  }

  define<T>(key: string, def: SettingDef<T>): SettingHandle<T> {
    if (this.defs.has(key)) throw new Error(`Setting ${key} defined twice`)
    this.defs.set(key, def as SettingDef<unknown>)
    return new SettingHandle<T>(this, key)
  }

  async load() {
    const rows = await this.db.select().from(settings)
    for (const r of rows) {
      const def = this.defs.get(r.key)
      if (!def) continue
      const parsed = def.schema.safeParse(r.value)
      this.cache.set(r.key, parsed.success ? parsed.data : def.default())
    }
    this.loaded = true
  }

  get<T>(key: string): T {
    if (!this.loaded) throw new Error('settings not loaded yet')
    const def = this.defs.get(key)
    if (!def) throw new Error(`Unknown setting ${key}`)
    if (!this.cache.has(key)) this.cache.set(key, def.default())
    return this.cache.get(key) as T
  }

  async set<T>(key: string, value: T, userId: string | null = null): Promise<T> {
    const def = this.defs.get(key)
    if (!def) throw new Error(`Unknown setting ${key}`)
    const parsed = def.schema.parse(value) as T
    await this.db
      .insert(settings)
      .values({ key, value: parsed as object, updatedBy: userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: parsed as object, updatedBy: userId, updatedAt: new Date() },
      })
    this.cache.set(key, parsed)
    this.events.emit('settings.changed', { key, value: parsed })
    return parsed
  }

  async isStored(key: string) {
    const [row] = await this.db.select({ key: settings.key }).from(settings).where(eq(settings.key, key))
    return !!row
  }
}

export class SettingHandle<T> {
  private store: SettingsStore
  readonly key: string
  constructor(store: SettingsStore, key: string) {
    this.store = store
    this.key = key
  }
  get(): T {
    return this.store.get<T>(this.key)
  }
  set(value: T, userId: string | null = null): Promise<T> {
    return this.store.set(this.key, value, userId)
  }
  async update(patch: Partial<T>, userId: string | null = null): Promise<T> {
    return this.set({ ...this.get(), ...patch } as T, userId)
  }
}
