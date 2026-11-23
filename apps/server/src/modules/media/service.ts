import {
  FORMAT_PRESETS,
  type Media,
  type MediaFormat,
  type MediaKind,
  type MediaListQuery,
  type MediaStatus,
  mediaKindFromMime,
  normalizeTag,
  parseQuery,
  tagKey,
  type UpdateMediaInput,
} from '@greenlit/shared'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, type SQL, sql } from 'drizzle-orm'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { badRequest, forbidden, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import type { BlobRow } from '../files/service.ts'
import { projects } from '../projects/schema.ts'
import { media, mediaFiles, mediaFormats } from './schema.ts'

type MediaRow = typeof media.$inferSelect
type FormatRow = typeof mediaFormats.$inferSelect

declare module '../../core/hooks.ts' {
  interface Hooks {
    /** Other modules add fields to media (places, comment counts, link counts...). */
    'media.decorate': { args: { ids: string[]; actor: Actor }; result: Record<string, Partial<Media>> }
    /** Share-link sessions: may this session see the media item? */
    'share.allowsMedia': {
      args: { actor: Actor; mediaId: string; projectId: string | null }
      result: boolean | undefined
    }
    /** Extra search conditions from other modules (e.g. place:Ostuni). Return media ids or undefined. */
    'media.searchFilter': {
      args: { key: string; values: string[]; actor: Actor }
      result: string[] | undefined
    }
  }
}
declare module '../../core/events.ts' {
  interface Events {
    'media.created': { id: string; projectId: string | null }
    'media.updated': { id: string; projectId: string | null }
    'media.deleted': { id: string; projectId: string | null }
    'media.processed': { id: string; formatId: string }
    'media.located': { id: string; lat: number; lng: number; source: 'exif' }
    /** Version `promoted` became the main one (key ''); the old main one is now `demoted`. */
    'media.mainVersionChanged': { id: string; promoted: string; demoted: string }
  }
}

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')

export class MediaService {
  readonly ctx: ModuleContext
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }
  private get db() {
    return this.ctx.db
  }
  private get files() {
    return this.ctx.services.files
  }

  // ── visibility ──────────────────────────────────────────────────────────

  async visibleWhere(actor: Actor, opts: { trash?: boolean } = {}): Promise<SQL> {
    const base = opts.trash ? isNotNull(media.deletedAt) : isNull(media.deletedAt)
    if (isAdmin(actor)) return base
    const uid = actorUserId(actor)!
    const hiddenProjects = await this.ctx.services.projects.hiddenProjectIdsFor(uid)
    return and(
      isNull(media.deletedAt),
      sql`not (${uid}::uuid = any(${media.hiddenFrom}))`,
      hiddenProjects.length
        ? sql`(${media.projectId} is null or ${media.projectId} not in (${sql.join(
            hiddenProjects.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))`
        : undefined,
    )!
  }

  async canView(id: string, actor: Actor): Promise<boolean> {
    const [row] = await this.db
      .select({ id: media.id, projectId: media.projectId })
      .from(media)
      .where(and(eq(media.id, id), await this.visibleWhere(actor)))
    if (!row) return false
    if (actor.kind === 'user' && actor.share) {
      return (
        await this.ctx.hooks.run('share.allowsMedia', { actor, mediaId: id, projectId: row.projectId })
      ).some((x) => x === true)
    }
    return true
  }

  // ── views ───────────────────────────────────────────────────────────────

  formatView(f: FormatRow, storage: BlobRow['state'] = 'hot'): MediaFormat {
    const base = `/api/files/${f.blobId}`
    const d = (name: string) => (f.derived.includes(name) ? `${base}/d/${name}?v=${f.fileRevision}` : null)
    return {
      id: f.id,
      mediaId: f.mediaId,
      key: f.key,
      label: f.label,
      isPrimary: f.isPrimary,
      version: f.version,
      kind: f.kind as MediaKind,
      mime: f.mime,
      filename: f.filename,
      size: f.size,
      width: f.width,
      height: f.height,
      duration: f.duration,
      fps: f.fps,
      hasAudio: f.hasAudio,
      fileRevision: f.fileRevision,
      processing: {
        state: f.processingState as MediaFormat['processing']['state'],
        progress: f.processingProgress,
        error: f.processingError,
      },
      urls: {
        original: base,
        download: `${base}?download=1&name=${encodeURIComponent(f.filename)}`,
        thumbnail: d('thumb.webp'),
        poster: d('poster.webp'),
        preview: d('preview.mp4') ?? d('preview.m4a'),
        sprite: d('sprite.jpg'),
        waveform: d('waveform.json'),
      },
      storage: storage as MediaFormat['storage'],
      createdAt: f.createdAt.toISOString(),
    }
  }

  async views(rows: MediaRow[], actor: Actor): Promise<Media[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const formats = await this.db
      .select()
      .from(mediaFormats)
      .where(inArray(mediaFormats.mediaId, ids))
      .orderBy(desc(mediaFormats.isPrimary), asc(mediaFormats.position), asc(mediaFormats.createdAt))
    const blobs = await this.files.many(formats.map((f) => f.blobId))
    // media id → version key → formats; media id → audio tracks
    const byMedia = new Map<string, Map<string, MediaFormat[]>>()
    const tracks = new Map<string, MediaFormat[]>()
    for (const f of formats) {
      const view = this.formatView(f, blobs.get(f.blobId)?.state ?? 'hot')
      if (f.role === 'audio') {
        tracks.set(f.mediaId, [...(tracks.get(f.mediaId) ?? []), view])
        continue
      }
      const versions = byMedia.get(f.mediaId) ?? new Map<string, MediaFormat[]>()
      versions.set(f.version, [...(versions.get(f.version) ?? []), view])
      byMedia.set(f.mediaId, versions)
    }
    const refs = await this.ctx.services.users.refs(rows.map((r) => r.createdBy))
    const extras = await this.ctx.hooks.run('media.decorate', { ids, actor })
    return rows.map((r) => {
      const versionFormats = byMedia.get(r.id) ?? new Map<string, MediaFormat[]>()
      const fs = versionFormats.get('') ?? []
      const primary = fs.find((f) => f.isPrimary) ?? fs[0]
      const versions =
        r.versions.length > 1
          ? r.versions.map((v) => ({ key: v.key, label: v.label, formats: versionFormats.get(v.key) ?? [] }))
          : []
      const m: Media = {
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        description: r.description,
        kind: r.kind as MediaKind,
        status: r.status as MediaStatus,
        origin: r.origin as Media['origin'],
        tags: r.tags,
        formats: fs,
        versions,
        audioTracks: tracks.get(r.id) ?? [],
        thumbnailUrl: primary?.urls.thumbnail ?? null,
        places: [],
        commentCount: 0,
        openCommentCount: 0,
        linkCount: 0,
        takenAt: r.takenAt?.toISOString() ?? null,
        createdBy: r.createdBy ? (refs.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        deletedAt: r.deletedAt?.toISOString() ?? null,
        ...(isAdmin(actor) ? { hiddenFrom: r.hiddenFrom } : {}),
      }
      for (const e of extras) Object.assign(m, e[r.id] ?? {})
      return m
    })
  }

  async row(id: string): Promise<MediaRow> {
    const [row] = await this.db.select().from(media).where(eq(media.id, id))
    if (!row) throw notFound('Media not found')
    return row
  }

  async get(id: string, actor: Actor): Promise<Media> {
    if (!(await this.canView(id, actor))) {
      // Admins may open trashed items; everyone else gets a plain not-found.
      if (!(isAdmin(actor) && (await this.row(id)).deletedAt)) throw notFound('Media not found')
    }
    const [view] = await this.views([await this.row(id)], actor)
    return view!
  }

  async many(ids: string[], actor: Actor): Promise<Media[]> {
    if (!ids.length) return []
    const rows = await this.db
      .select()
      .from(media)
      .where(and(inArray(media.id, ids), await this.visibleWhere(actor)))
    const views = await this.views(rows, actor)
    const order = new Map(ids.map((id, i) => [id, i]))
    return views.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  async list(actor: Actor, q: MediaListQuery) {
    const where: (SQL | undefined)[] = [await this.visibleWhere(actor, { trash: q.trash })]
    if (q.projectId === 'none') where.push(isNull(media.projectId))
    else if (q.projectId) where.push(eq(media.projectId, q.projectId))
    if (q.kind) where.push(eq(media.kind, q.kind))
    if (q.status) where.push(eq(media.status, q.status))
    if (q.tag)
      where.push(sql`exists (select 1 from unnest(${media.tags}) t where lower(t) = ${tagKey(q.tag)})`)
    if (q.q) {
      const parsed = parseQuery(q.q)
      for (const w of parsed.text) where.push(sql`${media.searchText} like ${`%${escapeLike(fold(w))}%`}`)
      for (const w of parsed.exclude)
        where.push(sql`${media.searchText} not like ${`%${escapeLike(fold(w))}%`}`)
      for (const t of parsed.tags)
        where.push(sql`exists (select 1 from unnest(${media.tags}) t where lower(t) = ${tagKey(t)})`)
      for (const [key, values] of Object.entries(parsed.filters)) {
        if (key === 'kind' || key === 'type') where.push(inArray(media.kind, values))
        else if (key === 'status') where.push(inArray(media.status, values))
        else if (key === 'project') {
          where.push(
            sql`${media.projectId} in (select id from ${projects} where ${sql.join(
              values.map((v) => sql`lower(${projects.name}) like ${`%${escapeLike(v.toLowerCase())}%`}`),
              sql` or `,
            )})`,
          )
        } else {
          const ids = (await this.ctx.hooks.run('media.searchFilter', { key, values, actor })).find(
            (x) => x !== undefined,
          )
          if (ids) where.push(ids.length ? inArray(media.id, ids) : sql`false`)
        }
      }
    }
    const order = {
      recent: [desc(media.createdAt), desc(media.id)],
      oldest: [asc(media.createdAt), asc(media.id)],
      title: [asc(sql`lower(${media.title})`), asc(media.id)],
      taken: [desc(sql`coalesce(${media.takenAt}, ${media.createdAt})`), desc(media.id)],
      size: [
        desc(
          sql`(select coalesce(sum(size),0) from ${mediaFormats} where ${mediaFormats.mediaId} = ${media.id})`,
        ),
        desc(media.id),
      ],
    }[q.sort]
    const offset = q.cursor ? Number(q.cursor) || 0 : 0
    const cond = and(...where)
    const rows = await this.db
      .select()
      .from(media)
      .where(cond)
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset)
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(media).where(cond)
    const page = rows.slice(0, q.limit)
    return {
      items: await this.views(page, actor),
      nextCursor: rows.length > q.limit ? String(offset + q.limit) : null,
      total: n,
    }
  }

  // ── writes ──────────────────────────────────────────────────────────────

  private searchTextFor(r: { title: string; description: string; tags: string[] }) {
    return fold([r.title, r.description, ...r.tags].join(' • '))
  }

  async createFromBlob(
    blob: BlobRow,
    opts: {
      projectId: string | null
      title?: string
      formatKey?: string
      status?: MediaStatus
      origin?: Media['origin']
      tags?: string[]
    },
    actor: Actor,
  ): Promise<string> {
    const kind = mediaKindFromMime(blob.mime)
    const title =
      opts.title ??
      blob.filename
        .replace(/\.[a-z0-9]{1,6}$/i, '')
        .replace(/[_]+/g, ' ')
        .trim()
    const tags = cleanTags(opts.tags ?? [])
    const id = await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(media)
        .values({
          projectId: opts.projectId,
          title,
          kind,
          tags,
          status: opts.status ?? 'draft',
          origin: opts.origin ?? 'upload',
          createdBy: actorUserId(actor),
          searchText: this.searchTextFor({ title, description: '', tags }),
        })
        .returning()
      const key = opts.formatKey ?? 'main'
      const [f] = await tx
        .insert(mediaFormats)
        .values({
          mediaId: m!.id,
          key,
          label: FORMAT_PRESETS.find((p) => p.key === key)?.label ?? key,
          isPrimary: true,
          blobId: blob.id,
          kind,
          mime: blob.mime,
          filename: blob.filename,
          size: blob.size,
        })
        .returning()
      await tx.insert(mediaFiles).values({
        mediaId: m!.id,
        formatId: f!.id,
        blobId: blob.id,
        fileRevision: 1,
        filename: blob.filename,
        size: blob.size,
        createdBy: actorUserId(actor),
      })
      return m!.id
    })
    await this.ctx.services.projects.touch(opts.projectId)
    await this.ctx.versions.record('media', id, actor, { force: true })
    await this.enqueueProcessing(id)
    this.ctx.events.emit('media.created', { id, projectId: opts.projectId })
    this.publish(id, opts.projectId, 'media.created')
    return id
  }

  /**
   * Adds a new format (vertical, square...) or, if the key exists, a new file version of it. With `version`, the
   * format belongs to that version of the item (created with `versionLabel` when new); with `audio`, the file is
   * one of the item's audio tracks instead.
   */
  async attachFile(
    mediaId: string,
    blob: BlobRow,
    opts: {
      formatKey: string
      label?: string
      note?: string
      version?: string
      versionLabel?: string
      mainVersionLabel?: string
      audio?: boolean
    },
    actor: Actor,
  ) {
    const m = await this.row(mediaId)
    const kind = mediaKindFromMime(blob.mime)
    const role = opts.audio ? 'audio' : 'format'
    const version = opts.audio ? '' : (opts.version ?? '')
    if (role === 'audio' && kind !== 'audio' && kind !== 'video')
      throw badRequest('An audio track must be a sound file (or a video whose sound is used)')
    if (version && !m.versions.some((v) => v.key === version)) {
      if (!opts.versionLabel?.trim()) throw badRequest('Name the new version')
      const versions = m.versions.length
        ? m.versions
        : [{ key: '', label: opts.mainVersionLabel?.trim() || 'Original' }]
      await this.db
        .update(media)
        .set({ versions: [...versions, { key: version, label: opts.versionLabel.trim().slice(0, 60) }] })
        .where(eq(media.id, mediaId))
    }
    const [existing] = await this.db
      .select()
      .from(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, mediaId),
          eq(mediaFormats.role, role),
          eq(mediaFormats.version, version),
          eq(mediaFormats.key, opts.formatKey),
        ),
      )
    let formatId: string
    let revision = 1
    if (existing) {
      revision = existing.fileRevision + 1
      formatId = existing.id
      await this.db
        .update(mediaFormats)
        .set({
          blobId: blob.id,
          fileRevision: revision,
          kind,
          mime: blob.mime,
          filename: blob.filename,
          size: blob.size,
          width: null,
          height: null,
          duration: null,
          processingState: 'pending',
          processingProgress: 0,
          processingError: null,
          derived: [],
          updatedAt: new Date(),
        })
        .where(eq(mediaFormats.id, existing.id))
    } else {
      const [{ n } = { n: 0 }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(mediaFormats)
        .where(
          and(
            eq(mediaFormats.mediaId, mediaId),
            eq(mediaFormats.role, role),
            eq(mediaFormats.version, version),
          ),
        )
      const [f] = await this.db
        .insert(mediaFormats)
        .values({
          mediaId,
          role,
          version,
          key: opts.formatKey,
          label: opts.label ?? FORMAT_PRESETS.find((p) => p.key === opts.formatKey)?.label ?? opts.formatKey,
          isPrimary: n === 0,
          position: n,
          blobId: blob.id,
          kind,
          mime: blob.mime,
          filename: blob.filename,
          size: blob.size,
        })
        .returning()
      formatId = f!.id
    }
    await this.db.insert(mediaFiles).values({
      mediaId,
      formatId,
      blobId: blob.id,
      fileRevision: revision,
      filename: blob.filename,
      size: blob.size,
      note: opts.note ?? null,
      createdBy: actorUserId(actor),
    })
    await this.db.update(media).set({ updatedAt: new Date() }).where(eq(media.id, mediaId))
    await this.ctx.versions.record('media', mediaId, actor, {
      force: true,
      name: null,
      note: opts.note ?? null,
    })
    await this.enqueueProcessing(mediaId, formatId)
    this.ctx.events.emit('media.updated', { id: mediaId, projectId: m.projectId })
    this.publish(mediaId, m.projectId, 'media.updated')
    return formatId
  }

  async enqueueProcessing(mediaId: string, formatId?: string) {
    const formats = await this.db
      .select({ id: mediaFormats.id, filename: mediaFormats.filename })
      .from(mediaFormats)
      .where(formatId ? eq(mediaFormats.id, formatId) : eq(mediaFormats.mediaId, mediaId))
    for (const f of formats) {
      await this.ctx.jobs.send(
        'media.process',
        { formatId: f.id },
        {
          singletonKey: `process:${f.id}`,
          task: {
            kind: 'media.process',
            title: `Preparing ${f.filename}`,
            entityType: 'media',
            entityId: mediaId,
          },
        },
      )
    }
  }

  async update(id: string, input: UpdateMediaInput, actor: Actor): Promise<Media> {
    const current = await this.row(id)
    if (!(await this.canView(id, actor))) throw notFound('Media not found')
    if (input.hiddenFrom && !isAdmin(actor)) throw forbidden()
    const patch: Partial<MediaRow> = { updatedAt: new Date() }
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.description !== undefined) patch.description = input.description
    if (input.tags !== undefined) patch.tags = cleanTags(input.tags)
    if (input.status !== undefined) patch.status = input.status
    if (input.projectId !== undefined) patch.projectId = input.projectId
    if (input.takenAt !== undefined) patch.takenAt = input.takenAt ? new Date(input.takenAt) : null
    if (input.hiddenFrom !== undefined) patch.hiddenFrom = input.hiddenFrom
    patch.searchText = this.searchTextFor({
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      tags: patch.tags ?? current.tags,
    })
    await this.db.update(media).set(patch).where(eq(media.id, id))
    await this.ctx.versions.record('media', id, actor, { name: input.versionName })
    if (input.projectId !== undefined && input.projectId !== current.projectId) {
      await this.ctx.services.projects.touch(current.projectId)
      await this.ctx.services.projects.touch(input.projectId)
    }
    this.ctx.events.emit('media.updated', { id, projectId: patch.projectId ?? current.projectId })
    this.publish(id, patch.projectId ?? current.projectId, 'media.updated')
    if (current.projectId && input.projectId !== undefined && input.projectId !== current.projectId)
      this.publish(id, current.projectId, 'media.updated')
    return this.get(id, actor)
  }

  async setStatus(id: string, status: MediaStatus, actor: Actor) {
    const current = await this.row(id)
    if (current.status === status) return
    await this.db.update(media).set({ status, updatedAt: new Date() }).where(eq(media.id, id))
    await this.ctx.versions.record('media', id, actor)
    this.ctx.events.emit('media.updated', { id, projectId: current.projectId })
    this.publish(id, current.projectId, 'media.updated')
  }

  async updateFormat(
    formatId: string,
    patch: { key?: string; label?: string; isPrimary?: true },
    actor: Actor,
  ) {
    const [f] = await this.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
    if (!f) throw notFound('Format not found')
    if (patch.key && patch.key !== f.key) {
      const [clash] = await this.db
        .select({ id: mediaFormats.id })
        .from(mediaFormats)
        .where(
          and(
            eq(mediaFormats.mediaId, f.mediaId),
            eq(mediaFormats.role, f.role),
            eq(mediaFormats.version, f.version),
            eq(mediaFormats.key, patch.key),
            ne(mediaFormats.id, formatId),
          ),
        )
      if (clash) throw badRequest('This media already has a format with that name')
    }
    if (patch.isPrimary)
      await this.db
        .update(mediaFormats)
        .set({ isPrimary: false })
        .where(
          and(
            eq(mediaFormats.mediaId, f.mediaId),
            eq(mediaFormats.role, f.role),
            eq(mediaFormats.version, f.version),
          ),
        )
    await this.db
      .update(mediaFormats)
      .set({
        ...(patch.key ? { key: patch.key } : {}),
        ...(patch.label ? { label: patch.label } : {}),
        ...(patch.isPrimary ? { isPrimary: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(mediaFormats.id, formatId))
    await this.ctx.versions.record('media', f.mediaId, actor)
    const m = await this.row(f.mediaId)
    this.publish(f.mediaId, m.projectId, 'media.updated')
  }

  async removeFormat(formatId: string, actor: Actor) {
    const [f] = await this.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
    if (!f) throw notFound('Format not found')
    // Its siblings: the other formats of the same version (or the other audio tracks).
    const all = await this.db
      .select()
      .from(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, f.mediaId),
          eq(mediaFormats.role, f.role),
          eq(mediaFormats.version, f.version),
        ),
      )
      .orderBy(asc(mediaFormats.position))
    if (all.length === 1 && f.role === 'format' && !f.version)
      throw badRequest('A media item needs at least one format. Delete the media instead.')
    await this.db.delete(mediaFormats).where(eq(mediaFormats.id, formatId))
    const next = all.find((x) => x.id !== formatId)
    if (f.isPrimary && next)
      await this.db.update(mediaFormats).set({ isPrimary: true }).where(eq(mediaFormats.id, next.id))
    // The last format of another version: the version goes with it.
    if (!next && f.role === 'format' && f.version) await this.dropVersionEntry(f.mediaId, f.version)
    await this.ctx.versions.record('media', f.mediaId, actor, { force: true })
    const m = await this.row(f.mediaId)
    this.publish(f.mediaId, m.projectId, 'media.updated')
  }

  // ── versions ────────────────────────────────────────────────────────────

  /** Renames a version, or makes it the main one (its formats become the item's, the old main one a version). */
  async updateVersion(mediaId: string, key: string, patch: { label?: string; isMain?: true }, actor: Actor) {
    const m = await this.row(mediaId)
    const version = m.versions.find((v) => v.key === key)
    if (!version) throw notFound('Version not found')
    let versions = m.versions.map((v) => (v.key === key && patch.label ? { ...v, label: patch.label } : v))
    if (patch.isMain && key) {
      // The chosen version's formats become the main ones (''); the old main version gets a key of its own from
      // its name, so links and posts that chose a version keep pointing at the same files.
      const main = versions.find((v) => v.key === '')!
      const chosen = versions.find((v) => v.key === key)!
      const demoted = keyFor(
        main.label,
        versions.map((v) => v.key).filter((k) => k !== key),
        'original',
      )
      await this.db.execute(sql`
        update ${mediaFormats}
        set version = case when version = '' then ${demoted} else '' end, updated_at = now()
        where media_id = ${mediaId} and role = 'format' and version in ('', ${key})`)
      versions = [
        { key: '', label: chosen.label },
        ...versions.flatMap((v) =>
          v.key === '' ? [] : v.key === key ? [{ key: demoted, label: main.label }] : [v],
        ),
      ]
      this.ctx.events.emit('media.mainVersionChanged', { id: mediaId, promoted: key, demoted })
    }
    await this.db.update(media).set({ versions, updatedAt: new Date() }).where(eq(media.id, mediaId))
    await this.ctx.versions.record('media', mediaId, actor, { force: !!patch.isMain })
    if (patch.isMain) await this.enqueueThumbnailRefresh(mediaId)
    this.ctx.events.emit('media.updated', { id: mediaId, projectId: m.projectId })
    this.publish(mediaId, m.projectId, 'media.updated')
    return this.get(mediaId, actor)
  }

  /** Removes a version that is not the main one, with its formats. */
  async removeVersion(mediaId: string, key: string, actor: Actor) {
    const m = await this.row(mediaId)
    if (!key) throw badRequest('The main version cannot be removed: make another one main first')
    if (!m.versions.some((v) => v.key === key)) throw notFound('Version not found')
    await this.db
      .delete(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, mediaId),
          eq(mediaFormats.role, 'format'),
          eq(mediaFormats.version, key),
        ),
      )
    await this.dropVersionEntry(mediaId, key)
    await this.ctx.versions.record('media', mediaId, actor, { force: true })
    this.ctx.events.emit('media.updated', { id: mediaId, projectId: m.projectId })
    this.publish(mediaId, m.projectId, 'media.updated')
  }

  private async dropVersionEntry(mediaId: string, key: string) {
    const m = await this.row(mediaId)
    const rest = m.versions.filter((v) => v.key !== key)
    // A single version left is just the item again.
    await this.db
      .update(media)
      .set({ versions: rest.length > 1 ? rest : [], updatedAt: new Date() })
      .where(eq(media.id, mediaId))
  }

  /** The media kind follows the main format; after a version swap, tell the lists the thumbnail moved. */
  private async enqueueThumbnailRefresh(mediaId: string) {
    const [primary] = await this.formatsOf(mediaId)
    if (primary) await this.db.update(media).set({ kind: primary.kind }).where(eq(media.id, mediaId))
  }

  async trash(ids: string[], actor: Actor) {
    for (const id of ids) {
      const m = await this.row(id)
      if (m.deletedAt) continue
      await this.db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, id))
      await this.ctx.versions.record('media', id, actor, { force: true })
      this.ctx.events.emit('media.deleted', { id, projectId: m.projectId })
      this.publish(id, m.projectId, 'media.deleted')
    }
  }

  async untrash(ids: string[], actor: Actor) {
    for (const id of ids) {
      const m = await this.row(id)
      if (!m.deletedAt) continue
      await this.db.update(media).set({ deletedAt: null, updatedAt: new Date() }).where(eq(media.id, id))
      await this.ctx.versions.record('media', id, actor, { force: true })
      this.ctx.events.emit('media.updated', { id, projectId: m.projectId })
      this.publish(id, m.projectId, 'media.updated')
    }
  }

  /** Permanently deletes media rows. Their files are removed by the storage clean-up once nothing points at them. */
  async purge(ids: string[]) {
    for (const id of ids) {
      const m = await this.row(id)
      await this.db.delete(mediaFiles).where(eq(mediaFiles.mediaId, id))
      await this.db.delete(media).where(eq(media.id, id))
      this.ctx.events.emit('media.deleted', { id, projectId: m.projectId })
      this.publish(id, m.projectId, 'media.deleted')
    }
  }

  async fileHistory(mediaId: string) {
    const rows = await this.db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.mediaId, mediaId))
      .orderBy(desc(mediaFiles.createdAt))
    const refs = await this.ctx.services.users.refs(rows.map((r) => r.createdBy))
    return rows.map((r) => ({
      id: r.id,
      formatId: r.formatId,
      blobId: r.blobId,
      fileRevision: r.fileRevision,
      filename: r.filename,
      size: r.size,
      note: r.note,
      createdBy: r.createdBy ? (refs.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      url: `/api/files/${r.blobId}?download=1&name=${encodeURIComponent(r.filename)}`,
    }))
  }

  /** Make an older file the current file of its format again. */
  async restoreFile(fileId: string, actor: Actor) {
    const [file] = await this.db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId))
    if (!file) throw notFound('File version not found')
    const blob = await this.files.get(file.blobId)
    const [format] = await this.db.select().from(mediaFormats).where(eq(mediaFormats.id, file.formatId))
    if (!format) throw notFound('That format no longer exists')
    return this.attachFile(
      file.mediaId,
      blob,
      {
        formatKey: format.key,
        version: format.version,
        audio: format.role === 'audio',
        note: `Restored file version ${file.fileRevision}`,
      },
      actor,
    )
  }

  async mediaIdForBlob(blobId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ mediaId: mediaFiles.mediaId })
      .from(mediaFiles)
      .where(eq(mediaFiles.blobId, blobId))
      .limit(1)
    return row?.mediaId ?? null
  }

  async formatRow(formatId: string) {
    const [f] = await this.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
    if (!f) throw notFound('Format not found')
    return f
  }

  /**
   * The formats of the item's main version, main first. With `version`, that version's formats (the main version's
   * when the item has no such version); with `all`, every row including other versions and audio tracks.
   */
  async formatsOf(mediaId: string, opts: { version?: string | null; all?: boolean } = {}) {
    const rows = await this.db
      .select()
      .from(mediaFormats)
      .where(eq(mediaFormats.mediaId, mediaId))
      .orderBy(desc(mediaFormats.isPrimary), asc(mediaFormats.position))
    if (opts.all) return rows
    const wanted = opts.version ?? ''
    const own = rows.filter((f) => f.role === 'format' && f.version === wanted)
    return own.length || !wanted ? own : rows.filter((f) => f.role === 'format' && f.version === '')
  }

  /** The item's audio tracks, in order. */
  async audioTracksOf(mediaId: string) {
    return this.db
      .select()
      .from(mediaFormats)
      .where(and(eq(mediaFormats.mediaId, mediaId), eq(mediaFormats.role, 'audio')))
      .orderBy(asc(mediaFormats.position), asc(mediaFormats.createdAt))
  }

  publish(id: string, projectId: string | null, event: string) {
    this.ctx.realtime.publish(`media:${id}`, event, { id })
    this.ctx.realtime.publish('library', event, { id, projectId })
    if (projectId) this.ctx.realtime.publish(`project:${projectId}`, event, { id })
  }
}

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    const k = n.toLocaleLowerCase()
    if (!n || seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

/** A URL-safe key from a name (a version's label), never `main` nor one of `taken`. */
export function keyFor(name: string, taken: string[], fallback: string): string {
  const base =
    fold(name)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || fallback
  const used = new Set([...taken, 'main', ''])
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}-${i}`
  return key
}
