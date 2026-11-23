import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ffmpegArgsFor, getPlacement, type PlacementKey, pickBestFormat } from '@greenlit/platforms'
import type { Placement } from '@greenlit/shared'
import { and, asc, between, eq, isNull, ne, or } from 'drizzle-orm'
import sharp from 'sharp'
import type { Actor } from '../../core/actor.ts'
import { badRequest } from '../../core/errors.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpeg, isHdr, probe } from '../../lib/ffmpeg.ts'
import type { PublishRequest, ScheduleQuestion } from '../connectors/drivers/types.ts'

type PublishRequestLocation = PublishRequest['location']

import { postMedia, posts, postTargets } from './schema.ts'
import { PostsService } from './service.ts'

type TargetRow = typeof postTargets.$inferSelect

export interface PreparedFile {
  path: string
  mime: string
  kind: 'video' | 'image'
  blobId: string
}

/**
 * Makes the files for one target with the encoding the platform prefers (resolution, frame rate, bitrate,
 * colour, audio), using the placement specs in @greenlit/platforms. Results are cached as blobs and reused
 * until the source or the settings change.
 */
export async function prepareTarget(
  ctx: ModuleContext,
  t: TargetRow,
  job?: JobContext,
): Promise<{ files: PreparedFile[]; thumbnailPath: string | null }> {
  const files = ctx.services.files
  const spec = getPlacement(t.platform as never, t.placement)
  if (!spec) throw badRequest(`${t.platform} ${t.placement} is not supported`)
  const items = await ctx.db
    .select()
    .from(postMedia)
    .where(eq(postMedia.postId, t.postId))
    .orderBy(asc(postMedia.position))
  if (!items.length) throw badRequest('The post has no media')
  const chosen: { blobId: string; kind: 'video' | 'image'; path: string; formatKey: string }[] = []
  for (const it of items) {
    const formats = await ctx.services.media.formatsOf(it.mediaId)
    const wanted = (t.formats as Record<string, string>)[it.mediaId]
    let f = formats.find((x) => x.key === wanted)
    if (!f) {
      const i = pickBestFormat(
        spec,
        formats.map((x) => ({ width: x.width, height: x.height })),
      )
      f = formats[i] ?? formats[0]
    }
    if (!f || (f.kind !== 'video' && f.kind !== 'image'))
      throw badRequest('Only videos and pictures can be published')
    const blob = await files.get(f.blobId)
    chosen.push({ blobId: blob.id, kind: f.kind, path: await files.readablePath(blob), formatKey: f.key })
  }
  const options = t.options as Record<string, unknown>
  const key = createHash('sha1')
    .update(
      JSON.stringify({
        spec: spec.key,
        blobs: chosen.map((c) => c.blobId),
        boost: !!options.qualityBoost,
        fit: options.fit ?? 'auto',
        v: 1,
      }),
    )
    .digest('hex')
  // Reuse what we made last time if nothing changed.
  if (t.preparedKey === key && t.preparedBlobIds.length === chosen.length) {
    const blobs = await files.many(t.preparedBlobIds)
    if (t.preparedBlobIds.every((id) => blobs.get(id)?.state === 'hot')) {
      const out = t.preparedBlobIds.map((id, i) => {
        const b = blobs.get(id)!
        return { path: files.absPath(b), mime: b.mime, kind: chosen[i]!.kind, blobId: id }
      })
      return { files: out, thumbnailPath: await thumbnailFor(ctx, t, out[0]!) }
    }
  }
  const out: PreparedFile[] = []
  for (const [i, c] of chosen.entries()) {
    const p = await probe(c.path)
    const plan = ffmpegArgsFor(
      spec,
      {
        kind: c.kind,
        width: p.width ?? 1080,
        height: p.height ?? 1920,
        fps: p.fps,
        durationSec: p.durationSec,
        hasAudio: p.hasAudio,
        hdr: isHdr(p) ? (p.colorTransfer === 'arib-std-b67' ? 'hlg' : 'pq') : false,
        ...(p.colorMatrix ? { colorMatrix: p.colorMatrix } : {}),
        ...(p.colorRange ? { colorRange: p.colorRange } : {}),
        ...(p.audioChannels ? { audioChannels: p.audioChannels } : {}),
      },
      { qualityBoost: !!options.qualityBoost, fit: (options.fit as 'auto') ?? 'auto' },
    )
    ctx.log.info({ target: t.id, placement: spec.key, notes: plan.notes }, 'preparing file for platform')
    const dest = await files.tmpPath(`.${plan.outputExt}`)
    await ffmpeg(['-i', c.path, ...plan.args, dest], {
      durationSec: p.durationSec,
      onProgress: (f) => void job?.progress(((i + f) / chosen.length) * 0.6, `Optimising for ${spec.label}`),
      signal: job?.signal,
    })
    const mime =
      plan.outputExt === 'mp4'
        ? 'video/mp4'
        : plan.outputExt === 'mov'
          ? 'video/quicktime'
          : plan.outputExt === 'png'
            ? 'image/png'
            : plan.outputExt === 'webp'
              ? 'image/webp'
              : 'image/jpeg'
    const blob = await files.ingest(dest, {
      filename: `${t.platform}-${t.placement}-${i + 1}.${plan.outputExt}`,
      mime,
      usage: 'prepared',
    })
    out.push({ path: files.absPath(blob), mime, kind: c.kind, blobId: blob.id })
  }
  await ctx.db
    .update(postTargets)
    .set({ preparedBlobIds: out.map((o) => o.blobId), preparedKey: key })
    .where(eq(postTargets.id, t.id))
  return { files: out, thumbnailPath: await thumbnailFor(ctx, t, out[0]!) }
}

