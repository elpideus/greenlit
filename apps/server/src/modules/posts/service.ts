import type {
  MediaFormat,
  Post,
  PostMediaFormat,
  PostTarget,
  SavePostInput,
  TargetInput,
} from '@greenlit/shared'
import { TargetInput as TargetInputSchema } from '@greenlit/shared/areas/posts'
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { postMedia, posts, postTargets, projectPostDestinations } from './schema.ts'

type PostRow = typeof posts.$inferSelect
type TargetRow = typeof postTargets.$inferSelect

const REMOTE_STATES = new Set(['scheduled', 'published'])

declare module '../../core/events.ts' {
  interface Events {
    'post.changed': { id: string }
  }
}

export class PostsService {
  readonly ctx: ModuleContext
  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }
  private get db() {
    return this.ctx.db
  }

  async canView(id: string, actor: Actor) {
    const [r] = await this.db
      .select({ projectId: posts.projectId, deletedAt: posts.deletedAt })
      .from(posts)
      .where(eq(posts.id, id))
    if (!r || r.deletedAt) return false
    if (actor.kind === 'user' && actor.share) {
      const s = actor.share
      if (s.targetType === 'calendar') return true
      if (s.targetType === 'post') return s.targetId === id
      if (s.targetType === 'project') return r.projectId === s.targetId
      return false
    }
    if (isAdmin(actor) || !r.projectId) return true
    return this.ctx.services.projects.canView(r.projectId, actor)
  }

  async row(id: string) {
    const [r] = await this.db.select().from(posts).where(eq(posts.id, id))
    if (!r || r.deletedAt) throw notFound('Post not found')
    return r
  }

  async targetRow(id: string) {
    const [t] = await this.db.select().from(postTargets).where(eq(postTargets.id, id))
    if (!t) throw notFound('Post target not found')
    return t
  }

  targetView(t: TargetRow): PostTarget {
    return {
      id: t.id,
      accountId: t.accountId,
      viaAccountId: t.viaAccountId ?? null,
      platform: t.platform as PostTarget['platform'],
      placement: t.placement as PostTarget['placement'],
      enabled: t.enabled,
      title: t.title,
      caption: t.caption,
      hashtags: t.hashtags,
      tags: t.tags,
      firstComment: t.firstComment,
      location: (t.location as PostTarget['location']) ?? null,
      thumbnail: t.thumbnail as PostTarget['thumbnail'],
      translations: t.translations as PostTarget['translations'],
      music: (t.music as PostTarget['music']) ?? null,
      audio: t.audio as PostTarget['audio'],
      options: t.options as Record<string, unknown>,
      formats: t.formats as Record<string, string>,
      versions: t.versions as Record<string, string>,
      audioTracks: t.audioTracks as Record<string, string>,
      scheduleAt: t.scheduleAt?.toISOString() ?? null,
      state: t.state as PostTarget['state'],
      remoteId: t.remoteId,
      remoteUrl: t.remoteUrl,
      error: t.error,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      syncedAt: t.syncedAt?.toISOString() ?? null,
      stats: (t.stats as Record<string, number>) ?? null,
      notes: ((t.remoteSnapshot as { warnings?: string[] } | null)?.warnings ?? []).slice(0, 20),
    }
  }

  static statusOf(targets: PostTarget[], now = Date.now()): Post['status'] {
    const on = targets.filter((t) => t.enabled && t.state !== 'removed')
    // A version Greenlit holds for its time (one the platform does not schedule) counts as scheduled.
    const held = (t: PostTarget) =>
      t.state === 'queued' && !!t.scheduleAt && new Date(t.scheduleAt).getTime() > now + 60_000
    const scheduled = (t: PostTarget) => t.state === 'scheduled' || held(t)
    if (!on.length || on.every((t) => t.state === 'draft')) return 'draft'
    if (on.some((t) => t.state === 'failed'))
      return on.some((t) => REMOTE_STATES.has(t.state)) ? 'partial' : 'failed'
    if (on.some((t) => !held(t) && ['queued', 'preparing', 'uploading'].includes(t.state)))
      return 'publishing'
    if (on.every((t) => t.state === 'published')) return 'published'
    if (on.every((t) => REMOTE_STATES.has(t.state) || held(t)))
      return on.some(scheduled) ? 'scheduled' : 'published'
    return 'partial'
  }

  async views(rows: PostRow[], actor: Actor): Promise<Post[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const pm = await this.db
      .select()
      .from(postMedia)
      .where(inArray(postMedia.postId, ids))
      .orderBy(asc(postMedia.position))
    const targets = await this.db
      .select()
      .from(postTargets)
      .where(inArray(postTargets.postId, ids))
      .orderBy(asc(postTargets.createdAt))
    const media = new Map(
      (await this.ctx.services.media.many([...new Set(pm.map((m) => m.mediaId))], actor)).map((m) => [
        m.id,
        m,
      ]),
    )
    const refs = await this.ctx.services.users.refs(rows.map((r) => r.createdBy))
    return rows.map((r) => {
      const tv = targets.filter((t) => t.postId === r.id).map((t) => this.targetView(t))
      const dates = tv
        .map((t) => t.scheduleAt ?? t.publishedAt)
        .filter((d): d is string => !!d)
        .sort()
      return {
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        caption: r.caption,
        title: r.title,
        hashtags: r.hashtags,
        translations: r.translations as Post['translations'],
        media: pm
          .filter((m) => m.postId === r.id)
          .map((m) => media.get(m.mediaId))
          .filter((m): m is NonNullable<typeof m> => !!m)
          .map((m) => ({
            mediaId: m.id,
            title: m.title,
            kind: m.kind,
            thumbnailUrl: m.thumbnailUrl,
            formats: m.formats.map(postFormat),
            versions: m.versions.map((v) => ({
              key: v.key,
              label: v.label,
              formats: v.formats.map(postFormat),
            })),
            audioTracks: m.audioTracks.map((a) => ({
              key: a.key,
              label: a.label,
              duration: a.duration,
              previewUrl: a.urls.preview ?? a.urls.original,
            })),
          })),
        targets: tv,
        status: PostsService.statusOf(tv),
        origin: r.origin as Post['origin'],
        scheduleAt: dates[0] ?? null,
        createdBy: r.createdBy ? (refs.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }
    })
  }

  async get(id: string, actor: Actor) {
    if (!(await this.canView(id, actor))) throw notFound('Post not found')
    const [p] = await this.views([await this.row(id)], actor)
    return p!
  }

  async list(
    actor: Actor,
    opts: { projectId?: string; mediaId?: string; status?: string; limit?: number } = {},
  ) {
    const where = [isNull(posts.deletedAt)]
    if (opts.projectId) where.push(eq(posts.projectId, opts.projectId))
    if (opts.mediaId)
      where.push(sql`${posts.id} in (select post_id from ${postMedia} where media_id = ${opts.mediaId})`)
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(...where))
      .orderBy(desc(posts.updatedAt))
      .limit(opts.limit ?? 200)
    const visible: PostRow[] = []
    for (const r of rows) if (await this.canView(r.id, actor)) visible.push(r)
    const out = await this.views(visible, actor)
    return opts.status ? out.filter((p) => p.status === opts.status) : out
  }

  private async platformOf(accountId: string) {
    const a = await this.ctx.services.connectors?.account(accountId).catch(() => null)
    if (!a) throw badRequest('That account is not connected')
    return a.platform
  }

  async create(input: SavePostInput, actor: Actor) {
    // A new post in a project starts with where the project's posts last went.
    if (input.targets === undefined && input.projectId) {
      const last = await this.lastDestinations(input.projectId)
      if (last.length) input = { ...input, targets: last }
    }
    const [r] = await this.db
      .insert(posts)
      .values({
        projectId: input.projectId ?? null,
        name: input.name ?? '',
        caption: input.caption ?? '',
        title: input.title ?? '',
        hashtags: input.hashtags ?? [],
        translations: input.translations ?? {},
        createdBy: actorUserId(actor),
      })
      .returning()
    await this.writeChildren(r!.id, input, actor)
    await this.rememberDestinations(r!.projectId, input.targets)
    await this.ctx.versions.record('post', r!.id, actor, { force: true })
    this.publishChange(r!.id, r!.projectId)
    return this.get(r!.id, actor)
  }

  /** Saves a post. Changes to targets already on a platform are pushed there (or the schedule is moved). */
  async update(id: string, input: SavePostInput, actor: Actor) {
    const r = await this.row(id)
    const patch: Partial<PostRow> = { updatedAt: new Date() }
    if (input.projectId !== undefined) patch.projectId = input.projectId
    if (input.name !== undefined) patch.name = input.name
    if (input.caption !== undefined) patch.caption = input.caption
    if (input.title !== undefined) patch.title = input.title
    if (input.hashtags !== undefined) patch.hashtags = input.hashtags
    if (input.translations !== undefined) patch.translations = input.translations
    await this.db.update(posts).set(patch).where(eq(posts.id, id))
    const touched = await this.writeChildren(id, input, actor)
    await this.rememberDestinations(patch.projectId ?? r.projectId, input.targets)
    await this.ctx.versions.record('post', id, actor, { name: input.versionName })
    // Post-level text changes affect every target that follows it.
    const textChanged =
      input.caption !== undefined ||
      input.title !== undefined ||
      input.hashtags !== undefined ||
      input.translations !== undefined
    const targets = await this.db.select().from(postTargets).where(eq(postTargets.postId, id))
    for (const t of targets) {
      if (!t.remoteId || !REMOTE_STATES.has(t.state)) continue
      if (touched.has(t.id) || textChanged)
        await this.ctx.jobs.send('posts.update', { targetId: t.id }, { singletonKey: `update:${t.id}` })
    }
    this.publishChange(id, patch.projectId ?? r.projectId)
    return this.get(id, actor)
  }

  /** The accounts and placements a project's posts last went to, still connected. */
  async lastDestinations(
    projectId: string,
  ): Promise<{ accountId: string; placement: TargetInput['placement'] }[]> {
    const [row] = await this.db
      .select()
      .from(projectPostDestinations)
      .where(eq(projectPostDestinations.projectId, projectId))
    if (!row?.targets.length) return []
    const accounts = (await this.ctx.services.connectors?.accounts()) ?? []
    const out: { accountId: string; placement: TargetInput['placement'] }[] = []
    for (const t of row.targets) {
      // A destination saved before its account was merged into another goes to that one now.
      const was = accounts.find((a) => a.id === t.accountId)
      const a = was?.mergedInto ? accounts.find((x) => x.id === was.mergedInto) : was
      if (!a || a.state === 'disabled' || a.capabilities.publish === false) continue
      if (!a.capabilities.placements.includes(t.placement as never)) continue
      if (out.some((o) => o.accountId === a.id && o.placement === t.placement)) continue
      out.push({ accountId: a.id, placement: t.placement as TargetInput['placement'] })
    }
    return out
  }

  /** Remembers where a project's post goes now, as the start of the project's next post. */
  private async rememberDestinations(projectId: string | null, targets: SavePostInput['targets']) {
    if (!projectId || !targets?.length) return
    const chosen = targets
      .map((t) => TargetInputSchema.parse(t))
      .filter((t) => t.enabled)
      .map((t) => ({ accountId: t.accountId, placement: t.placement }))
    if (!chosen.length) return
    await this.db
      .insert(projectPostDestinations)
      .values({ projectId, targets: chosen })
      .onConflictDoUpdate({
        target: projectPostDestinations.projectId,
        set: { targets: chosen, updatedAt: new Date() },
      })
  }

  /** Returns the ids of targets whose content changed. */
  private async writeChildren(postId: string, input: SavePostInput, actor: Actor) {
    const touched = new Set<string>()
    if (input.media) {
      for (const m of input.media)
        if (!(await this.ctx.services.media.canView(m.mediaId, actor))) throw notFound('Media not found')
      await this.db.delete(postMedia).where(eq(postMedia.postId, postId))
      if (input.media.length)
        await this.db
          .insert(postMedia)
          .values(input.media.map((m, i) => ({ postId, mediaId: m.mediaId, position: i })))
      if (this.ctx.services.links) {
        await this.ctx.services.links.syncAuto(
          { type: 'post', id: postId },
          'uses',
          input.media.map((m) => ({ type: 'media' as const, id: m.mediaId })),
        )
      }
    }
    if (input.targets) {
      const existing = await this.db.select().from(postTargets).where(eq(postTargets.postId, postId))
      const keep = new Set<string>()
      for (const raw of input.targets) {
        const t = TargetInputSchema.parse(raw)
        const values = {
          accountId: t.accountId,
          placement: t.placement,
          enabled: t.enabled,
          title: t.title,
          caption: t.caption,
          hashtags: t.hashtags,
          tags: t.tags,
          firstComment: t.firstComment,
          location: t.location,
          thumbnail: t.thumbnail,
          translations: t.translations,
          music: t.music,
          audio: t.audio,
          options: t.options,
          formats: t.formats,
          versions: t.versions,
          audioTracks: t.audioTracks,
          scheduleAt: t.scheduleAt ? new Date(t.scheduleAt) : null,
          updatedAt: new Date(),
        }
        const prev = t.id ? existing.find((e) => e.id === t.id) : undefined
        if (prev) {
          keep.add(prev.id)
          const before = JSON.stringify({
            ...this.targetView(prev),
            state: 0,
            error: 0,
            syncedAt: 0,
            stats: 0,
            remoteId: 0,
            remoteUrl: 0,
            publishedAt: 0,
          })
          await this.db.update(postTargets).set(values).where(eq(postTargets.id, prev.id))
          const after = JSON.stringify({
            ...this.targetView((await this.targetRow(prev.id))!),
            state: 0,
            error: 0,
            syncedAt: 0,
            stats: 0,
            remoteId: 0,
            remoteUrl: 0,
            publishedAt: 0,
          })
          if (before !== after) touched.add(prev.id)
        } else {
          const platform = await this.platformOf(t.accountId)
          const [row] = await this.db
            .insert(postTargets)
            .values({ postId, platform, ...values })
            .returning()
          keep.add(row!.id)
        }
      }
      for (const e of existing) {
        if (keep.has(e.id)) continue
        // Targets already on a platform are never silently dropped: removing them is an explicit action.
        if (e.remoteId && REMOTE_STATES.has(e.state))
          await this.db.update(postTargets).set({ enabled: false }).where(eq(postTargets.id, e.id))
        else await this.db.delete(postTargets).where(eq(postTargets.id, e.id))
      }
    }
    return touched
  }

  async remove(id: string, actor: Actor) {
    const r = await this.row(id)
    const targets = await this.db.select().from(postTargets).where(eq(postTargets.postId, id))
    if (targets.some((t) => t.remoteId && REMOTE_STATES.has(t.state)))
      throw badRequest('Remove it from the platforms first (or keep it as a record)')
    // The last version is kept before the post goes (a deleted post can no longer be read).
    await this.ctx.versions.record('post', id, actor, { force: true })
    await this.db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))
    this.publishChange(id, r.projectId)
  }

  async setTargetState(id: string, patch: Partial<TargetRow>) {
    const [t] = await this.db
      .update(postTargets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(postTargets.id, id))
      .returning()
    if (t) {
      const p = await this.db.select({ projectId: posts.projectId }).from(posts).where(eq(posts.id, t.postId))
      this.publishChange(t.postId, p[0]?.projectId ?? null)
    }
    return t
  }

  publishChange(id: string, projectId: string | null) {
    this.ctx.realtime.publish(`post:${id}`, 'post.updated', { id })
    this.ctx.realtime.publish('calendar', 'post.updated', { id })
    if (projectId) this.ctx.realtime.publish(`project:${projectId}`, 'post.updated', { id })
    this.ctx.events.emit('post.changed', { id })
  }

  /** Targets scheduled or published between two dates (the calendar). */
  async calendar(actor: Actor, from: Date, to: Date, filter: { platform?: string; accountId?: string } = {}) {
    const rows = await this.db
      .select({ t: postTargets, p: posts })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .where(
        and(
          isNull(posts.deletedAt),
          eq(postTargets.enabled, true),
          sql`${postTargets.state} <> 'removed'`,
          or(
            and(gte(postTargets.scheduleAt, from), lte(postTargets.scheduleAt, to)),
            and(gte(postTargets.publishedAt, from), lte(postTargets.publishedAt, to)),
          ),
          filter.platform ? eq(postTargets.platform, filter.platform) : undefined,
          filter.accountId ? eq(postTargets.accountId, filter.accountId) : undefined,
        ),
      )
    const visible = new Map<string, boolean>()
    const out = []
    const accounts = new Map(
      ((await this.ctx.services.connectors?.accounts().catch(() => [])) ?? []).map((a) => [a.id, a]),
    )
    const firstMedia = await this.db
      .select()
      .from(postMedia)
      .where(
        and(
          inArray(
            postMedia.postId,
            [...new Set(rows.map((r) => r.p.id))].length
              ? [...new Set(rows.map((r) => r.p.id))]
              : ['00000000-0000-0000-0000-000000000000'],
          ),
          eq(postMedia.position, 0),
        ),
      )
    const thumbs = new Map(
      (
        await this.ctx.services.media.many(
          firstMedia.map((m) => m.mediaId),
          actor,
        )
      ).map((m) => [m.id, m.thumbnailUrl]),
    )
    for (const { t, p } of rows) {
      if (!visible.has(p.id)) visible.set(p.id, await this.canView(p.id, actor))
      if (!visible.get(p.id)) continue
      const acc = accounts.get(t.accountId)
      const mid = firstMedia.find((m) => m.postId === p.id)?.mediaId
      out.push({
        postId: p.id,
        targetId: t.id,
        name: p.name || (t.title ?? p.title) || (t.caption ?? p.caption).slice(0, 60),
        caption: (t.caption ?? p.caption).slice(0, 280),
        platform: t.platform as PostTarget['platform'],
        placement: t.placement as PostTarget['placement'],
        account: { id: t.accountId, name: acc?.name ?? 'Account', avatarUrl: acc?.avatarUrl ?? null },
        at: (t.scheduleAt ?? t.publishedAt)!.toISOString(),
        state: t.state as PostTarget['state'],
        thumbnailUrl: mid ? (thumbs.get(mid) ?? null) : null,
        remoteUrl: t.remoteUrl,
      })
    }
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }

  /** The final caption for a target: its own (or the post's) text, with hashtags appended. */
  static composeCaption(
    post: Pick<PostRow, 'caption' | 'hashtags'>,
    t: Pick<TargetRow, 'caption' | 'hashtags'>,
  ) {
    const text = (t.caption ?? post.caption).trim()
    const tags = (t.hashtags ?? post.hashtags).map((h) => h.replace(/^#/, '').replace(/\s+/g, ''))
    const missing = tags.filter((h) => !new RegExp(`#${h}\\b`, 'i').test(text))
    return missing.length ? `${text}${text ? '\n\n' : ''}${missing.map((h) => `#${h}`).join(' ')}` : text
  }

  async inputOf(id: string): Promise<SavePostInput & { targets: TargetInput[] }> {
    const p = await this.row(id)
    const pm = await this.db
      .select()
      .from(postMedia)
      .where(eq(postMedia.postId, id))
      .orderBy(asc(postMedia.position))
    const ts = await this.db.select().from(postTargets).where(eq(postTargets.postId, id))
    return {
      projectId: p.projectId,
      name: p.name,
      caption: p.caption,
      title: p.title,
      hashtags: p.hashtags,
      translations: p.translations as Record<string, { title: string; caption: string }>,
      media: pm.map((m) => ({ mediaId: m.mediaId })),
      targets: ts.map((t) => {
        const v = this.targetView(t)
        return { ...v, id: t.id }
      }),
    }
  }
}

function postFormat(f: MediaFormat): PostMediaFormat {
  return {
    key: f.key,
    label: f.label,
    width: f.width,
    height: f.height,
    duration: f.duration,
    previewUrl: f.urls.preview ?? (f.kind === 'image' ? (f.urls.poster ?? f.urls.original) : f.urls.original),
    posterUrl: f.urls.poster,
  }
}
