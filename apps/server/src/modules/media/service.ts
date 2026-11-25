import {
  type CreateSlidesInput,
  cleanWebLinks,
  type DepthMatch,
  type DepthMatchInput,
  type DepthNear,
  type DepthTarget,
  depthNameCandidates,
  depthNameKey,
  FORMAT_PRESETS,
  findVersion,
  keyFor,
  type Media,
  type MediaFormat,
  type MediaKind,
  type MediaListQuery,
  type MediaStatus,
  mediaKindFromMime,
  type NewVersionInput,
  normalizeTag,
  parseQuery,
  pruneVersionSet,
  readVersionSet,
  SLIDE_KINDS,
  SLIDES_MAX,
  slidesTitle,
  tagKey,
  type UpdateMediaInput,
  type VersionSet,
  versionName,
} from '@greenlit/shared'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, type SQL, sql } from 'drizzle-orm'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import type { BlobRow } from '../files/service.ts'
import { projects } from '../projects/schema.ts'
import { media, mediaFiles, mediaFormats, mediaSlides } from './schema.ts'
import { decorateSlides, notASlide, orItsPages, pageRows } from './slides.ts'

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
    /** `path`: where the file sat inside a folder or archive it was added with ("01 Logos/white.svg"). */
    'media.created': { id: string; projectId: string | null; path?: string }
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
    // A depth map's preview changes with its curve (see processDepthImage): new address, no stale cache.
    const rev = f.role === 'depth' && depthInfo(f).curve === 'log' ? `${f.fileRevision}l` : f.fileRevision
    const d = (name: string) => (f.derived.includes(name) ? `${base}/d/${name}?v=${rev}` : null)
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
      ...(f.role === 'depth' ? { depth: depthInfo(f) } : {}),
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
    // media id → version key → formats; media id → audio tracks; media id → depth maps
    const byMedia = new Map<string, Map<string, MediaFormat[]>>()
    const tracks = new Map<string, MediaFormat[]>()
    const depths = new Map<string, MediaFormat[]>()
    for (const f of formats) {
      const view = this.formatView(f, blobs.get(f.blobId)?.state ?? 'hot')
      if (f.role === 'audio' || f.role === 'depth') {
        const into = f.role === 'audio' ? tracks : depths
        into.set(f.mediaId, [...(into.get(f.mediaId) ?? []), view])
        continue
      }
      const versions = byMedia.get(f.mediaId) ?? new Map<string, MediaFormat[]>()
      versions.set(f.version, [...(versions.get(f.version) ?? []), view])
      byMedia.set(f.mediaId, versions)
    }
    const refs = await this.ctx.services.users.refs(rows.map((r) => r.createdBy))
    const extras = await this.ctx.hooks.run('media.decorate', { ids, actor })
    const out = rows.map((r) => {
      const versionFormats = byMedia.get(r.id) ?? new Map<string, MediaFormat[]>()
      const fs = versionFormats.get('') ?? []
      const primary = fs.find((f) => f.isPrimary) ?? fs[0]
      const set = readVersionSet(r.versions, r.versionGroups)
      const versions = set.versions.map((v) => ({
        key: v.key,
        label: versionName(set.groups, v.values),
        values: v.values,
        formats: versionFormats.get(v.key) ?? [],
      }))
      const m: Media = {
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        description: r.description,
        kind: r.kind as MediaKind,
        status: r.status as MediaStatus,
        origin: r.origin as Media['origin'],
        tags: r.tags,
        webLinks: r.webLinks ?? [],
        formats: fs,
        versions,
        versionGroups: set.groups,
        audioTracks: tracks.get(r.id) ?? [],
        depthMaps: depths.get(r.id) ?? [],
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
    await decorateSlides(this.ctx, out, actor, (pageIds, a) => this.many(pageIds, a))
    return out
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
    // Slides items stand for their pages (in the trash, a page trashed on its own shows so it can come back).
    if (!q.withSlides && !q.trash) where.push(notASlide)
    if (q.projectId === 'none') where.push(isNull(media.projectId))
    else if (q.projectId) where.push(eq(media.projectId, q.projectId))
    else if (q.projectKind && !/(^|\s)-?project:/i.test(q.q ?? '')) {
      const ofKind = sql`${media.projectId} in (select id from ${projects} where ${projects.kind} = ${q.projectKind})`
      where.push(q.projectKind === 'project' ? sql`(${media.projectId} is null or ${ofKind})` : ofKind)
    }
    if (q.kind) where.push(eq(media.kind, q.kind))
    if (q.status) where.push(eq(media.status, q.status))
    const hasTag = (tag: string) =>
      orItsPages((t) => sql`exists (select 1 from unnest(${t.tags}) t where lower(t) = ${tagKey(tag)})`)
    if (q.tag) where.push(hasTag(q.tag))
    if (q.q) {
      const parsed = parseQuery(q.q)
      for (const w of parsed.text)
        where.push(orItsPages((t) => sql`${t.searchText} like ${`%${escapeLike(fold(w))}%`}`))
      for (const w of parsed.exclude)
        where.push(sql`${media.searchText} not like ${`%${escapeLike(fold(w))}%`}`)
      for (const t of parsed.tags) where.push(hasTag(t))
      for (const [key, values] of Object.entries(parsed.filters)) {
        if (key === 'kind' || key === 'type') where.push(inArray(media.kind, values))
        else if (key === 'status') where.push(inArray(media.status, values))
        else if ((key === 'has' || key === 'no') && values.every((v) => HAS_FILTERS[v.toLowerCase()])) {
          for (const v of values) {
            const exists = HAS_FILTERS[v.toLowerCase()]!
            where.push(key === 'has' ? exists : sql`not ${exists}`)
          }
        } else if (key === 'project') {
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
      /** Its path inside the folder or archive it came with (passed on in `media.created`). */
      path?: string
    },
    actor: Actor,
  ): Promise<string> {
    const kind = mediaKindFromMime(blob.mime)
    const title =
      opts.title ??
      blob.filename
        .replace(/\.[a-z0-9]{1,8}$/i, '')
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
    this.ctx.events.emit('media.created', { id, projectId: opts.projectId, path: opts.path })
    this.publish(id, opts.projectId, 'media.created')
    return id
  }

  /**
   * Adds a new format (vertical, square...) or, if the key exists, a new file version of it. With `version`, the
   * format belongs to that version of the item; with `newVersion`, to a version made for it (see NewVersionInput);
   * with `audio`, the file is one of the item's audio tracks instead; with `depth`, the depth map of format
   * `formatKey` of `version` (a picture for a picture, a video for a video).
   */
  async attachFile(
    mediaId: string,
    blob: BlobRow,
    opts: {
      formatKey: string
      label?: string
      note?: string
      version?: string
      newVersion?: NewVersionInput
      audio?: boolean
      depth?: boolean
      /** Facts about the file kept on its row (a generated depth map says what made it). */
      meta?: Record<string, unknown>
    },
    actor: Actor,
  ) {
    const m = await this.row(mediaId)
    if (m.kind === 'slides')
      throw badRequest('A Slides item has no files of its own: add the file as a new page (slidesId) instead')
    const kind = mediaKindFromMime(blob.mime)
    const role = opts.audio ? 'audio' : opts.depth ? 'depth' : 'format'
    let version = opts.audio ? '' : (opts.version ?? '')
    if (role === 'audio' && kind !== 'audio' && kind !== 'video')
      throw badRequest('An audio track must be a sound file (or a video whose sound is used)')
    if (role === 'depth') {
      const [target] = await this.db
        .select({ kind: mediaFormats.kind })
        .from(mediaFormats)
        .where(
          and(
            eq(mediaFormats.mediaId, mediaId),
            eq(mediaFormats.role, 'format'),
            eq(mediaFormats.version, version),
            eq(mediaFormats.key, opts.formatKey),
          ),
        )
      if (!target) throw notFound('There is no such format to add a depth map to')
      if (target.kind !== 'image' && target.kind !== 'video')
        throw badRequest('Only pictures and videos have depth maps')
      if (kind !== target.kind)
        throw badRequest(
          target.kind === 'image'
            ? 'The depth map of a picture must be a picture (PNG, TIFF, EXR...)'
            : 'The depth map of a video must be a video of the same length',
        )
    }
    let newSet: VersionSet | null = null
    if (role === 'format' && opts.newVersion) {
      const planned = this.planVersion(m, opts.newVersion)
      version = planned.key
      newSet = planned.set
    } else if (
      version &&
      !readVersionSet(m.versions, m.versionGroups).versions.some((v) => v.key === version)
    )
      throw notFound('Version not found')
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
          ...(opts.meta ? { meta: { ...(existing.meta as Record<string, unknown>), ...opts.meta } } : {}),
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
          label:
            role === 'depth'
              ? 'Depth map'
              : (opts.label ?? FORMAT_PRESETS.find((p) => p.key === opts.formatKey)?.label ?? opts.formatKey),
          // A depth map is never the item's picture (covers, map pins and thumbnails take primary rows).
          isPrimary: role !== 'depth' && n === 0,
          position: n,
          blobId: blob.id,
          kind,
          mime: blob.mime,
          filename: blob.filename,
          size: blob.size,
          ...(opts.meta ? { meta: opts.meta } : {}),
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
    if (newSet) await this.saveVersionSet(mediaId, newSet)
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
    if (input.webLinks !== undefined) patch.webLinks = cleanWebLinks(input.webLinks)
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
    // A Slides item's pages go where it goes and take its status.
    if (current.kind === 'slides' && (input.status !== undefined || input.projectId !== undefined)) {
      const pages = await this.pageIds(id)
      if (input.status !== undefined) for (const p of pages) await this.setStatus(p, input.status, actor)
      if (input.projectId !== undefined)
        await this.movePages(await this.rowsOf(pages), input.projectId, actor)
    }
    return this.get(id, actor)
  }

  /**
   * Renames tags on every item that carries them (`to` = the new name; several `from` = a merge), or removes them
   * (`to` null). Covers the whole library, trash and items hidden from people included, so a tag is gone or renamed
   * everywhere. With a new name, other spellings of that name are rewritten to it too ("Trullo" → "trullo").
   * Each changed item records a revision with `note`, given the tags that item lost (its own spellings of `from`).
   * Returns the ids of the items that changed.
   */
  async replaceTags(
    from: string[],
    to: string | null,
    actor: Actor,
    note?: (lost: string[]) => string,
  ): Promise<string[]> {
    const keys = new Set(from.map(tagKey).filter(Boolean))
    const target = to === null ? null : normalizeTag(to)
    if (target === '') throw badRequest('The new tag name is empty')
    const targetKey = target === null ? null : tagKey(target)
    const match = targetKey ? new Set([...keys, targetKey]) : keys
    if (!keys.size) return []
    const rows = await this.db
      .select({
        id: media.id,
        projectId: media.projectId,
        title: media.title,
        description: media.description,
        tags: media.tags,
      })
      .from(media)
      .where(
        sql`exists (select 1 from unnest(${media.tags}) t where lower(t) in (${sql.join(
          [...match].map((k) => sql`${k}`),
          sql`, `,
        )}))`,
      )
    const changed: { id: string; projectId: string | null; lost: string[] }[] = []
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        const next = cleanTags(
          r.tags.flatMap((t) => {
            const k = tagKey(t)
            if (!match.has(k)) return [t]
            return target === null ? [] : [target]
          }),
        )
        if (next.length === r.tags.length && next.every((t, i) => t === r.tags[i])) continue
        await tx
          .update(media)
          .set({ tags: next, searchText: this.searchTextFor({ ...r, tags: next }), updatedAt: new Date() })
          .where(eq(media.id, r.id))
        changed.push({ id: r.id, projectId: r.projectId, lost: r.tags.filter((t) => keys.has(tagKey(t))) })
      }
    })
    for (const { id, projectId, lost } of changed) {
      await this.ctx.versions.record('media', id, actor, { note: note?.(lost) ?? null, force: true })
      this.ctx.events.emit('media.updated', { id, projectId })
      this.ctx.realtime.publish(`media:${id}`, 'media.updated', { id })
    }
    // One library / project message for the whole change (one per item would refetch every open list N times).
    if (changed.length) {
      const ids = changed.map((c) => c.id)
      this.ctx.realtime.publish('library', 'media.updated', { ids })
      this.ctx.realtime.publish('library', 'tags.changed', {})
      for (const p of new Set(changed.map((c) => c.projectId)))
        if (p) this.ctx.realtime.publish(`project:${p}`, 'media.updated', { ids })
    }
    return changed.map((c) => c.id)
  }

  async setStatus(id: string, status: MediaStatus, actor: Actor) {
    const current = await this.row(id)
    if (current.status !== status) {
      await this.db.update(media).set({ status, updatedAt: new Date() }).where(eq(media.id, id))
      await this.ctx.versions.record('media', id, actor)
      this.ctx.events.emit('media.updated', { id, projectId: current.projectId })
      this.publish(id, current.projectId, 'media.updated')
    }
    // A Slides item is decided as a whole: its pages take its status.
    if (current.kind === 'slides')
      for (const p of await this.pageIds(id)) await this.setStatus(p, status, actor)
  }

  async updateFormat(
    formatId: string,
    patch: { key?: string; label?: string; isPrimary?: true; near?: DepthNear },
    actor: Actor,
  ) {
    const [f] = await this.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
    if (!f) throw notFound('Format not found')
    if (f.role === 'depth' && (patch.key || patch.label || patch.isPrimary))
      throw badRequest('A depth map follows its format: rename or move the format instead')
    if (patch.near && f.role !== 'depth') throw badRequest('Only depth maps have a near end')
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
        ...(patch.near ? { meta: { ...(f.meta as Record<string, unknown>), near: patch.near } } : {}),
        updatedAt: new Date(),
      })
      .where(eq(mediaFormats.id, formatId))
    // The format's depth map keeps describing it under its new key.
    if (patch.key && patch.key !== f.key && f.role === 'format')
      await this.db
        .update(mediaFormats)
        .set({ key: patch.key, updatedAt: new Date() })
        .where(
          and(
            eq(mediaFormats.mediaId, f.mediaId),
            eq(mediaFormats.role, 'depth'),
            eq(mediaFormats.version, f.version),
            eq(mediaFormats.key, f.key),
          ),
        )
    await this.ctx.versions.record('media', f.mediaId, actor)
    // A picture's preview spreads distances on a log scale, disparity evenly: read it again the other way.
    if (patch.near && f.kind === 'image' && depthInfo(f).near !== patch.near)
      await this.enqueueProcessing(f.mediaId, f.id)
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
    // Its depth map goes with it (the files stay in the item's file history).
    if (f.role === 'format')
      await this.db
        .delete(mediaFormats)
        .where(
          and(
            eq(mediaFormats.mediaId, f.mediaId),
            eq(mediaFormats.role, 'depth'),
            eq(mediaFormats.version, f.version),
            eq(mediaFormats.key, f.key),
          ),
        )
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

  /**
   * Where a new version's file goes: the version like `from` with another option in one group (a new group, a new
   * option, or a combination not uploaded yet). Returns its key and the item's versions with it.
   */
  private planVersion(m: MediaRow, spec: NewVersionInput): { key: string; set: VersionSet } {
    const set = readVersionSet(m.versions, m.versionGroups)
    if (!set.versions.length) set.versions = [{ key: '', values: {} }]
    const fromKey = !spec.from || spec.from === 'main' ? '' : spec.from
    const from = set.versions.find((v) => v.key === fromKey)
    if (!from) throw notFound('Version not found')
    let group = spec.group ? set.groups.find((g) => g.key === spec.group) : undefined
    if (spec.group && !group) throw notFound('Version group not found')
    if (!group) {
      // A new kind of difference: every version so far gets its first option ("With watermark").
      const currentLabel = spec.currentLabel || 'Original'
      const current = { key: keyFor(currentLabel, [], 'original'), label: currentLabel }
      group = {
        key: keyFor(
          spec.groupLabel || 'version',
          set.groups.map((g) => g.key),
          'group',
        ),
        label: spec.groupLabel ?? '',
        options: [current],
      }
      set.groups.push(group)
      for (const v of set.versions) v.values[group.key] = current.key
    }
    let option = spec.option ? group.options.find((o) => o.key === spec.option) : undefined
    if (spec.option && !option) throw notFound('Version option not found')
    if (!option) {
      if (!spec.optionLabel) throw badRequest('Name the new version')
      const label = spec.optionLabel
      option = group.options.find((o) => fold(o.label) === fold(label))
      if (!option) {
        option = {
          key: keyFor(
            label,
            group.options.map((o) => o.key),
            'option',
          ),
          label,
        }
        group.options.push(option)
      }
    }
    const values = { ...from.values, [group.key]: option.key }
    const existing = findVersion(set.versions, values)
    if (existing) {
      // Uploading into a combination that exists (the page was out of date): add the file to it.
      if (spec.option) return { key: existing.key, set }
      throw conflict(`${versionName(set.groups, values)} already exists`)
    }
    const key = keyFor(
      versionName(set.groups, values),
      set.versions.map((v) => v.key),
      'version',
    )
    set.versions.push({ key, values })
    return { key, set }
  }

  /** Stores the item's versions, tidied (see pruneVersionSet). */
  private async saveVersionSet(mediaId: string, set: VersionSet) {
    const next = pruneVersionSet(set)
    await this.db
      .update(media)
      .set({ versions: next.versions, versionGroups: next.groups, updatedAt: new Date() })
      .where(eq(media.id, mediaId))
  }

  private async versionsChanged(m: MediaRow, actor: Actor, force = true) {
    await this.ctx.versions.record('media', m.id, actor, { force })
    this.ctx.events.emit('media.updated', { id: m.id, projectId: m.projectId })
    this.publish(m.id, m.projectId, 'media.updated')
  }

  /**
   * Renames a version (while versions differ in one way only), or makes it the main one: its formats become the
   * item's, the old main one a version, and its options come first in their groups.
   */
  async updateVersion(mediaId: string, key: string, patch: { label?: string; isMain?: true }, actor: Actor) {
    const m = await this.row(mediaId)
    const set = readVersionSet(m.versions, m.versionGroups)
    const version = set.versions.find((v) => v.key === key)
    if (!version) throw notFound('Version not found')
    if (patch.label) {
      const [group, ...more] = set.groups
      if (!group || more.length)
        throw badRequest('These versions differ in more than one way: rename an option of a group instead')
      const option = group.options.find((o) => o.key === version.values[group.key])
      if (option) option.label = patch.label
    }
    if (patch.isMain && key) {
      // The old main version gets a key of its own from its name, so links and posts that chose a version keep
      // pointing at the same files.
      const main = set.versions.find((v) => v.key === '')!
      const demoted = keyFor(
        versionName(set.groups, main.values),
        set.versions.map((v) => v.key).filter((k) => k !== key),
        'original',
      )
      await this.db.execute(sql`
        update ${mediaFormats}
        set version = case when version = '' then ${demoted} else '' end, updated_at = now()
        where media_id = ${mediaId} and role in ('format', 'depth') and version in ('', ${key})`)
      main.key = demoted
      version.key = ''
      for (const g of set.groups) {
        const i = g.options.findIndex((o) => o.key === version.values[g.key])
        if (i > 0) g.options.unshift(...g.options.splice(i, 1))
      }
      this.ctx.events.emit('media.mainVersionChanged', { id: mediaId, promoted: key, demoted })
    }
    await this.saveVersionSet(mediaId, set)
    if (patch.isMain) await this.enqueueThumbnailRefresh(mediaId)
    await this.versionsChanged(m, actor, !!patch.isMain)
    return this.get(mediaId, actor)
  }

  /** Removes a version that is not the main one, with its formats. */
  async removeVersion(mediaId: string, key: string, actor: Actor) {
    const m = await this.row(mediaId)
    if (!key) throw badRequest('The main version cannot be removed: make another one main first')
    const set = readVersionSet(m.versions, m.versionGroups)
    if (!set.versions.some((v) => v.key === key)) throw notFound('Version not found')
    await this.deleteVersionFormats(mediaId, [key])
    set.versions = set.versions.filter((v) => v.key !== key)
    await this.saveVersionSet(mediaId, set)
    await this.versionsChanged(m, actor)
  }

  /** Renames a group ("Watermark"; '' = unnamed). */
  async renameVersionGroup(mediaId: string, groupKey: string, label: string, actor: Actor) {
    const m = await this.row(mediaId)
    const set = readVersionSet(m.versions, m.versionGroups)
    const group = set.groups.find((g) => g.key === groupKey)
    if (!group) throw notFound('Version group not found')
    group.label = label
    await this.saveVersionSet(mediaId, set)
    await this.versionsChanged(m, actor, false)
    return this.get(mediaId, actor)
  }

  /** Renames an option of a group ("Without watermark"): every version with it changes name. */
  async renameVersionOption(
    mediaId: string,
    groupKey: string,
    optionKey: string,
    label: string,
    actor: Actor,
  ) {
    if (!label) throw badRequest('Give it a name')
    const m = await this.row(mediaId)
    const set = readVersionSet(m.versions, m.versionGroups)
    const option = set.groups.find((g) => g.key === groupKey)?.options.find((o) => o.key === optionKey)
    if (!option) throw notFound('Version option not found')
    option.label = label
    await this.saveVersionSet(mediaId, set)
    await this.versionsChanged(m, actor, false)
    return this.get(mediaId, actor)
  }

  /** Removes an option of a group with every version that has it (not the main version's option). */
  async removeVersionOption(mediaId: string, groupKey: string, optionKey: string, actor: Actor) {
    const m = await this.row(mediaId)
    const set = readVersionSet(m.versions, m.versionGroups)
    const group = set.groups.find((g) => g.key === groupKey)
    if (!group?.options.some((o) => o.key === optionKey)) throw notFound('Version option not found')
    const gone = set.versions.filter((v) => v.values[groupKey] === optionKey).map((v) => v.key)
    if (gone.includes('')) throw badRequest('The main version has this option: make another one main first')
    await this.deleteVersionFormats(mediaId, gone)
    set.versions = set.versions.filter((v) => !gone.includes(v.key))
    await this.saveVersionSet(mediaId, set)
    await this.versionsChanged(m, actor)
    return this.get(mediaId, actor)
  }

  private async deleteVersionFormats(mediaId: string, keys: string[]) {
    if (!keys.length) return
    await this.db
      .delete(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, mediaId),
          inArray(mediaFormats.role, ['format', 'depth']),
          inArray(mediaFormats.version, keys),
        ),
      )
  }

  private async dropVersionEntry(mediaId: string, key: string) {
    const m = await this.row(mediaId)
    const set = readVersionSet(m.versions, m.versionGroups)
    set.versions = set.versions.filter((v) => v.key !== key)
    await this.saveVersionSet(mediaId, set)
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

  /**
   * Permanently deletes media rows. Their files are removed by the storage clean-up once nothing points at them.
   * A Slides item's pages go with it, unless another Slides item has them too.
   */
  async purge(ids: string[]) {
    const sets = ids.length
      ? (
          await this.db
            .select({ id: media.id })
            .from(media)
            .where(and(inArray(media.id, ids), eq(media.kind, 'slides')))
        ).map((r) => r.id)
      : []
    if (sets.length) {
      const pages = [...new Set((await pageRows(this.ctx, sets)).map((r) => r.mediaId))].filter(
        (id) => !ids.includes(id),
      )
      const elsewhere = pages.length
        ? new Set(
            (
              await this.db
                .select({ id: mediaSlides.mediaId })
                .from(mediaSlides)
                .where(and(inArray(mediaSlides.mediaId, pages), notInArray(mediaSlides.slidesId, sets)))
            ).map((r) => r.id),
          )
        : new Set<string>()
      ids = [...ids, ...pages.filter((id) => !elsewhere.has(id))]
    }
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
        depth: format.role === 'depth',
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

  /** The item's depth maps (each with the `version` and `key` of the format it describes). */
  async depthMapsOf(mediaId: string) {
    return this.db
      .select()
      .from(mediaFormats)
      .where(and(eq(mediaFormats.mediaId, mediaId), eq(mediaFormats.role, 'depth')))
  }

  /**
   * Which pictures and videos depth map files belong to, by file name: "IMG_0412_depth.png" → the format whose file
   * is IMG_0412.jpg (see depthNameCandidates). Only items the actor can see; in `projectId` when given.
   */
  async matchDepthMaps(input: DepthMatchInput, actor: Actor): Promise<DepthMatch[]> {
    const wanted = input.names.map((name) => ({ name, candidates: depthNameCandidates(name) }))
    const keys = [...new Set(wanted.flatMap((w) => w.candidates))]
    if (!keys.length) return wanted.map((w) => ({ name: w.name, targets: [] }))
    const stem = sql`lower(regexp_replace(${mediaFormats.filename}, '[.][^.]*$', ''))`
    const rows = await this.db
      .select({ format: mediaFormats, media })
      .from(mediaFormats)
      .innerJoin(media, eq(media.id, mediaFormats.mediaId))
      .where(
        and(
          await this.visibleWhere(actor),
          eq(mediaFormats.role, 'format'),
          inArray(mediaFormats.kind, ['image', 'video']),
          inArray(stem, keys),
          input.projectId === null
            ? isNull(media.projectId)
            : input.projectId
              ? eq(media.projectId, input.projectId)
              : undefined,
        ),
      )
      .orderBy(desc(media.createdAt), asc(mediaFormats.version), desc(mediaFormats.isPrimary))
      .limit(5000)
    const withDepth = rows.length
      ? await this.db
          .select({ mediaId: mediaFormats.mediaId, version: mediaFormats.version, key: mediaFormats.key })
          .from(mediaFormats)
          .where(
            and(
              eq(mediaFormats.role, 'depth'),
              inArray(mediaFormats.mediaId, [...new Set(rows.map((r) => r.media.id))]),
            ),
          )
      : []
    const has = new Set(withDepth.map((d) => `${d.mediaId}/${d.version}/${d.key}`))
    const items = [...new Map(rows.map((r) => [r.media.id, r.media])).values()]
    const views = new Map((await this.views(items, actor)).map((v) => [v.id, v]))
    const byKey = new Map<string, DepthTarget[]>()
    for (const { format: f, media: m } of rows) {
      const view = views.get(m.id)
      const target: DepthTarget = {
        mediaId: m.id,
        title: m.title,
        thumbnailUrl: view?.thumbnailUrl ?? null,
        formatKey: f.key,
        formatLabel: f.label,
        version: f.version,
        versionLabel: view?.versions.find((v) => v.key === f.version)?.label ?? '',
        kind: f.kind as 'image' | 'video',
        filename: f.filename,
        width: f.width,
        height: f.height,
        hasDepth: has.has(`${m.id}/${f.version}/${f.key}`),
      }
      const k = depthNameKey(f.filename)
      byKey.set(k, [...(byKey.get(k) ?? []), target])
    }
    return wanted.map((w) => {
      // The closest name wins: "IMG_0412_depth" before "IMG_0412" (a picture may be called that itself).
      for (const c of w.candidates) {
        const targets = byKey.get(c)
        if (targets?.length) return { name: w.name, targets }
      }
      return { name: w.name, targets: [] }
    })
  }

  // ── slides ──────────────────────────────────────────────────────────────

  /** A Slides item's pages in order: all of them, trashed ones and ones hidden from someone too. */
  async pageIds(slidesId: string): Promise<string[]> {
    return (await pageRows(this.ctx, [slidesId])).map((r) => r.mediaId)
  }

  /** Full views of a Slides item's pages the actor can see, in order. */
  async pages(slidesId: string, actor: Actor): Promise<Media[]> {
    await this.slidesRow(slidesId, actor)
    return this.many(await this.pageIds(slidesId), actor)
  }

  private async rowsOf(ids: string[]): Promise<MediaRow[]> {
    if (!ids.length) return []
    return this.db.select().from(media).where(inArray(media.id, ids))
  }

  private async slidesRow(id: string, actor: Actor): Promise<MediaRow> {
    const row = await this.row(id)
    if (row.kind !== 'slides' || !(await this.canView(id, actor))) throw notFound('Slides not found')
    return row
  }

  /** Pictures and videos that may be pages, in the order given (each once); anything else is refused. */
  private async pageCandidates(ids: string[], actor: Actor): Promise<MediaRow[]> {
    const unique = [...new Set(ids)]
    if (unique.length > SLIDES_MAX) throw badRequest(`Slides hold at most ${SLIDES_MAX} pages`)
    if (!unique.length) return []
    const rows = await this.db
      .select()
      .from(media)
      .where(and(inArray(media.id, unique), await this.visibleWhere(actor)))
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const id of unique) {
      const r = byId.get(id)
      if (!r) throw notFound(`Media ${id} not found`)
      if (!SLIDE_KINDS.includes(r.kind as MediaKind))
        throw badRequest(
          r.kind === 'slides'
            ? `"${r.title || 'Untitled'}" is a Slides item itself: add its pages instead`
            : `"${r.title || 'Untitled'}" is a ${r.kind} file: Slides hold pictures and videos`,
        )
    }
    return unique.map((id) => byId.get(id)!)
  }

  /** Pages follow their Slides item's project (a page left in another project would vanish from both lists). */
  private async movePages(pages: MediaRow[], projectId: string | null, actor: Actor) {
    const moving = pages.filter((p) => p.projectId !== projectId)
    for (const p of moving) {
      await this.db.update(media).set({ projectId, updatedAt: new Date() }).where(eq(media.id, p.id))
      await this.ctx.versions.record('media', p.id, actor)
      await this.ctx.services.projects.touch(p.projectId)
      this.ctx.events.emit('media.updated', { id: p.id, projectId })
    }
    if (moving.length) await this.ctx.services.projects.touch(projectId)
    this.publishMany(moving, projectId)
  }

  /** One list message for many items (one per item would refetch every open list as many times). */
  private publishMany(rows: Pick<MediaRow, 'id' | 'projectId'>[], alsoProject?: string | null) {
    if (!rows.length) return
    const ids = rows.map((r) => r.id)
    for (const id of ids) this.ctx.realtime.publish(`media:${id}`, 'media.updated', { id })
    this.ctx.realtime.publish('library', 'media.updated', { ids })
    for (const p of new Set([...rows.map((r) => r.projectId), alsoProject ?? null]))
      if (p) this.ctx.realtime.publish(`project:${p}`, 'media.updated', { ids })
  }

  /**
   * Groups pictures and videos as one Slides item (a carousel's pages), which the library then lists in their place.
   * Title: given, else what the pages' titles share. Project: given, else the first page's; pages move into it.
   * Status: the pages' when they all have the same one.
   */
  async createSlides(input: CreateSlidesInput, actor: Actor): Promise<Media> {
    const pages = await this.pageCandidates(input.mediaIds, actor)
    if (!pages.length) throw badRequest('Slides need at least one picture or video')
    const projectId = input.projectId !== undefined ? input.projectId : (pages[0]!.projectId ?? null)
    const title = input.title?.trim() || slidesTitle(pages.map((p) => p.title)) || 'Slides'
    const statuses = new Set(pages.map((p) => p.status))
    const takenAt =
      pages
        .map((p) => p.takenAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    const id = await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(media)
        .values({
          projectId,
          title,
          kind: 'slides',
          status: statuses.size === 1 ? pages[0]!.status : 'draft',
          origin: 'upload',
          takenAt,
          createdBy: actorUserId(actor),
          searchText: this.searchTextFor({ title, description: '', tags: [] }),
        })
        .returning({ id: media.id })
      await tx
        .insert(mediaSlides)
        .values(pages.map((p, position) => ({ slidesId: m!.id, mediaId: p.id, position })))
      return m!.id
    })
    await this.ctx.services.projects.touch(projectId)
    await this.ctx.versions.record('media', id, actor, { force: true })
    this.ctx.events.emit('media.created', { id, projectId })
    this.publish(id, projectId, 'media.created')
    await this.movePages(pages, projectId, actor)
    this.publishMany(pages)
    return this.get(id, actor)
  }

  /**
   * A Slides item's pages in their new order: missing ones leave it (back in the library unless another Slides item
   * has them), new ones join it and move into its project. Pages the actor can't see (trashed, hidden from them) stay,
   * after the others.
   */
  async setSlides(slidesId: string, mediaIds: string[], actor: Actor): Promise<Media> {
    const set = await this.slidesRow(slidesId, actor)
    const before = await this.pageIds(slidesId)
    const wanted = await this.pageCandidates(mediaIds, actor)
    const visible = before.length
      ? new Set(
          (
            await this.db
              .select({ id: media.id })
              .from(media)
              .where(and(inArray(media.id, before), await this.visibleWhere(actor)))
          ).map((r) => r.id),
        )
      : new Set<string>()
    const wantedIds = wanted.map((w) => w.id)
    const order = [...wantedIds, ...before.filter((id) => !visible.has(id) && !wantedIds.includes(id))]
    if (order.length > SLIDES_MAX) throw badRequest(`Slides hold at most ${SLIDES_MAX} pages`)
    if (order.length === before.length && order.every((id, i) => id === before[i]))
      return this.get(slidesId, actor)
    await this.db.transaction(async (tx) => {
      await tx.delete(mediaSlides).where(eq(mediaSlides.slidesId, slidesId))
      if (order.length)
        await tx
          .insert(mediaSlides)
          .values(order.map((mediaId, position) => ({ slidesId, mediaId, position })))
    })
    await this.db.update(media).set({ updatedAt: new Date() }).where(eq(media.id, slidesId))
    await this.ctx.versions.record('media', slidesId, actor)
    this.ctx.events.emit('media.updated', { id: slidesId, projectId: set.projectId })
    this.publish(slidesId, set.projectId, 'media.updated')
    await this.movePages(wanted, set.projectId, actor)
    const changed = [
      ...before.filter((id) => !order.includes(id)),
      ...order.filter((id) => !before.includes(id)),
    ]
    this.publishMany(await this.rowsOf(changed))
    return this.get(slidesId, actor)
  }

  /** Adds pages at the end of a Slides item, one statement each (uploads finishing at once don't drop any). */
  async addPages(slidesId: string, ids: string[], actor: Actor) {
    const set = await this.slidesRow(slidesId, actor)
    const pages = await this.pageCandidates(ids, actor)
    const count = (await this.pageIds(slidesId)).length
    if (count + pages.length > SLIDES_MAX) throw badRequest(`Slides hold at most ${SLIDES_MAX} pages`)
    for (const p of pages)
      await this.db.execute(sql`
        insert into ${mediaSlides} (slides_id, media_id, position)
        select ${slidesId}::uuid, ${p.id}::uuid, coalesce(max(position) + 1, 0)
        from ${mediaSlides} where slides_id = ${slidesId}::uuid
        on conflict do nothing`)
    await this.db.update(media).set({ updatedAt: new Date() }).where(eq(media.id, slidesId))
    await this.ctx.versions.record('media', slidesId, actor)
    this.ctx.events.emit('media.updated', { id: slidesId, projectId: set.projectId })
    this.publish(slidesId, set.projectId, 'media.updated')
    await this.movePages(pages, set.projectId, actor)
    this.publishMany(pages)
  }

  /** Takes a Slides item apart: its pages go back to the library, the Slides item is deleted. Returns the pages. */
  async ungroupSlides(slidesId: string, actor: Actor): Promise<string[]> {
    await this.slidesRow(slidesId, actor)
    const pages = await this.pageIds(slidesId)
    await this.db.delete(mediaSlides).where(eq(mediaSlides.slidesId, slidesId))
    await this.purge([slidesId])
    this.publishMany(await this.rowsOf(pages))
    return pages
  }

  /** Media ids with each Slides item replaced by its pages the actor can see, in order, each id once (posts). */
  async expandSlides(ids: string[], actor: Actor): Promise<string[]> {
    if (!ids.length) return ids
    const sets = (
      await this.db
        .select({ id: media.id })
        .from(media)
        .where(and(inArray(media.id, ids), eq(media.kind, 'slides')))
    ).map((r) => r.id)
    if (!sets.length) return ids
    const rows = await pageRows(this.ctx, sets)
    const pageIds = [...new Set(rows.map((r) => r.mediaId))]
    const visible = pageIds.length
      ? new Set(
          (
            await this.db
              .select({ id: media.id })
              .from(media)
              .where(and(inArray(media.id, pageIds), await this.visibleWhere(actor)))
          ).map((r) => r.id),
        )
      : new Set<string>()
    const out: string[] = []
    for (const id of ids) {
      const add = sets.includes(id)
        ? rows.filter((r) => r.slidesId === id && visible.has(r.mediaId)).map((r) => r.mediaId)
        : [id]
      for (const a of add) if (!out.includes(a)) out.push(a)
    }
    return out
  }

  publish(id: string, projectId: string | null, event: string) {
    this.ctx.realtime.publish(`media:${id}`, event, { id })
    this.ctx.realtime.publish('library', event, { id, projectId })
    if (projectId) this.ctx.realtime.publish(`project:${projectId}`, event, { id })
  }
}

