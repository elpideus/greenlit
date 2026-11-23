import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DEPTH_AUTO_DEFAULT, DepthAuto, type DepthJob, type DepthStatus } from '@greenlit/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type Actor, systemActor } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import type { SettingHandle } from '../../core/settings.ts'
import { probe } from '../../lib/ffmpeg.ts'
import { backendOrder, gpuPreference, nvidiaGpus } from '../../lib/gpu.ts'
import { media, mediaFormats } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'
import { depthOfPicture, depthOfVideo } from './estimate.ts'
import { DepthAnything, MOGE, MoGe, SMALL } from './model.ts'

export interface DepthJobData {
  formatId: string
  /** Replace a depth map that was uploaded (Greenlit's own are remade when asked or out of date). */
  replaceUploaded?: boolean
  /** Remake Greenlit's own map even when it is up to date. */
  force?: boolean
  /** Started by the automatic setting (an upload), not by someone. */
  auto?: boolean
}

type FormatRow = typeof mediaFormats.$inferSelect

/** Media in brand kits are logos, fonts and templates: depth maps mean nothing there. */
const notInKit = sql`(${media.projectId} is null or ${media.projectId} in (select ${projects.id} from ${projects} where ${projects.kind} = 'project'))`

/** The model Greenlit makes each kind's depth maps with now (DEPTH_GENERATORS in @greenlit/shared). */
const MODEL_FOR = { image: MOGE.id, video: SMALL.id } as const

/**
 * Makes depth maps as a background job per format, MoGe-2 for pictures and Depth Anything V2 Small for videos: the
 * map is attached to the format like an uploaded one, marked as Greenlit's (`meta.generated`: the model, the file
 * version it was made from, the distances it spans). Only one runs at a time: it takes the graphics card (or most of
 * the processor).
 */
