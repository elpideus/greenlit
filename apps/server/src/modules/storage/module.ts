import { statfs } from 'node:fs/promises'
import { ArchivePolicy, ArchiveStrategy } from '@greenlit/shared'
import {
  ArchivePolicyPatch,
  ArchiveRun,
  type ArchiveRunItem,
  GcReport,
  RestoreResult,
  StorageJobStarted,
  StorageOverview,
} from '@greenlit/shared/areas/storage-admin'
import { z } from 'zod'
import { type Actor, actorUserId, can } from '../../core/actor.ts'
import { badRequest } from '../../core/errors.ts'
import { IdParams, route } from '../../core/http.ts'
import type { JobContext } from '../../core/jobs.ts'
import { defineModule } from '../../core/module.ts'
import { Archiver } from './archiver.ts'
import { collectGarbage } from './gc.ts'
import { archiveCandidates, blobTotals, folderSize, forgetFolderSizes, nextOccurrence } from './queries.ts'
import { storageTools } from './tools.ts'

declare module '../../core/hooks.ts' {
  interface Hooks {
    /**
     * Blobs that must stay hot right now, e.g. files of posts scheduled in the future (they are about to be
     * uploaded to the social platforms). Return the ids you need; everything else may be archived.
     */
    'storage.inUse': { args: { blobIds: string[] }; result: string[] }
    /** Blob ids your module keeps (renders, covers, attachments…), so the clean-up never deletes them. */
    'storage.references': { args: Record<string, never>; result: string[] }
  }
}

/** A nightly pass stops after this long and continues the next night. */
const RUN_BUDGET_MS = 6 * 3600_000
/** Restores of archives up to this size happen while the request waits; bigger ones become a task. */
const INLINE_RESTORE_BYTES = 512 * 1024 * 1024

interface ArchiveJob {
  trigger: 'schedule' | 'manual' | 'file'
  blobIds?: string[]
  strategy?: ArchiveStrategy
  userId?: string | null
}