/** `has:depth` / `no:depth` in a search. */
const HAS_FILTERS: Record<string, SQL> = {
  depth: sql`exists (select 1 from ${mediaFormats} where ${mediaFormats.mediaId} = ${media.id} and ${mediaFormats.role} = 'depth')`,
}

/**
 * What a depth map's row says about it (see DepthInfo). `near` is what the user chose, else processing's guess, else
 * light (disparity: most AI tools).
 */
function depthInfo(f: FormatRow): NonNullable<MediaFormat['depth']> {
  const meta = (f.meta ?? {}) as {
    near?: DepthNear
    nearGuess?: DepthNear
    bitDepth?: number
    float?: boolean
    range?: [number, number]
    curve?: 'linear' | 'log'
    generated?: { model?: unknown; fromRevision?: unknown; metric?: { near?: unknown; far?: unknown } | null }
  }
  const g = meta.generated
  return {
    near: (meta.near ?? meta.nearGuess) === 'dark' ? 'dark' : 'light',
    bitDepth: typeof meta.bitDepth === 'number' ? meta.bitDepth : null,
    float: !!meta.float,
    range: Array.isArray(meta.range) && meta.range.length === 2 ? meta.range : null,
    curve: meta.curve === 'log' ? 'log' : 'linear',
    generated:
      g && typeof g.model === 'string' && typeof g.fromRevision === 'number'
        ? {
            model: g.model,
            fromRevision: g.fromRevision,
            metric:
              g.metric && typeof g.metric.near === 'number' && typeof g.metric.far === 'number'
                ? { near: g.metric.near, far: g.metric.far }
                : null,
          }
        : null,
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