/**
 * Whether a version on a platform has text or a time to bring up to date there. A story has no caption on any
 * platform: only its time, while the platform keeps it scheduled.
 */
export function hasTextToSync(t: { placement: string; state: string }): boolean {
  return t.placement !== 'story' || t.state === 'scheduled'
}

/**
 * Which of the post's pictures is the cover (zero-based, in the post's order), when the cover is one of them; else
 * null. A platform whose cover is a photo post's first picture puts it first.
 */
export function coverIndexOf(thumbnail: unknown, mediaIds: string[]): number | null {
  const th = thumbnail as { mode?: string; mediaId?: string } | null
  if (th?.mode !== 'media' || !th.mediaId) return null
  const i = mediaIds.indexOf(th.mediaId)
  return i >= 0 ? i : null
}

/** The cover's frame time in seconds when the cover is a frame of the video, else null. */
export function thumbnailAtOf(t: { thumbnail: unknown }): number | null {
  const th = t.thumbnail as { mode?: string; time?: number } | null
  return th?.mode === 'frame' && typeof th.time === 'number' && th.time >= 0 ? th.time : null
}

/** The cover: a frame of the video, a picture from the library, or nothing (the platform chooses). */
async function thumbnailFor(ctx: ModuleContext, t: TargetRow, first: PreparedFile): Promise<string | null> {
  const thumb = t.thumbnail as
    | { mode: 'auto' }
    | { mode: 'frame'; time: number }
    | { mode: 'media'; mediaId: string }
  const files = ctx.services.files
  if (thumb.mode === 'frame' && first.kind === 'video') {
    const out = await files.tmpPath('.jpg')
    await ffmpeg(['-ss', String(thumb.time), '-i', first.path, '-frames:v', '1', '-q:v', '2', out])
    return out
  }
  if (thumb.mode === 'media') {
    const formats = await ctx.services.media.formatsOf(thumb.mediaId)
    const f = formats.find((x) => x.isPrimary) ?? formats[0]
    if (!f) return null
    const src = await files.readablePath(await files.get(f.blobId))
    const out = await files.tmpPath('.jpg')
    await sharp(await readFile(src), { failOn: 'none' })
      .rotate()
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toFile(out)
    return out
  }
  return null
}

/** A version's time if it is still to come (a minute away or less is now): Greenlit or the platform waits for it. */
export function timeToWaitFor(scheduleAt: Date | string | null, now = Date.now()): Date | null {
  const at = scheduleAt ? new Date(scheduleAt) : null
  return at && at.getTime() > now + 60_000 ? at : null
}

