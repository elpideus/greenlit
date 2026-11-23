import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from 'hono'
import type { Actor } from './actor.ts'
import type { Config } from './config.ts'
import type { Db, Sql } from './db.ts'
import type { EntityDirectory } from './entities.ts'
import type { EventBus } from './events.ts'
import type { HookRegistry } from './hooks.ts'
import type { Api } from './http.ts'
import type { JobQueue } from './jobs.ts'
import type { Logger } from './logger.ts'
import type { McpRegistry } from './mcp.ts'
import type { PermissionDef, PermissionRegistry } from './permissions.ts'
import type { RealtimeHub } from './realtime.ts'
import type { ServiceRegistry } from './services.ts'
import type { SettingsStore } from './settings.ts'
import type { TaskService } from './tasks.ts'
import type { VersioningService } from './versioning.ts'

export type ActorResolver = (c: Context) => Promise<Actor | null>

export interface Kernel {
  config: Config
  log: Logger
  db: Db
  sql: Sql
  api: Api
  services: ServiceRegistry
  permissions: PermissionRegistry
  events: EventBus
  hooks: HookRegistry
  jobs: JobQueue
  tasks: TaskService
  mcp: McpRegistry
  settings: SettingsStore
  realtime: RealtimeHub
  versions: VersioningService
  entities: EntityDirectory
  auth: { resolvers: ActorResolver[] }
  startHandlers: (() => Promise<void> | void)[]
  stopHandlers: (() => Promise<void> | void)[]
  modules: GreenlitModule[]
}

export interface ModuleContext extends Omit<Kernel, 'startHandlers' | 'stopHandlers' | 'auth' | 'modules'> {
  module: GreenlitModule
  /** Add a way to recognise who is calling (session cookie, API token, share link...). */
  addActorResolver: (fn: ActorResolver) => void
  /** Runs once everything is set up and the job queue is running. */
  onStart: (fn: () => Promise<void> | void) => void
  onStop: (fn: () => Promise<void> | void) => void
  /** Is another module loaded? Use it for optional integrations. */
  has: (moduleId: string) => boolean
}

export interface GreenlitModule {
  /** Folder name and stable id. */
  id: string
  name: string
  description?: string
  /** Modules that must load first. A module whose dependencies are missing is not loaded. */
  dependsOn?: string[]
  /** Loaded first when present, but not required. */
  after?: string[]
  permissions?: Record<string, PermissionDef>
  setup: (ctx: ModuleContext) => void | Promise<void>
}

export const defineModule = (m: GreenlitModule): GreenlitModule => m

/**
 * Finds every `src/modules/<id>/module.ts`. Adding a feature = adding a folder; removing it = deleting the
 * folder (or listing it in GREENLIT_DISABLED_MODULES). Nothing else has to be edited.
 */
export async function discoverModules(
  dir: string,
  disabled: Set<string>,
  log: Logger,
): Promise<GreenlitModule[]> {
  const found: GreenlitModule[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const file = join(dir, entry.name, 'module.ts')
    if (!existsSync(file)) continue
    if (disabled.has(entry.name)) {
      log.info({ module: entry.name }, 'module disabled')
      continue
    }
    const mod = (await import(pathToFileURL(file).href)).default as GreenlitModule
    if (!mod?.id) throw new Error(`${file} must export default defineModule({...})`)
    if (mod.id !== entry.name) throw new Error(`Module in folder ${entry.name} has id ${mod.id}`)
    found.push(mod)
  }
  return orderModules(found, log)
}

function orderModules(mods: GreenlitModule[], log: Logger): GreenlitModule[] {
  const byId = new Map(mods.map((m) => [m.id, m]))
  // Drop modules whose hard dependencies are missing (repeat until stable).
  let changed = true
  while (changed) {
    changed = false
    for (const m of [...byId.values()]) {
      const missing = (m.dependsOn ?? []).filter((d) => !byId.has(d))
      if (missing.length) {
        log.warn({ module: m.id, missing }, 'module skipped: missing dependencies')
        byId.delete(m.id)
        changed = true
      }
    }
  }
  const ordered: GreenlitModule[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (m: GreenlitModule, path: string[]) => {
    if (state.get(m.id) === 'done') return
    if (state.get(m.id) === 'visiting')
      throw new Error(`Module dependency cycle: ${[...path, m.id].join(' → ')}`)
    state.set(m.id, 'visiting')
    for (const d of [...(m.dependsOn ?? []), ...(m.after ?? [])]) {
      const dep = byId.get(d)
      if (dep) visit(dep, [...path, m.id])
    }
    state.set(m.id, 'done')
    ordered.push(m)
  }
  for (const m of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) visit(m, [])
  return ordered
}

export async function setupModules(kernel: Kernel, mods: GreenlitModule[]) {
  const ids = new Set(mods.map((m) => m.id))
  for (const module of mods) {
    if (module.permissions) kernel.permissions.register(module.id, module.permissions)
    const ctx: ModuleContext = {
      ...kernel,
      log: kernel.log.child({ module: module.id }),
      module,
      addActorResolver: (fn) => kernel.auth.resolvers.push(fn),
      onStart: (fn) => kernel.startHandlers.push(fn),
      onStop: (fn) => kernel.stopHandlers.push(fn),
      has: (id) => ids.has(id),
    }
    await module.setup(ctx)
    kernel.modules.push(module)
  }
}
