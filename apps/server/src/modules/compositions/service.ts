import {
  type Asset,
  applyOps,
  Composition,
  emptyComposition,
  FORMAT_SIZES,
  newId,
  type Op,
  OpError,
  type OutputFormat,
} from '@greenlit/composition'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { badRequest, conflict, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { keepVersionOps, versionKeyOf } from './assets.ts'
import { compositionOps, compositions } from './schema.ts'

type Row = typeof compositions.$inferSelect

export interface CompositionView {
  id: string
  projectId: string | null
  name: string
  revision: number
  document: Composition
  outputMediaId: string | null
  posterUrl: string | null
  createdBy: { id: string; displayName: string; avatarUrl: string | null } | null
  createdAt: string
  updatedAt: string
}

export type FormatPreset = keyof typeof FORMAT_SIZES

declare module '../../core/events.ts' {
  interface Events {
    'composition.changed': { id: string; revision: number }
  }
}

export class CompositionsService {
  readonly ctx: ModuleContext
  private linkTimers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }
  private get db() {
    return this.ctx.db
  }

  async canView(id: string, actor: Actor) {
    const [r] = await this.db
      .select({ projectId: compositions.projectId, deletedAt: compositions.deletedAt })
      .from(compositions)
      .where(eq(compositions.id, id))
    if (!r || r.deletedAt) return false
    if (isAdmin(actor)) return true
    if (!r.projectId) return false
    return this.ctx.services.projects.canView(r.projectId, actor)
  }

  async row(id: string): Promise<Row> {
    const [r] = await this.db.select().from(compositions).where(eq(compositions.id, id))
    if (!r || r.deletedAt) throw notFound('Editing project not found')
    return r
  }

  async view(r: Row): Promise<CompositionView> {
    const by = await this.ctx.services.users.ref(r.createdBy)
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      revision: r.revision,
      document: Composition.parse(r.document),
      outputMediaId: r.outputMediaId,
      posterUrl:
        r.posterRevision !== null ? `/api/compositions/${r.id}/poster.jpg?v=${r.posterRevision}` : null,
      createdBy: by,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  async get(id: string, actor: Actor) {
    if (!(await this.canView(id, actor))) throw notFound('Editing project not found')
    return this.view(await this.row(id))
  }

  async list(actor: Actor, projectId?: string) {
    const rows = await this.db
      .select()
      .from(compositions)
      .where(
        and(isNull(compositions.deletedAt), projectId ? eq(compositions.projectId, projectId) : undefined),
      )
      .orderBy(desc(compositions.updatedAt))
    const out: CompositionView[] = []
    for (const r of rows) if (await this.canView(r.id, actor)) out.push(await this.view(r))
    return out
  }

  async create(
    input: {
      projectId: string | null
      name: string
      formats?: (FormatPreset | OutputFormat)[]
      fps?: number
      duration?: number
      document?: unknown
    },
    actor: Actor,
  ) {
    let doc: Composition
    if (input.document) doc = Composition.parse(input.document)
    else {
      const formats = (input.formats?.length ? input.formats : ['landscape' as const]).map((f) =>
        typeof f === 'string' ? { ...FORMAT_SIZES[f] } : f,
      )
      doc = emptyComposition(formats, input.fps ?? 30, input.duration ?? 10)
    }
    const [r] = await this.db
      .insert(compositions)
      .values({
        projectId: input.projectId,
        name: input.name.trim() || 'Untitled edit',
        document: doc,
        createdBy: actorUserId(actor),
      })
      .returning()
    await this.ctx.versions.record('composition', r!.id, actor, { force: true })
    if (input.projectId)
      this.ctx.realtime.publish(`project:${input.projectId}`, 'composition.created', { id: r!.id })
    return this.view(r!)
  }

  async rename(id: string, name: string, actor: Actor) {
    const r = await this.row(id)
    await this.db
      .update(compositions)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(compositions.id, id))
    await this.ctx.versions.record('composition', id, actor)
    this.ctx.realtime.publish(`composition:${id}`, 'meta', { name })
    if (r.projectId) this.ctx.realtime.publish(`project:${r.projectId}`, 'composition.updated', { id })
    return this.view(await this.row(id))
  }

  async remove(id: string, actor: Actor) {
    const r = await this.row(id)
    await this.db.update(compositions).set({ deletedAt: new Date() }).where(eq(compositions.id, id))
    await this.ctx.versions.record('composition', id, actor, { force: true })
    if (r.projectId) this.ctx.realtime.publish(`project:${r.projectId}`, 'composition.deleted', { id })
  }

  async duplicate(id: string, actor: Actor) {
    const r = await this.row(id)
    return this.create({ projectId: r.projectId, name: `${r.name} copy`, document: r.document }, actor)
  }

  /**
   * Applies edits atomically (row lock), bumps the revision, logs them and broadcasts them to every open editor.
   * `baseRevision` is informational: ops are semantic, so concurrent edits from people and Claude merge.
   */
  async apply(id: string, ops: Op[], actor: Actor, opts: { clientId?: string; baseRevision?: number } = {}) {
    if (!ops.length) throw badRequest('No ops')
    const result = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(compositions).where(eq(compositions.id, id)).for('update')
      if (!r || r.deletedAt) throw notFound('Editing project not found')
      let next: Composition
      try {
        next = applyOps(Composition.parse(r.document), ops)
      } catch (err) {
        if (err instanceof OpError) throw badRequest(err.message)
        throw err
      }
      const revision = r.revision + 1
      await tx
        .update(compositions)
        .set({ document: next, revision, updatedAt: new Date() })
        .where(eq(compositions.id, id))
      await tx.insert(compositionOps).values({
        compositionId: id,
        revision,
        ops,
        authorId: actorUserId(actor),
        source: actor.source,
        clientId: opts.clientId ?? null,
      })
      return { revision, document: next, projectId: r.projectId }
    })
    const author = actor.kind === 'user' ? { id: actor.user.id, displayName: actor.user.displayName } : null
    this.ctx.realtime.publish(`composition:${id}`, 'ops', {
      revision: result.revision,
      ops,
      clientId: opts.clientId ?? null,
      author,
      source: actor.source,
    })
    if (result.projectId)
      this.ctx.realtime.publish(`project:${result.projectId}`, 'composition.updated', { id })
    this.ctx.events.emit('composition.changed', { id, revision: result.revision })
    void this.ctx.versions.record('composition', id, actor)
    this.scheduleLinkSync(id, result.document)
    return result
  }

  async opsSince(id: string, revision: number) {
    return this.db
      .select()
      .from(compositionOps)
      .where(and(eq(compositionOps.compositionId, id), gt(compositionOps.revision, revision)))
      .orderBy(compositionOps.revision)
  }

  /** Keeps "uses" links between the editing project and the media it uses. */
  private scheduleLinkSync(id: string, doc: Composition) {
    const links = this.ctx.services.links
    if (!links) return
    clearTimeout(this.linkTimers.get(id))
    this.linkTimers.set(
      id,
      setTimeout(() => {
        const used = new Set<string>()
        for (const t of doc.tracks)
          for (const c of t.clips)
            if (c.assetId && doc.assets[c.assetId]) used.add(doc.assets[c.assetId]!.mediaId)
        void links
          .syncAuto(
            { type: 'composition', id },
            'uses',
            [...used].map((m) => ({ type: 'media' as const, id: m })),
          )
          .catch(() => {})
      }, 1500),
    )
  }

  /**
   * An Asset entry for a media item, ready for an add_asset op: one of its versions (a key or a version's name;
   * absent, '' or `main` = the main version) and one of that version's formats (default: its main one).
   */
  async assetFor(
    input: { mediaId: string; formatKey?: string; version?: string },
    actor: Actor,
  ): Promise<Asset> {
    const m = await this.ctx.services.media.get(input.mediaId, actor)
    const version = versionKeyOf(m, input.version)
    if (version === null)
      throw badRequest(
        m.versions.length
          ? `That media item has no version "${input.version}". Its versions: ${m.versions
              .map((v) => (v.key ? `"${v.key}" (${v.label})` : `"" (${v.label}, the main one)`))
              .join(', ')}`
          : `That media item has no version "${input.version}": it has only its main version`,
      )
    const formats = version ? (m.versions.find((v) => v.key === version)?.formats ?? []) : m.formats
    const f = formats.find((x) => x.key === input.formatKey) ?? formats.find((x) => x.isPrimary) ?? formats[0]
    if (!f)
      throw badRequest(version ? 'That version of the media item has no file' : 'That media item has no file')
    const kind = f.kind === 'video' || f.kind === 'image' || f.kind === 'audio' ? f.kind : null
    if (!kind) throw badRequest('Only videos, pictures and audio can be used in an edit')
    return {
      id: newId('m'),
      mediaId: input.mediaId,
      ...(version ? { version } : {}),
      formatKey: f.key,
      kind,
      name: m.title,
      duration: f.duration,
      width: f.width,
      height: f.height,
      hasAudio: f.hasAudio,
    }
  }

  /**
   * A media item's main version changed: every editing project that uses the item keeps playing the same files
   * (see keepVersionOps). Recorded and sent to open editors like any edit.
   */
  async keepVersions(mediaId: string, promoted: string, demoted: string) {
    const rows = await this.db
      .select({ id: compositions.id, document: compositions.document })
      .from(compositions)
      .where(
        and(
          isNull(compositions.deletedAt),
          sql`jsonb_path_exists(${compositions.document}, '$.assets.* ? (@.mediaId == $id)', jsonb_build_object('id', ${mediaId}::text))`,
        ),
      )
    const system: Actor = { kind: 'system', source: 'system' }
    for (const r of rows) {
      const ops = keepVersionOps(Composition.parse(r.document), mediaId, promoted, demoted)
      if (ops.length) await this.apply(r.id, ops, system)
    }
  }

  async setOutputMedia(id: string, mediaId: string) {
    await this.db.update(compositions).set({ outputMediaId: mediaId }).where(eq(compositions.id, id))
  }

  async setPosterRevision(id: string, revision: number) {
    await this.db.update(compositions).set({ posterRevision: revision }).where(eq(compositions.id, id))
  }

  async countByProject(ids: string[]) {
    if (!ids.length) return {}
    const rows = await this.db
      .select({ projectId: compositions.projectId, n: sql<number>`count(*)::int` })
      .from(compositions)
      .where(
        and(
          isNull(compositions.deletedAt),
          sql`${compositions.projectId} in (${sql.join(
            ids.map((i) => sql`${i}::uuid`),
            sql`, `,
          )})`,
        ),
      )
      .groupBy(compositions.projectId)
    return Object.fromEntries(rows.map((r) => [r.projectId, r.n]))
  }

  ensureRevision(current: number, expected?: number) {
    if (expected !== undefined && expected > current) throw conflict('Unknown revision')
  }
}