/**
 * What choosing a version's connector looks at (connectors' holdsSchedule): its account and placement, and whether
 * it has a sound, a location, a first comment, a cover of its own and translations.
 */
export function scheduleQuestion(
  t: {
    accountId: string
    placement: string
    music: unknown
    location: unknown
    firstComment: string | null
    thumbnail: unknown
    translations: unknown
  },
  postTranslations: unknown,
): ScheduleQuestion {
  const mode = (t.thumbnail as { mode?: string } | null)?.mode
  return {
    accountId: t.accountId,
    placement: t.placement as Placement,
    music: (t.music as ScheduleQuestion['music']) ?? null,
    location: (t.location as ScheduleQuestion['location']) ?? null,
    firstComment: t.firstComment ?? '',
    thumbnailPath: mode && mode !== 'auto' ? 'cover' : null,
    translations: {
      ...((postTranslations as ScheduleQuestion['translations']) ?? {}),
      ...((t.translations as ScheduleQuestion['translations']) ?? {}),
    },
  }
}

export function registerPostJobs(ctx: ModuleContext, svc: PostsService) {
  const actorFor = async (userId: string | null): Promise<Actor> =>
    userId
      ? ctx.services.users.actorFor(await ctx.services.users.get(userId), 'web')
      : { kind: 'system', source: 'system' }

  ctx.jobs.define<{ targetId: string; userId: string | null; dryRun?: boolean }>('posts.publish', {
    concurrency: 1,
    retryLimit: 1,
    retryDelaySeconds: 120,
    expireInSeconds: 3 * 3600,
    handler: async ({ targetId, dryRun }, job) => {
      const connectors = ctx.services.connectors
      if (!connectors) throw new Error('No platform connectors are installed')
      const t = await svc.targetRow(targetId)
      const [p] = await ctx.db.select().from(posts).where(eq(posts.id, t.postId))
      if (!p) return
      // Only a version waiting to go is sent: never one already sent, being sent by another job, or sent again by
      // hand while this retry waited (each would be one more copy on the platform).
      if (t.state === 'preparing' || t.state === 'uploading') {
        await svc.setTargetState(t.id, {
          state: 'failed',
          error: `Publishing was interrupted while sending. Check ${t.platform} before publishing again: it may already be there.`,
        })
        return { interrupted: true }
      }
      if (t.state !== 'queued') return { skipped: t.state }
      // A time the platform does not keep (a placement it does not schedule, or out of its window) is Greenlit's
      // to keep: the version waits, and posts.due sends it at its time. A dry run rehearses that publish.
      const at = timeToWaitFor(t.scheduleAt)
      const keeps = at ? await connectors.holdsSchedule(scheduleQuestion(t, p.translations), at) : false
      if (at && !keeps && !dryRun) return { waiting: at.toISOString() }
      await svc.setTargetState(t.id, { state: 'preparing', error: null })
      try {
        const { files, thumbnailPath } = await prepareTarget(ctx, t, job)
        const order = await ctx.db
          .select({ mediaId: postMedia.mediaId })
          .from(postMedia)
          .where(eq(postMedia.postId, t.postId))
          .orderBy(asc(postMedia.position))
        await svc.setTargetState(t.id, { state: 'uploading' })
        await job.progress(0.65, 'Uploading to the platform')
        const scheduleAt = keeps ? at : null
        const result = await connectors.publish({
          accountId: t.accountId,
          placement: t.placement as Placement,
          files: files.map((f) => ({ path: f.path, mime: f.mime, kind: f.kind })),
          thumbnailPath,
          thumbnailAt: thumbnailAtOf(t),
          coverIndex: coverIndexOf(
            t.thumbnail,
            order.map((o) => o.mediaId),
          ),
          title: t.title ?? p.title,
          caption: PostsService.composeCaption(p, t),
          tags: t.tags,
          firstComment: t.firstComment,
          location: (t.location as { name: string; platformId: string | null } | null) ?? null,
          translations: {
            ...(p.translations as Record<string, { title: string; caption: string }>),
            ...(t.translations as Record<string, { title: string; caption: string }>),
          },
          music: (t.music as never) ?? null,
          audio: t.audio as never,
          options: t.options as Record<string, unknown>,
          scheduleAt,
          timeZone: ctx.services.platform.timeZone(),
          dryRun,
        })
        if (dryRun) {
          await svc.setTargetState(t.id, { state: 'draft' })
          if (at && !keeps && result.dryRun)
            result.dryRun.steps = [
              `${t.platform} does not keep this schedule: Greenlit publishes it at ${at.toISOString()}`,
              ...result.dryRun.steps,
            ]
          return { dryRun: true, result }
        }
        const warnings = (result as { warnings?: string[] }).warnings ?? []
        await svc.setTargetState(t.id, {
          state: result.state,
          remoteId: result.remoteId,
          remoteUrl: result.url,
          // Another connector of the same account published it (merged accounts): edits and deletes go there too.
          viaAccountId: result.viaAccountId ?? null,
          publishedAt: result.state === 'published' ? new Date() : null,
          syncedAt: new Date(),
          remoteSnapshot: {
            caption: PostsService.composeCaption(p, t),
            title: t.title ?? p.title,
            scheduleAt: scheduleAt?.toISOString() ?? null,
            warnings,
          },
        })
        for (const it of await ctx.db.select().from(postMedia).where(eq(postMedia.postId, p.id)))
          await ctx.services.links?.link(
            { type: 'media', id: it.mediaId },
            'published_as',
            { type: 'post', id: p.id },
            { auto: true },
          )
        return result
      } catch (err) {
        const message = (err as Error).message.slice(0, 1900)
        // Signed out, or something the platform cannot do: trying again would not help.
        const hopeless = (err as { retriable?: boolean }).retriable === false
        const meta = job.job as { retryCount?: number; retryLimit?: number }
        const retrying = !hopeless && (meta.retryCount ?? 0) < (meta.retryLimit ?? 1)
        // While a retry waits the version stays queued, so it cannot be sent a second time by hand meanwhile.
        await svc.setTargetState(t.id, {
          state: retrying ? 'queued' : 'failed',
          error: retrying ? `${message} (trying again in a few minutes)` : message,
        })
        if (hopeless) return { failed: message }
        throw err
      }
    },
  })

  ctx.jobs.define<{ targetId: string }>('posts.update', {
    concurrency: 1,
    retryLimit: 2,
    handler: async ({ targetId }) => {
      const connectors = ctx.services.connectors
      const t = await svc.targetRow(targetId)
      if (!connectors || !t.remoteId) return
      if (!hasTextToSync(t)) return { skipped: 'a story has no text to change' }
      const [p] = await ctx.db.select().from(posts).where(eq(posts.id, t.postId))
      if (!p) return
      const caption = PostsService.composeCaption(p, t)
      const title = t.title ?? p.title
      try {
        await connectors.update(t.viaAccountId ?? t.accountId, t.remoteId, {
          title,
          caption,
          tags: t.tags,
          translations: t.translations as never,
          // some platforms name what the post already has (Instagram's AI label) when they change its caption
          options: t.options as Record<string, unknown>,
          location: (t.location as PublishRequestLocation) ?? null,
          scheduleAt: t.state === 'scheduled' ? t.scheduleAt : null,
          timeZone: ctx.services.platform.timeZone(),
        })
        await svc.setTargetState(t.id, {
          error: null,
          syncedAt: new Date(),
          remoteSnapshot: { caption, title, scheduleAt: t.scheduleAt?.toISOString() ?? null },
        })
      } catch (err) {
        const unsupported = (err as { name?: string }).name === 'ConnectorUnsupported'
        if (
          unsupported &&
          t.state === 'scheduled' &&
          t.scheduleAt &&
          t.scheduleAt.getTime() > Date.now() + 10 * 60_000
        ) {
          // The platform cannot edit a scheduled post: remove it there and schedule the new version again.
          await connectors.remove(t.viaAccountId ?? t.accountId, t.remoteId)
          await svc.setTargetState(t.id, {
            state: 'queued',
            remoteId: null,
            remoteUrl: null,
            viaAccountId: null,
            error: null,
          })
          await ctx.jobs.send(
            'posts.publish',
            { targetId: t.id, userId: null },
            { singletonKey: `publish:${t.id}` },
          )
          return { rescheduled: true }
        }
        await svc.setTargetState(t.id, {
          error: `Could not update on the platform: ${(err as Error).message}`.slice(0, 2000),
        })
        if ((err as { retriable?: boolean }).retriable === false) return { failed: (err as Error).message }
        throw err
      }
    },
  })

  ctx.jobs.define<{ targetId: string }>('posts.remove', {
    concurrency: 1,
    retryLimit: 1,
    handler: async ({ targetId }) => {
      const connectors = ctx.services.connectors
      const t = await svc.targetRow(targetId)
      if (connectors && t.remoteId) await connectors.remove(t.viaAccountId ?? t.accountId, t.remoteId)
      await svc.setTargetState(t.id, {
        state: 'removed',
        remoteId: null,
        remoteUrl: null,
        viaAccountId: null,
      })
    },
  })

  // Keep Greenlit in step with what happened on the platforms (edits, deletions, published schedules, stats).
  ctx.events.on('connectors.remotePosts', async ({ accountId, posts: remote }) => {
    // Posts this connector made for an account merged with it count as its own (they carry its remote ids).
    const known = await ctx.db
      .select()
      .from(postTargets)
      .where(or(eq(postTargets.accountId, accountId), eq(postTargets.viaAccountId, accountId)))
    const byRemote = new Map(known.filter((k) => k.remoteId).map((k) => [k.remoteId!, k]))
    const sync: Actor = { kind: 'system', source: 'sync', label: 'platform sync' }
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase()
    for (const r of remote) {
      let t = byRemote.get(r.remoteId)
      if (!t) {
        // Scheduled posts some platforms only number when they go live ("pending:<time>"): match by caption.
        const pending = known.find(
          (k) =>
            k.remoteId?.startsWith('pending:') &&
            norm((k.remoteSnapshot as { caption?: string } | null)?.caption ?? '') === norm(r.caption),
        )
        if (pending) {
          await svc.setTargetState(pending.id, { remoteId: r.remoteId })
          pending.remoteId = r.remoteId
          t = pending
        }
      }
      if (!t) {
        await importRemote(ctx, svc, accountId, r)
        continue
      }
      const snap = (t.remoteSnapshot as { caption?: string; title?: string } | null) ?? {}
      const patch: Partial<TargetRow> = {
        state: r.state,
        remoteUrl: r.url ?? t.remoteUrl,
        syncedAt: new Date(),
        stats: r.stats ?? t.stats,
        publishedAt: r.publishedAt ? new Date(r.publishedAt) : t.publishedAt,
        scheduleAt: r.state === 'scheduled' && r.scheduledAt ? new Date(r.scheduledAt) : t.scheduleAt,
      }
      // Text changed on the platform (not by us): take it into Greenlit as the target's own text.
      if (r.caption && r.caption !== snap.caption) patch.caption = r.caption
      if (r.title && r.title !== snap.title) patch.title = r.title
      if (patch.caption !== undefined || patch.title !== undefined)
        patch.remoteSnapshot = { ...snap, caption: r.caption, title: r.title }
      await svc.setTargetState(t.id, patch)
      if (patch.caption !== undefined || patch.title !== undefined)
        await ctx.versions.record('post', t.postId, sync)
    }
  })

  void actorFor
}

