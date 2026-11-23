import type { Role } from '@greenlit/shared'

export interface PermissionDef {
  description: string
  /** Roles that get it. Admins always have every permission. */
  roles: Role[]
}

/** Every module declares its own permissions; roles are the union of what modules grant them. */
export class PermissionRegistry {
  private defs = new Map<string, PermissionDef & { module: string }>()

  register(module: string, defs: Record<string, PermissionDef>) {
    for (const [name, def] of Object.entries(defs)) {
      if (this.defs.has(name)) throw new Error(`Permission ${name} declared twice`)
      this.defs.set(name, { ...def, module })
    }
  }

  forRole(role: Role): Set<string> {
    if (role === 'admin') return new Set(['*', ...this.defs.keys()])
    const out = new Set<string>()
    for (const [name, def] of this.defs) if (def.roles.includes(role)) out.add(name)
    return out
  }

  list() {
    return [...this.defs.entries()].map(([name, d]) => ({ name, ...d }))
  }
}