export default defineModule({
  id: 'storage',
  name: 'Storage',
  description:
    'Disk usage, automatic archival of old media (one archive per file) and clean-up of unused files.',
  dependsOn: ['files', 'media', 'platform'],
  after: ['comments'],
  permissions: {
    'storage.manage': {
      description: 'See disk usage, change the archive policy, archive and restore files',
      roles: [],
    },
  },
  setup(ctx) {
    const files = ctx.services.files
    const archiver = new Archiver(ctx)
    const policy = ctx.settings.define('storage.archive', {
      schema: ArchivePolicy,
      default: () => ArchivePolicy.parse({}),
    })
    const lastRun = ctx.settings.define('storage.lastRun', {
      schema: ArchiveRun.nullable(),
      default: () => null,
    })
    const lastGc = ctx.settings.define('storage.lastGc', { schema: GcReport.nullable(), default: () => null })

    // ── the files module asks us for archived blobs ─────────────────────
    ctx.hooks.add('files.openArchived', ({ blob }) => archiver.open(blob))
    ctx.hooks.add('files.restore', ({ blob }) => archiver.restore(blob.id))
    ctx.realtime.guard('storage', (actor) => can(actor, 'storage.manage'))

    const announce = () => {
      forgetFolderSizes()
      ctx.realtime.publish('storage', 'storage.changed', {})
    }

    // ── jobs ────────────────────────────────────────────────────────────
    const runArchive = async (data: ArchiveJob, job: JobContext) => {
      const p = policy.get()
      const started = Date.now()
      const list = data.blobIds?.length
        ? await archiveCandidates(ctx, p, { blobIds: data.blobIds, force: true, strategy: data.strategy })
        : await archiveCandidates(ctx, p)
      const items: ArchiveRunItem[] = []
      let stoppedEarly = false
      for (const [i, c] of list.entries()) {
        if (Date.now() - started > RUN_BUDGET_MS) {
          stoppedEarly = true
          break
        }
        const label =
          list.length > 1 ? `Archiving ${c.filename} (${i + 1} of ${list.length})` : `Archiving ${c.filename}`
        await job.progress(i / list.length, label)
        const r = await archiver.archive(c.id, {
          policy: p,
          kind: c.kind,
          strategy: data.strategy,
          signal: job.signal,
          onProgress: (f) => void job.progress((i + f) / list.length, label),
        })
        items.push({
          blobId: c.id,
          filename: c.filename,
          kind: c.kind,
          strategy: r.strategy,
          outcome: r.outcome,
          before: r.before,
          after: r.after,
          note: r.note,
        })
        if (r.outcome === 'archived') announce()
      }
      const run: ArchiveRun = {
        at: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        trigger: data.trigger,
        candidates: list.length,
        archived: items.filter((x) => x.outcome === 'archived').length,
        skipped: items.filter((x) => x.outcome === 'skipped').length,
        errors: items.filter((x) => x.outcome === 'failed').length,
        savedBytes: items.reduce(
          (s, x) => s + (x.outcome === 'archived' && x.after !== null ? x.before - x.after : 0),
          0,
        ),
        durationMs: Date.now() - started,
        stoppedEarly,
        items: items.slice(0, 200),
      }
      if (data.trigger !== 'file') await lastRun.set(run, data.userId ?? null)
      announce()
      return { ...run, items: run.items.slice(0, 20) }
    }

    ctx.jobs.define<ArchiveJob>('storage.archive', {
      concurrency: 1,
      retryLimit: 0,
      expireInSeconds: 8 * 3600,
      handler: (data, job) => runArchive(data, job),
    })
    ctx.jobs.define<{ blobId: string }>('storage.restore', {
      concurrency: 2,
      retryLimit: 1,
      handler: async ({ blobId }) => {
        const ok = await archiver.restore(blobId)
        if (!ok) throw new Error('The file could not be restored')
        announce()
        return { restored: blobId }
      },
    })
    ctx.jobs.define<{ dryRun?: boolean; userId?: string | null }>('storage.gc', {
      concurrency: 1,
      retryLimit: 0,
      handler: async ({ dryRun, userId }, job) => {
        const report = await collectGarbage(ctx, { dryRun: !!dryRun, progress: job.progress })
        if (!dryRun) await lastGc.set(report, userId ?? null)
        announce()
        return { ...report, blobs: report.blobs.slice(0, 20) }
      },
    })

    /** Starts an archive pass unless one is already queued or running. */
    const startArchive = async (data: ArchiveJob, title: string) => {
      const busy = (await ctx.tasks.active()).find((t) => t.kind === 'storage.archive')
      if (busy && data.trigger !== 'file') return { taskId: busy.id, alreadyRunning: true }
      const { taskId } = await ctx.jobs.send('storage.archive', data, {
        task: { kind: 'storage.archive', title, createdBy: data.userId ?? null },
      })
      return { taskId, alreadyRunning: false }
    }
    const startGc = async (userId: string | null) => {
      const busy = (await ctx.tasks.active()).find((t) => t.kind === 'storage.gc')
      if (busy) return { taskId: busy.id, alreadyRunning: true }
      const { taskId } = await ctx.jobs.send(
        'storage.gc',
        { userId },
        { task: { kind: 'storage.gc', title: 'Cleaning up unused files', createdBy: userId } },
      )
      return { taskId, alreadyRunning: false }
    }

    // The nightly pass: clean up first (fast), then archive. Runs at policy.runAt in the platform time zone.
    ctx.jobs.define('storage.nightly', {
      retryLimit: 0,
      handler: async () => {
        await startGc(null)
        if (policy.get().enabled) await startArchive({ trigger: 'schedule' }, 'Archiving old media')
        return { ok: true }
      },
    })
    const timeZone = () => ctx.services.platform.timeZone()
    let scheduled = ''
    const schedule = () => {
      const [h, m] = policy.get().runAt.split(':').map(Number) as [number, number]
      const cron = `${m} ${h} * * *`
      const key = `${cron}|${timeZone()}`
      if (key === scheduled) return
      scheduled = key
      ctx.jobs.schedule('storage.nightly', cron, {}, timeZone())
      ctx.log.info({ cron, tz: timeZone() }, 'storage pass scheduled')
    }
    ctx.onStart(schedule)
    ctx.events.on('settings.changed', ({ key }) => {
      if (key === 'storage.archive' || key === 'platform') schedule()
    })

    // ── overview ────────────────────────────────────────────────────────
    const overview = async (): Promise<StorageOverview> => {
      const p = policy.get()
      const [disk, totals, derived, tmp, uploads, candidates, tools, active] = await Promise.all([
        statfs(files.dataDir).catch(() => null),
        blobTotals(ctx),
        folderSize(files.dir('derived')),
        folderSize(files.dir('tmp')),
        folderSize(files.dir('uploads')),
        archiveCandidates(ctx, p).catch(() => []),
        storageTools(),
        ctx.tasks.active(),
      ])
      type Row = (typeof totals)[number]
      const onDisk = (r: Row) => (r.state === 'archived' ? Number(r.archived) : Number(r.size))
      const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0)
      const mediaRows = totals.filter((r) => r.usage === 'media')
      const byKind = new Map<string, { bytes: number; count: number }>()
      for (const r of mediaRows) {
        const k = byKind.get(r.kind) ?? { bytes: 0, count: 0 }
        k.bytes += onDisk(r)
        k.count += r.n
        byKind.set(r.kind, k)
      }
      const byUsage = new Map<string, { bytes: number; count: number }>()
      for (const r of totals) {
        const u = byUsage.get(r.usage) ?? { bytes: 0, count: 0 }
        u.bytes += onDisk(r)
        u.count += r.n
        byUsage.set(r.usage, u)
      }
      const run = active.find((t) => t.kind === 'storage.archive') ?? null
      const archived = totals.filter((r) => r.state === 'archived')
      const last = lastRun.get()
      return {
        disk: {
          total: disk ? disk.blocks * disk.bsize : 0,
          free: disk ? disk.bavail * disk.bsize : 0,
          path: files.dataDir,
        },
        originals: {
          hot: sum(
            mediaRows.filter((r) => r.state !== 'archived'),
            (r) => Number(r.size),
          ),
          archived: sum(
            mediaRows.filter((r) => r.state === 'archived'),
            (r) => Number(r.archived),
          ),
          archivedOriginalSize: sum(
            mediaRows.filter((r) => r.state === 'archived'),
            (r) => Number(r.size),
          ),
        },
        derived,
        attachments: byUsage.get('attachment')?.bytes ?? 0,
        byKind: [...byKind].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.bytes - a.bytes),
        usage: [...byUsage].map(([usage, v]) => ({ usage, ...v })).sort((a, b) => b.bytes - a.bytes),
        temporary: tmp + uploads,
        archivedCount: archived.reduce((s, r) => s + r.n, 0),
        archiveCandidates: { count: candidates.length, bytes: candidates.reduce((s, c) => s + c.size, 0) },
        lastRun: last,
        lastGc: lastGc.get(),
        tools: { zstd: tools.zstd, av1: tools.av1, jxl: tools.jxl, flac: tools.flac },
        policy: p,
        running: run ? { taskId: run.id, progress: run.progress, message: run.message } : null,
        nextRunAt: p.enabled ? nextOccurrence(p.runAt, timeZone()).toISOString() : null,
        timeZone: timeZone(),
      }
    }

    // ── API ─────────────────────────────────────────────────────────────
    const tags = ['Storage']
    const uid = (actor: Actor) => actorUserId(actor)

    route(ctx.api, {
      method: 'get',
      path: '/storage/stats',
      summary: 'Disk usage, archive state, candidates and the last archive / clean-up runs',
      tags,
      access: 'storage.manage',
      response: StorageOverview,
      handler: () => overview(),
    })

    route(ctx.api, {
      method: 'get',
      path: '/storage/policy',
      summary: 'The archive policy',
      tags,
      access: 'storage.manage',
      response: ArchivePolicy,
      handler: () => policy.get(),
    })

    route(ctx.api, {
      method: 'patch',
      path: '/storage/policy',
      summary: 'Change the archive policy (age, nightly time, strategy per kind of file)',
      description:
        'Media older than `afterDays` (measured from their last use) are packed one file at a time: `lossless` (zstd, byte-exact), `av1` (visually lossless re-encode, much smaller), `jxl` (JPEG XL, rebuilds the original JPEG exactly), `flac` (uncompressed audio), or `none`. Thumbnails and previews stay, so archived media remain browsable and downloadable.',
      tags,
      access: 'storage.manage',
      body: ArchivePolicyPatch,
      response: ArchivePolicy,
      handler: async ({ actor, body }) => {
        const cur = policy.get()
        const defined = <T extends object>(o: T | undefined) =>
          Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>
        const { strategies, ...rest } = body
        return policy.set(
          { ...cur, ...defined(rest), strategies: { ...cur.strategies, ...defined(strategies) } },
          uid(actor),
        )
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/storage/archive/run',
      summary: 'Start an archive pass now (queued as a background task)',
      tags,
      access: 'storage.manage',
      response: StorageJobStarted,
      status: 202,
      handler: ({ actor }) => startArchive({ trigger: 'manual', userId: uid(actor) }, 'Archiving old media'),
    })

    route(ctx.api, {
      method: 'post',
      path: '/storage/blobs/{id}/archive',
      summary: 'Archive one file now, whatever its age',
      tags,
      access: 'storage.manage',
      params: IdParams,
      body: z.object({ strategy: ArchiveStrategy.optional() }),
      response: StorageJobStarted,
      status: 202,
      handler: async ({ actor, params, body }) => {
        const blob = await files.get(params.id)
        if (blob.state !== 'hot') throw badRequest(`This file is ${blob.state}`)
        const [c] = await archiveCandidates(ctx, policy.get(), {
          blobIds: [blob.id],
          force: true,
          strategy: body.strategy,
        })
        if (!c)
          throw badRequest(
            'This file cannot be archived now: it is not a media file, is being processed, or is needed by a scheduled post',
          )
        return startArchive(
          { trigger: 'file', blobIds: [blob.id], strategy: body.strategy, userId: uid(actor) },
          `Archiving ${blob.filename}`,
        )
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/storage/blobs/{id}/restore',
      summary: 'Bring an archived file back to regular storage',
      description:
        'Lossless and JPEG XL archives come back as the exact original; AV1 / FLAC archives come back as the archived rendition (the file then describes it). Small files are restored while you wait; big ones become a background task.',
      tags,
      access: 'storage.manage',
      params: IdParams,
      response: RestoreResult,
      handler: async ({ actor, params }) => {
        const blob = await files.get(params.id)
        if (blob.state === 'hot') return { state: 'hot' as const, taskId: null }
        if (blob.state === 'archived' && (blob.archivedSize ?? blob.size) <= INLINE_RESTORE_BYTES) {
          if (!(await archiver.restore(blob.id)))
            throw badRequest('The file could not be restored; see the server log')
          announce()
          return { state: 'hot' as const, taskId: null }
        }
        const { taskId } = await ctx.jobs.send(
          'storage.restore',
          { blobId: blob.id },
          { task: { kind: 'storage.restore', title: `Restoring ${blob.filename}`, createdBy: uid(actor) } },
        )
        return { state: 'restoring' as const, taskId }
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/storage/gc',
      summary: 'Clean up files nothing refers to any more (dryRun lists them without deleting)',
      tags,
      access: 'storage.manage',
      body: z.object({ dryRun: z.boolean().default(false) }),
      response: z.union([GcReport, StorageJobStarted]),
      handler: async ({ actor, body }) =>
        body.dryRun ? collectGarbage(ctx, { dryRun: true }) : startGc(uid(actor)),
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'storage_stats',
      description:
        'Disk usage of Greenlit: free space, hot vs archived originals, previews, attachments, usage per kind of media, how many files are due for archival, the archive policy and the last archive run.',
      input: {},
      access: 'storage.manage',
      readOnly: true,
      handler: async () => {
        const o = await overview()
        return {
          ...o,
          lastRun: o.lastRun ? { ...o.lastRun, items: o.lastRun.items.slice(0, 10) } : null,
          lastGc: o.lastGc ? { ...o.lastGc, blobs: o.lastGc.blobs.slice(0, 10) } : null,
        }
      },
    })
    ctx.mcp.tool({
      name: 'storage_archive_now',
      description:
        'Start the archive pass now instead of waiting for the night: media older than the policy age are packed one file at a time (thumbnails and previews stay). Returns a task id to follow with task_status.',
      input: {},
      access: 'storage.manage',
      handler: async (_i, { actor }) =>
        startArchive({ trigger: 'manual', userId: uid(actor) }, 'Archiving old media'),
    })
  },
})
