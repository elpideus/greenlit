import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { LocaleBundle } from '@/lib/i18n'
import type { MenuEntry } from '@/ui/Menu'

/**
 * A web feature is one folder: `features/<id>/feature.ts(x)` default-exporting `defineFeature({...})`.
 * The app discovers every folder (app/registry.ts); a feature adds routes, top-bar destinations, palette commands,
 * settings sections and slot entries without touching anything outside its folder. Delete the folder and the feature
 * is gone.
 */

type PageModule = { default: ComponentType }

export interface FeatureRoute {
  /** React Router path, e.g. `/library` or `/media/:id`. */
  path: string
  /** Lazy page module (default export = the page). */
  load: () => Promise<PageModule>
  /**
   * - `shell`: signed in, inside the top bar (default)
   * - `full`: signed in, full window (viewer, editor)
   * - `public`: anyone, no shell (sign-in, share links, the headless render page)
   */
  layout?: 'shell' | 'full' | 'public'
  /** Permission needed to open the page. */
  permission?: string
}

export interface NavItem {
  id: string
  /** i18n key in the feature's namespace, or a plain label. */
  label: string
  to: string
  icon: LucideIcon
  order: number
  permission?: string
  /** Extra path prefixes that keep this item active (e.g. `/media` for the library). */
  match?: string[]
}

export interface PaletteCommand {
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  keywords?: string[]
  group?: string
  permission?: string
  run: (ctx: { navigate: (to: string) => void }) => void
}

export interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
  /** Groups in the settings sidebar: you / workspace / publishing / system. */
  group: 'you' | 'workspace' | 'publishing' | 'system'
  order: number
  permission?: string
  load: () => Promise<PageModule>
}

export interface SlotEntry<P = Record<string, unknown>> {
  id: string
  order?: number
  component: ComponentType<P>
  /** Hide the entry for some props (e.g. only for videos). */
  when?: (props: P) => boolean
  /** Tabs and panels: a label and icon. */
  label?: string
  icon?: LucideIcon
  permission?: string
}

/**
 * Items a feature adds to another feature's menus (right-click and ⋯), e.g. "Send for review" on media.
 * `items` runs when the menu opens, with the menu's context (see the menu list in docs/ARCHITECTURE.md).
 * Open your own dialogs from here through a store your feature mounts in `globals`.
 */
export interface MenuContribution<C = Record<string, unknown>> {
  id: string
  /** Lower comes first; contributions are separated by a line. Open/rename ≈ 0, workflow 20–60, files 80, delete 100. */
  order?: number
  items: (ctx: C) => MenuEntry[]
}

export interface FeatureDefinition {
  id: string
  locales?: LocaleBundle
  routes?: FeatureRoute[]
  nav?: NavItem[]
  commands?: PaletteCommand[]
  settings?: SettingsSection[]
  // biome-ignore lint/suspicious/noExplicitAny: slot props differ per slot; Slot<P> types them at the call site
  slots?: Record<string, SlotEntry<any>[]>
  // biome-ignore lint/suspicious/noExplicitAny: each menu has its own context type
  menus?: Record<string, MenuContribution<any>[]>
  /** Components mounted once inside the signed-in app (hosts, listeners). */
  globals?: ComponentType[]
  /** Wraps the whole app (providers). */
  provider?: ComponentType<{ children: ReactNode }>
}

export function defineFeature(def: FeatureDefinition): FeatureDefinition {
  return def
}
