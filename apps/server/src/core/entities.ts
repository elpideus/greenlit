import type { Actor } from './actor.ts'

export interface EntitySummary {
  type: string
  id: string
  title: string
  thumbnailUrl: string | null
  kind: string | null
  /** Path inside the web app, e.g. /media/<id> */
  href: string
  projectId: string | null
}

export interface EntityKind {
  /** Summaries for the ids this actor may see; ids they may not see are simply missing. */
  summarize: (ids: string[], actor: Actor) => Promise<EntitySummary[]>
  canView: (id: string, actor: Actor) => Promise<boolean>
}

/**
 * A directory of "things" (media, posts, compositions, projects...). Links, comments, search, the map and
 * notifications use it to show any entity without importing the module that owns it.
 */
export class EntityDirectory {
  private kinds = new Map<string, EntityKind>()

  register(type: string, kind: EntityKind) {
    this.kinds.set(type, kind)
  }

  has(type: string) {
    return this.kinds.has(type)
  }

  async summarize(refs: { type: string; id: string }[], actor: Actor): Promise<Map<string, EntitySummary>> {
    const byType = new Map<string, string[]>()
    for (const r of refs) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id])
    const out = new Map<string, EntitySummary>()
    for (const [type, ids] of byType) {
      const kind = this.kinds.get(type)
      if (!kind) continue
      for (const s of await kind.summarize([...new Set(ids)], actor)) out.set(`${type}:${s.id}`, s)
    }
    return out
  }

  async canView(type: string, id: string, actor: Actor) {
    const kind = this.kinds.get(type)
    return kind ? kind.canView(id, actor) : false
  }
}