/**
 * A post already in Greenlit that is this remote post seen through another account on the same platform: the same
 * text, published within ten minutes of it. Posts without text are never matched (too easy to confuse).
 */
async function findTwin(
  ctx: ModuleContext,
  platform: string,
  accountId: string,
  r: { caption: string; publishedAt: string | null },
): Promise<string | null> {
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase()
  const text = norm(r.caption)
  if (text.length < 12 || !r.publishedAt) return null
  const at = new Date(r.publishedAt).getTime()
  const near = await ctx.db
    .select({ postId: postTargets.postId, caption: posts.caption, snapshot: postTargets.remoteSnapshot })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(
      and(
        eq(postTargets.platform, platform),
        ne(postTargets.accountId, accountId),
        isNull(posts.deletedAt),
        between(postTargets.publishedAt, new Date(at - 10 * 60_000), new Date(at + 10 * 60_000)),
      ),
    )
  const hit = near.find(
    (n) =>
      norm(n.caption) === text || norm((n.snapshot as { caption?: string } | null)?.caption ?? '') === text,
  )
  return hit?.postId ?? null
}

/** A post made directly on the platform: recorded in Greenlit and linked to library media when it can be recognised. */
async function importRemote(
  ctx: ModuleContext,
  svc: PostsService,
  accountId: string,
  r: {
    remoteId: string
    url: string | null
    placement: Placement
    title: string
    caption: string
    thumbnailUrl: string | null
    state: 'scheduled' | 'published' | 'removed'
    scheduledAt: string | null
    publishedAt: string | null
    stats: Record<string, number> | null
  },
) {
  if (r.state === 'removed') return
  const account = await ctx.services.connectors!.account(accountId)
  // The same post reached through another connector (a Page connected through facebook.com and through Business
  // Suite): it joins that post as one more target instead of becoming a second post.
  const twin = await findTwin(ctx, account.platform, accountId, r)
  if (twin) {
    await ctx.db.insert(postTargets).values({
      postId: twin,
      accountId,
      platform: account.platform,
      placement: r.placement,
      state: r.state,
      remoteId: r.remoteId,
      remoteUrl: r.url,
      scheduleAt: r.scheduledAt ? new Date(r.scheduledAt) : null,
      publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
      syncedAt: new Date(),
      stats: r.stats,
      remoteSnapshot: { caption: r.caption, title: r.title },
    })
    svc.publishChange(twin, null)
    return
  }
  const [p] = await ctx.db
    .insert(posts)
    .values({
      name: r.title || r.caption.slice(0, 60),
      caption: r.caption,
      title: r.title,
      origin: 'platform',
    })
    .returning()
  await ctx.db.insert(postTargets).values({
    postId: p!.id,
    accountId,
    platform: account.platform,
    placement: r.placement,
    state: r.state,
    remoteId: r.remoteId,
    remoteUrl: r.url,
    scheduleAt: r.scheduledAt ? new Date(r.scheduledAt) : null,
    publishedAt: r.publishedAt ? new Date(r.publishedAt) : null,
    syncedAt: new Date(),
    stats: r.stats,
    remoteSnapshot: { caption: r.caption, title: r.title },
  })
  const match = r.thumbnailUrl ? await matchMedia(ctx, r.thumbnailUrl) : null
  if (match) {
    await ctx.db.insert(postMedia).values({ postId: p!.id, mediaId: match, position: 0 })
    await ctx.services.links?.link(
      { type: 'media', id: match },
      'published_as',
      { type: 'post', id: p!.id },
      { auto: true },
    )
  }
  await ctx.versions.record('post', p!.id, { kind: 'system', source: 'sync' }, { force: true })
  svc.publishChange(p!.id, null)
}

/** Finds the library item a platform thumbnail shows, by perceptual hash of posters (dHash, 64 bit). */
async function matchMedia(ctx: ModuleContext, thumbnailUrl: string): Promise<string | null> {
  try {
    const res = await fetch(thumbnailUrl)
    if (!res.ok) return null
    const target = await dhash(Buffer.from(await res.arrayBuffer()))
    const rows = await ctx.db.execute<{ media_id: string; blob_id: string }>(
      `select f.media_id, f.blob_id from media_formats f join media m on m.id = f.media_id where m.deleted_at is null and 'poster.webp' = any(f.derived) order by m.created_at desc limit 2000` as never,
    )
    let best: { id: string; d: number } | null = null
    for (const row of rows) {
      const file = ctx.services.files.derivedPath(row.blob_id, 'poster.webp')
      const h = await dhash(await readFile(file)).catch(() => null)
      if (h === null) continue
      const d = hamming(h, target)
      if (!best || d < best.d) best = { id: row.media_id, d }
    }
    return best && best.d <= 10 ? best.id : null
  } catch {
    return null
  }
}

async function dhash(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let h = 0n
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n)
  return h
}

function hamming(a: bigint, b: bigint) {
  let x = a ^ b
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

export type { PlacementKey }
