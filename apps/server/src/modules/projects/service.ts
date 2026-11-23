import type { CreateProjectInput, Project, UpdateProjectInput } from '@greenlit/shared'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { forbidden, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { projects } from './schema.ts'

type Row = typeof projects.$inferSelect

declare module '../../core/hooks.ts' {
  interface Hooks {
    /** Other modules add fields to project summaries (counts, cover, places...). */
    'projects.decorate': { args: { ids: string[]; actor: Actor }; result: Record<string, Partial<Project>> }
    /** Share-link sessions: may this session see the project? */
    'share.allowsProject': { args: { actor: Actor; projectId: string }; result: boolean | undefined }
  }
}
declare module '../../core/events.ts' {
  interface Events {
    'project.updated': { id: string }
    'project.deleted': { id: string }
  }
}

export class ProjectsService {
  readonly ctx: ModuleContext
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }

  /** SQL condition: projects this actor may see. */
  visibleWhere(actor: Actor) {
    if (isAdmin(actor)) return isNull(projects.deletedAt)
    const uid = actorUserId(actor)!
    return and(isNull(projects.deletedAt), sql`not (${uid}::uuid = any(${projects.hiddenFrom}))`)
  }

  async canView(id: string, actor: Actor) {
    const [row] = await this.ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), this.visibleWhere(actor)))
    if (!row) return false
    if (actor.kind === 'user' && actor.share) {
      return (await this.ctx.hooks.run('share.allowsProject', { actor, projectId: id })).some(
        (x) => x === true,
      )
    }
    return true
  }

  async hiddenProjectIdsFor(userId: string): Promise<string[]> {
    const rows = await this.ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(sql`${userId}::uuid = any(${projects.hiddenFrom})`)
    return rows.map((r) => r.id)
  }

  private async decorate(rows: Row[], actor: Actor): Promise<Project[]> {
    const ids = rows.map((r) => r.id)
    const refs = await this.ctx.services.users.refs(rows.map((r) => r.createdBy))
    const extras = ids.length ? await this.ctx.hooks.run('projects.decorate', { ids, actor }) : []
    return rows.map((r) => {
      const base: Project = {
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color,
        coverUrl: null,
        places: [],
        mediaCount: 0,
        compositionCount: 0,
        sizeBytes: 0,
        createdBy: r.createdBy ? (refs.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
        ...(isAdmin(actor) ? { hiddenFrom: r.hiddenFrom } : {}),
      }
      for (const e of extras) Object.assign(base, e[r.id] ?? {})
      return base
    })
  }

  async list(actor: Actor, opts: { q?: string; archived?: boolean } = {}): Promise<Project[]> {
    const where = [this.visibleWhere(actor)]
    if (opts.q) where.push(ilike(projects.name, `%${opts.q.replace(/[%_]/g, '\\$&')}%`))
    if (!opts.archived) where.push(isNull(projects.archivedAt))
    let rows = await this.ctx.db
      .select()
      .from(projects)
      .where(and(...where))
      .orderBy(desc(projects.updatedAt))
    if (actor.kind === 'user' && actor.share) {
      const allowed = await Promise.all(rows.map((r) => this.canView(r.id, actor)))
      rows = rows.filter((_, i) => allowed[i])
    }
    return this.decorate(rows, actor)
  }

  async row(id: string): Promise<Row> {
    const [row] = await this.ctx.db.select().from(projects).where(eq(projects.id, id))
    if (!row || row.deletedAt) throw notFound('Project not found')
    return row
  }

  async get(id: string, actor: Actor): Promise<Project> {
    if (!(await this.canView(id, actor))) throw notFound('Project not found')
    const [p] = await this.decorate([await this.row(id)], actor)
    return p!
  }

  async many(ids: string[], actor: Actor): Promise<Project[]> {
    if (!ids.length) return []
    const rows = await this.ctx.db
      .select()
      .from(projects)
      .where(and(inArray(projects.id, ids), this.visibleWhere(actor)))
    return this.decorate(rows, actor)
  }

  async create(input: CreateProjectInput, actor: Actor): Promise<Project> {
    const [row] = await this.ctx.db
      .insert(projects)
      .values({
        name: input.name.trim(),
        description: input.description,
        color: input.color,
        createdBy: actorUserId(actor),
      })
      .returning()
    await this.ctx.versions.record('project', row!.id, actor)
    this.ctx.events.emit('project.updated', { id: row!.id })
    return this.get(row!.id, actor)
  }

  async update(id: string, input: UpdateProjectInput, actor: Actor): Promise<Project> {
    await this.row(id)
    if (input.hiddenFrom && !isAdmin(actor)) throw forbidden()
    const patch: Partial<Row> = { updatedAt: new Date() }
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.description !== undefined) patch.description = input.description
    if (input.color !== undefined) patch.color = input.color
    if (input.coverMediaId !== undefined) patch.coverMediaId = input.coverMediaId
    if (input.hiddenFrom !== undefined) patch.hiddenFrom = input.hiddenFrom
    if (input.archived !== undefined) patch.archivedAt = input.archived ? new Date() : null
    await this.ctx.db.update(projects).set(patch).where(eq(projects.id, id))
    await this.ctx.versions.record('project', id, actor)
    this.ctx.events.emit('project.updated', { id })
    this.ctx.realtime.publish(`project:${id}`, 'project.updated', { id })
    return this.get(id, actor)
  }

  async remove(id: string, actor: Actor) {
    await this.row(id)
    await this.ctx.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id))
    await this.ctx.versions.record('project', id, actor, { force: true })
    this.ctx.events.emit('project.deleted', { id })
  }

  async touch(id: string | null | undefined) {
    if (id) await this.ctx.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id))
  }
}
