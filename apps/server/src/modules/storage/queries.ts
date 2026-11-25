import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type ArchivePolicy, type ArchiveStrategy, type FileKind, mediaKindFromMime } from '@greenlit/shared'
import { sql } from 'drizzle-orm'
import type { ModuleContext } from '../../core/module.ts'
import { blobs } from '../files/schema.ts'
import { media, mediaFiles, mediaFormats } from '../media/schema.ts'
import { MIN_ARCHIVE_BYTES } from './archiver.ts'

export interface Candidate {
  id: string
  filename: string
  mime: string
  size: number
  kind: FileKind
  lastUsed: Date
}

const KINDS = new Set<FileKind>(['video', 'image', 'audio', 'document', 'design', 'other'])

/**
 * Hot media blobs old enough to archive. "Old" is measured from the last use we can see: the newest of the
 * upload, the media item's last change and the last restore. Blobs whose media is still being processed, is in
 * the trash, or that no media item uses at all (those are for the clean-up) are left out.
 */
export async function archiveCandidates(
  ctx: ModuleContext,
  policy: ArchivePolicy,
  opts: { blobIds?: string[]; force?: boolean; strategy?: ArchiveStrategy; limit?: number } = {},
): Promise<Candidate[]> {
  const cutoff = new Date(Date.now() - policy.afterDays * 86_400_000).toISOString()
  const lastUsed = sql`greatest(b.created_at, coalesce(b.archived_at, b.created_at), max(r.used_at))`
  const rows = await ctx.db.execute<{
    id: string
    filename: string
    mime: string
    size: number
    kind: string | null
    last_used: Date | string
  }>(sql`
    with refs as (
      select f.blob_id, f.kind, m.updated_at as used_at, f.processing_state in ('pending', 'processing') as busy
      from ${mediaFormats} f join ${media} m on m.id = f.media_id
      where m.deleted_at is null
      union all
      select mf.blob_id, null as kind, mf.created_at as used_at, false as busy
      from ${mediaFiles} mf join ${media} m on m.id = mf.media_id
      where m.deleted_at is null
    )
    select b.id, b.filename, b.mime, b.size::float8 as size, max(r.kind) as kind, ${lastUsed} as last_used
    from ${blobs} b join refs r on r.blob_id = b.id
    where b.state = 'hot' and b.usage = 'media' and b.size >= ${MIN_ARCHIVE_BYTES}
    ${
      opts.blobIds?.length
        ? sql`and b.id in (${sql.join(
            opts.blobIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql``
    }
    group by b.id
    having not bool_or(r.busy) ${opts.force ? sql`` : sql`and ${lastUsed} < ${cutoff}::timestamptz`}
    order by last_used asc
    ${opts.limit ? sql`limit ${opts.limit}` : sql``}`)
  let list: Candidate[] = rows.map((r) => {
    const kind = r.kind && KINDS.has(r.kind as FileKind) ? (r.kind as FileKind) : mediaKindFromMime(r.mime)
    return {
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      size: Number(r.size),
      kind,
      lastUsed: new Date(r.last_used),
    }
  })
  if (!opts.strategy) list = list.filter((c) => policy.strategies[c.kind] !== 'none')
  if (policy.skipScheduled && list.length) {
    const busy = new Set((await ctx.hooks.run('storage.inUse', { blobIds: list.map((c) => c.id) })).flat())
    list = list.filter((c) => !busy.has(c.id))
  }
  return list
}

/** Bytes and counts per usage / state / kind, straight from the blob table. */
export async function blobTotals(ctx: ModuleContext) {
  return ctx.db.execute<{
    usage: string
    state: string
    kind: string
    n: number
    size: number
    archived: number
  }>(sql`
    select b.usage, b.state,
      coalesce(
        (select f.kind from ${mediaFormats} f where f.blob_id = b.id limit 1),
        case
          when b.mime = 'application/x-figcraft' then 'design'
          when b.mime like 'video/%' then 'video'
          when b.mime like 'image/%' then 'image'
          when b.mime like 'audio/%' then 'audio'
          when b.mime = 'application/pdf' or b.mime like 'text/%' or b.mime like '%document%'
            or b.mime like '%presentation%' or b.mime like '%spreadsheet%' then 'document'
          else 'other'
        end
      ) as kind,
      count(*)::int as n,
      coalesce(sum(b.size), 0)::float8 as size,
      coalesce(sum(b.archived_size), 0)::float8 as archived
    from ${blobs} b
    group by 1, 2, 3`)
}

/** Total size of everything under a folder (cached for a few minutes: walking big trees is not free). */
const sizeCache = new Map<string, { at: number; bytes: number }>()
export async function folderSize(dir: string, maxAgeMs = 5 * 60_000): Promise<number> {
  const hit = sizeCache.get(dir)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.bytes
  let bytes = 0
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    const files = entries.filter((e) => e.isFile())
    for (let i = 0; i < files.length; i += 256) {
      const sizes = await Promise.all(
        files.slice(i, i + 256).map((e) =>
          stat(join(e.parentPath, e.name))
            .then((s) => s.size)
            .catch(() => 0),
        ),
      )
      for (const s of sizes) bytes += s
    }
  } catch {
    bytes = 0
  }
  sizeCache.set(dir, { at: Date.now(), bytes })
  return bytes
}

export function forgetFolderSizes() {
  sizeCache.clear()
}

/** The UTC instant of the next HH:MM wall-clock time in a time zone. */
export function nextOccurrence(hhmm: string, timeZone: string, from = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d)
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
    return {
      y: get('year'),
      mo: get('month'),
      d: get('day'),
      h: get('hour'),
      mi: get('minute'),
      s: get('second'),
    }
  }
  const offsetAt = (d: Date) => {
    const x = parts(d)
    return Date.UTC(x.y, x.mo - 1, x.d, x.h, x.mi, x.s) - Math.floor(d.getTime() / 1000) * 1000
  }
  const wallToUtc = (y: number, mo: number, d: number) => {
    const guess = Date.UTC(y, mo - 1, d, h, m)
    const first = guess - offsetAt(new Date(guess))
    return new Date(guess - offsetAt(new Date(first)))
  }
  const today = parts(from)
  let next = wallToUtc(today.y, today.mo, today.d)
  if (next.getTime() <= from.getTime()) {
    const tomorrow = new Date(Date.UTC(today.y, today.mo - 1, today.d + 1))
    next = wallToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate())
  }
  return next
}
