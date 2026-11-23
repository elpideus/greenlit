import { registerLocales } from '@/lib/i18n'
import type { MenuEntry } from '@/ui/Menu'
import type { FeatureDefinition, MenuContribution, SlotEntry } from './feature'
import common from './locales'

/** Every folder in `features/` with a `feature.ts` or `feature.tsx`, found at build time. */
const modules = import.meta.glob<{ default: FeatureDefinition }>('../features/*/feature.{ts,tsx}', {
  eager: true,
})

export const features: FeatureDefinition[] = Object.values(modules)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => a.id.localeCompare(b.id))

registerLocales('common', common)
for (const f of features) if (f.locales) registerLocales(f.id, f.locales)

export const routes = features.flatMap((f) => (f.routes ?? []).map((r) => ({ ...r, feature: f.id })))
export const navItems = features
  .flatMap((f) => (f.nav ?? []).map((n) => ({ ...n, feature: f.id })))
  .sort((a, b) => a.order - b.order)
export const commands = features.flatMap((f) => (f.commands ?? []).map((c) => ({ ...c, feature: f.id })))
export const settingsSections = features
  .flatMap((f) => (f.settings ?? []).map((s) => ({ ...s, feature: f.id })))
  .sort((a, b) => a.order - b.order)
export const globals = features.flatMap((f) => f.globals ?? [])
export const providers = features.flatMap((f) => (f.provider ? [f.provider] : []))

const slotMap = new Map<string, (SlotEntry & { feature: string })[]>()
for (const f of features) {
  for (const [name, entries] of Object.entries(f.slots ?? {})) {
    const list = slotMap.get(name) ?? []
    for (const e of entries) list.push({ ...e, feature: f.id })
    slotMap.set(name, list)
  }
}
for (const list of slotMap.values()) list.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

export function slotEntries(name: string) {
  return slotMap.get(name) ?? []
}

// biome-ignore lint/suspicious/noExplicitAny: contexts differ per menu
const menuMap = new Map<string, (MenuContribution<any> & { feature: string })[]>()
for (const f of features) {
  for (const [name, entries] of Object.entries(f.menus ?? {})) {
    const list = menuMap.get(name) ?? []
    for (const e of entries) list.push({ ...e, feature: f.id })
    menuMap.set(name, list)
  }
}
for (const list of menuMap.values()) list.sort((a, b) => (a.order ?? 50) - (b.order ?? 50))

/**
 * Everything features contribute to a named menu, in order, with a line between bands (see below).
 * `own` are the menu owner's items, placed by their `order` too.
 */
export function menuEntries<C>(
  name: string,
  ctx: C,
  own: { order: number; items: MenuEntry[] }[] = [],
): MenuEntry[] {
  const all = [
    ...own.map((o) => ({ order: o.order, items: () => o.items })),
    ...(menuMap.get(name) ?? []).map((c) => ({ order: c.order ?? 50, items: () => c.items(ctx) })),
  ].sort((a, b) => a.order - b.order)
  // Lines separate bands, not contributions: open/rename (< 20), workflow (20–79), files (80–99), delete (100+).
  const band = (order: number) => (order < 20 ? 0 : order < 80 ? 1 : order < 100 ? 2 : 3)
  const out: MenuEntry[] = []
  let last: number | null = null
  for (const c of all) {
    let items: MenuEntry[] = []
    try {
      items = c.items().filter(Boolean)
    } catch (err) {
      console.error(`menu ${name}`, err)
    }
    if (!items.length) continue
    if (last !== null && band(c.order) !== last) out.push('separator')
    out.push(...items)
    last = band(c.order)
  }
  return out
}