export class DepthService {
  readonly ctx: ModuleContext
  readonly moge: MoGe
  readonly small: DepthAnything
  readonly auto: SettingHandle<DepthAuto>
  /** Formats waiting or being worked on (format id → its item and progress), for the viewer and the counts. */
  private readonly jobs = new Map<string, { mediaId: string } & Omit<DepthJob, 'formatId'>>()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    this.moge = new MoGe(MOGE, ctx.config.dataDir, ctx.log)
    this.small = new DepthAnything(SMALL, ctx.config.dataDir, ctx.log)
    this.auto = ctx.settings.define('depth.auto', { schema: DepthAuto, default: () => DEPTH_AUTO_DEFAULT })
  }

  jobsFor(mediaIds: string[]): Record<string, DepthJob[]> {
    const ids = new Set(mediaIds)
    const out: Record<string, DepthJob[]> = {}
    for (const [formatId, j] of this.jobs) {
      if (!ids.has(j.mediaId)) continue
      const list = out[j.mediaId] ?? []
      list.push({ formatId, state: j.state, progress: j.progress })
      out[j.mediaId] = list
    }
    return out
  }

  async status(): Promise<DepthStatus> {
    const rows = await this.ctx.db.execute<{ kind: string; n: number }>(sql`
      select m.kind, count(*)::int as n
      from ${media} m
      join ${mediaFormats} f on f.media_id = m.id and f.role = 'format' and f.version = '' and f.is_primary
      where m.deleted_at is null and m.kind in ('image', 'video')
        and (m.project_id is null or m.project_id in (select id from ${projects} where kind = 'project'))
        and not exists (select 1 from ${mediaFormats} d
          where d.media_id = m.id and d.role = 'depth' and d.version = f.version and d.key = f.key)
      group by m.kind`)
    const n = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0
    const old = await this.outdatedIds()
    const model = (m: MoGe | DepthAnything, kind: 'images' | 'videos') => ({
      id: m.spec.id,
      name: m.spec.name,
      license: m.spec.license,
      size: m.spec.size,
      for: kind,
      installed: m.installed(),
      backend: m.backend,
    })
    return {
      models: [model(this.moge, 'images'), model(this.small, 'videos')],
      auto: this.auto.get(),
      missing: { images: n('image'), videos: n('video') },
      outdated: { images: old.images.length, videos: old.videos.length },
      queued: this.jobs.size,
      device: {
        backend: this.moge.backend ?? this.small.backend,
        order: backendOrder(),
        gpus: (await nvidiaGpus()).map(({ name, memoryMB }) => ({ name, memoryMB })),
        off: gpuPreference() === 'off',
      },
    }
  }

  /** Queues the depth map of one format (a picture or video of an item, any version). */
  async queue(formatId: string, opts: Omit<DepthJobData, 'formatId'> = {}, actor?: Actor) {
    const f = await this.formatRow(formatId)
    if (f.role !== 'format') throw badRequest('Choose a picture or video format, not a depth map or a sound')
    if (f.kind !== 'image' && f.kind !== 'video') throw badRequest('Only pictures and videos have depth maps')
    const [m] = await this.ctx.db.select().from(media).where(eq(media.id, f.mediaId))
    if (!m || m.deletedAt) throw notFound('Media not found')
    if (this.jobs.has(formatId)) return false
    this.jobs.set(formatId, { mediaId: f.mediaId, state: 'queued', progress: 0 })
    this.announce(f.mediaId, formatId)
    await this.ctx.jobs.send('depth.generate', { formatId, ...opts } satisfies DepthJobData, {
      singletonKey: `depth:${formatId}`,
      task: {
        kind: 'depth.generate',
        title: `Making the depth map of ${m.title || f.filename}`,
        entityType: 'media',
        entityId: f.mediaId,
        createdBy: actor?.kind === 'user' ? actor.user.id : null,
      },
    })
    return true
  }

  /**
   * Queues depth maps for many items: each one's main version formats (other versions of the same size borrow
   * them), skipping formats that have an uploaded map unless `replace`, and Greenlit's own maps that are up to date.
   */
  async queueMany(mediaIds: string[], opts: { replace?: boolean } = {}, actor?: Actor) {
    if (!mediaIds.length) return 0
    const rows = await this.ctx.db
      .select({ format: mediaFormats })
      .from(mediaFormats)
      .innerJoin(media, eq(media.id, mediaFormats.mediaId))
      .where(
        and(
          inArray(mediaFormats.mediaId, mediaIds),
          eq(mediaFormats.role, 'format'),
          eq(mediaFormats.version, ''),
          inArray(mediaFormats.kind, ['image', 'video']),
          isNull(media.deletedAt),
        ),
      )
    let n = 0
    for (const { format } of rows) {
      const existing = await this.depthOf(format)
      if (existing && !this.isGenerated(existing) && !opts.replace) continue
      if (existing && this.isGenerated(existing) && !this.isStale(existing, format)) continue
      if (await this.queue(format.id, { replaceUploaded: opts.replace }, actor)) n++
    }
    return n
  }

  /** Everything (outside brand kits) whose main format has no depth map yet. */
  async missingIds(kinds: 'all' | 'images') {
    const rows = await this.ctx.db.execute<{ id: string }>(sql`
      select m.id from ${media} m
      join ${mediaFormats} f on f.media_id = m.id and f.role = 'format' and f.version = '' and f.is_primary
      where m.deleted_at is null and m.kind in (${sql.join(
        (kinds === 'images' ? ['image'] : ['image', 'video']).map((k) => sql`${k}`),
        sql`, `,
      )})
        and (m.project_id is null or m.project_id in (select id from ${projects} where kind = 'project'))
        and not exists (select 1 from ${mediaFormats} d
          where d.media_id = m.id and d.role = 'depth' and d.version = f.version and d.key = f.key)
      order by m.created_at desc`)
    return rows.map((r) => r.id)
  }

  /**
   * Items whose main format has a map Greenlit made with a model it no longer uses for that kind (pictures made with
   * Depth Anything V2 Small before MoGe-2).
   */
  async outdatedIds() {
    const rows = await this.ctx.db.execute<{ id: string; kind: string }>(sql`
      select m.id, m.kind from ${media} m
      join ${mediaFormats} f on f.media_id = m.id and f.role = 'format' and f.version = '' and f.is_primary
      join ${mediaFormats} d on d.media_id = m.id and d.role = 'depth' and d.version = f.version and d.key = f.key
      where m.deleted_at is null and m.kind in ('image', 'video')
        and d.meta ? 'generated'
        and d.meta->'generated'->>'model' <> case m.kind when 'image' then ${MODEL_FOR.image} else ${MODEL_FOR.video} end
      order by m.created_at desc`)
    return {
      images: rows.filter((r) => r.kind === 'image').map((r) => r.id),
      videos: rows.filter((r) => r.kind === 'video').map((r) => r.id),
    }
  }

  /** A format finished processing: with the automatic setting on, make (or remake) its depth map. */
  async onProcessed(formatId: string) {
    const auto = this.auto.get()
    if (!auto.enabled) return
    const [row] = await this.ctx.db
      .select({ format: mediaFormats, kitFree: sql<boolean>`${notInKit}` })
      .from(mediaFormats)
      .innerJoin(media, eq(media.id, mediaFormats.mediaId))
      .where(and(eq(mediaFormats.id, formatId), isNull(media.deletedAt)))
    if (!row?.kitFree) return
    const f = row.format
    if (f.role !== 'format' || f.processingState !== 'ready') return
    if (f.kind !== 'image' && !(f.kind === 'video' && auto.kinds === 'all')) return
    const existing = await this.depthOf(f)
    // An uploaded map stays; Greenlit's own is remade when the picture got a new file.
    if (existing && (!this.isGenerated(existing) || !this.isStale(existing, f))) return
    await this.queue(f.id, { auto: true })
  }

  async run(data: DepthJobData, job: JobContext) {
    const entry = this.jobs.get(data.formatId)
    const f = await this.formatRow(data.formatId).catch(() => null)
    try {
      if (!f) return { skipped: 'The format no longer exists' }
      const [m] = await this.ctx.db.select().from(media).where(eq(media.id, f.mediaId))
      if (!m || m.deletedAt) return { skipped: 'The item is in the trash' }
      const existing = await this.depthOf(f)
      if (existing && !this.isGenerated(existing) && !data.replaceUploaded)
        return { skipped: 'It has an uploaded depth map' }
      if (existing && this.isGenerated(existing) && !this.isStale(existing, f) && !data.force)
        return { skipped: 'Its depth map is up to date' }
      this.jobs.set(f.id, { mediaId: f.mediaId, state: 'running', progress: 0 })
      const progress = this.progressFor(f, job)

      // The model, once (MoGe-2 1.3 GB, Small 99 MB): the first tenth of the bar.
      const model = f.kind === 'image' ? this.moge : this.small
      // One model in memory at a time (jobs run one by one): the other kind's goes.
      await (model === this.moge ? this.small : this.moge).close()
      const downloading = !model.installed()
      const size = `${Math.round(model.spec.size / 1e8) / 10} GB`
      if (downloading) await job.progress(0, `Downloading ${model.spec.name} (${size})`).catch(() => {})
      await model.ensure((x) => void progress(x * 0.1, downloading && model.spec.name), job.signal)
      const files = this.ctx.services.files
      const blob = await files.get(f.blobId)
      const src = await files.readablePath(blob)
      const dir = join(files.dir('tmp'), `depth-${f.id}`)
      await mkdir(dir, { recursive: true })
      const stem = f.filename.replace(/\.[^.]+$/, '') || 'depth'
      try {
        const start = downloading ? 0.1 : 0
        let out: string
        let mime: string
        let metric: { near: number; far: number } | null = null
        if (f.kind === 'image') {
          out = join(dir, `${stem}_depth.png`)
          mime = 'image/png'
          await progress(start + 0.2)
          metric = (await depthOfPicture(this.moge, src, out)).metric
        } else {
          out = join(dir, `${stem}_depth.mp4`)
          mime = 'video/mp4'
          await depthOfVideo(this.small, src, out, await probe(src), {
            signal: job.signal,
            onProgress: (x) => void progress(start + x * (1 - start)),
          })
        }
        const made = await files.ingest(out, {
          filename: out.split('/').pop()!,
          mime,
          createdBy: null,
          move: true,
        })
        await this.ctx.services.media.attachFile(
          f.mediaId,
          made,
          {
            formatKey: f.key,
            version: f.version,
            depth: true,
            note: `Made by Greenlit (${model.spec.name})`,
            // Disparity: near is light, whatever the map it replaces said.
            meta: {
              near: 'light',
              generated: { model: model.spec.id, fromRevision: f.fileRevision, metric },
            },
          },
          systemActor('depth maps'),
        )
        return { made: made.filename }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    } finally {
      this.jobs.delete(data.formatId)
      if (f ?? entry) this.announce((f?.mediaId ?? entry?.mediaId)!, data.formatId, true)
    }
  }

  /** Reports progress to the task and the item's viewers (at most a few times a second). */
  private progressFor(f: FormatRow, job: JobContext) {
    let last = 0
    return async (x: number, downloading: string | false = false) => {
      const entry = this.jobs.get(f.id)
      if (entry) entry.progress = x
      const now = Date.now()
      if (now - last < 400 && x < 1) return
      last = now
      this.announce(f.mediaId, f.id)
      // Never let a progress update fail the work (the server may be shutting down: the job is then retried).
      await job.progress(x, downloading ? `Downloading ${downloading}` : undefined).catch(() => {})
    }
  }

  private announce(mediaId: string, formatId: string, done = false) {
    const j = this.jobs.get(formatId)
    // Its own topic: progress several times a second shouldn't refetch the whole item on `media:<id>`.
    this.ctx.realtime.publish(`depth:${mediaId}`, 'depth.progress', {
      formatId,
      state: done || !j ? 'done' : j.state,
      progress: j?.progress ?? 1,
    })
  }

  private async formatRow(formatId: string) {
    const [f] = await this.ctx.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
    if (!f) throw notFound('Format not found')
    return f
  }

  private async depthOf(f: FormatRow) {
    const [d] = await this.ctx.db
      .select()
      .from(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, f.mediaId),
          eq(mediaFormats.role, 'depth'),
          eq(mediaFormats.version, f.version),
          eq(mediaFormats.key, f.key),
        ),
      )
    return d ?? null
  }

  private isGenerated(d: FormatRow) {
    return !!(d.meta as { generated?: unknown } | null)?.generated
  }

  /** Greenlit's map was made from an older file of the picture, or with a model it no longer uses for that kind. */
  private isStale(d: FormatRow, f: FormatRow) {
    const g = (d.meta as { generated?: { fromRevision?: number; model?: string } } | null)?.generated
    const now = f.kind === 'image' ? MODEL_FOR.image : MODEL_FOR.video
    return g?.fromRevision !== f.fileRevision || g?.model !== now
  }
}
