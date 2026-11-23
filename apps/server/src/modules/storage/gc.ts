import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GcReport } from '@greenlit/shared/areas/storage-admin'
import { sql } from 'drizzle-orm'
import type { ModuleContext } from '../../core/module.ts'
import { commentAttachments } from '../comments/schema.ts'
import { blobs } from '../files/schema.ts'
import { media, mediaFiles, mediaFormats } from '../media/schema.ts'

/** Unreferenced files are kept this long before they are deleted (uploads in flight, undo windows…). */
export const GC_GRACE_DAYS = 7
/** Blob usages whose references we can see. Anything else is left alone. */
const COLLECTABLE = ['media', 'attachment']
/** Tables that only log or describe blobs, never keep them alive. The rest of the database counts as a reference. */
const NOT_REFERENCES = new Set([
  'blobs',
  'tasks',
  'revisions',
  'media_files',
  'media_formats',
  'comment_attachments',
])
const BATCH = 500

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Deletes blobs (and stray files on disk) that nothing refers to any more. Conservative by design: a blob is
 * only deleted when it is older than the grace period, of a usage we understand, and its id appears nowhere —
 * not in media formats, file history or revisions of existing media, comment attachments, any other module's
 * `storage.references`, nor in any uuid, json or text column anywhere else in the database.
 */
export async function collectGarbage(
  ctx: ModuleContext,
  opts: { dryRun: boolean; progress?: (f: number, m?: string) => Promise<void> },
): Promise<GcReport> {
  const files = ctx.services.files
  const cutoff = new Date(Date.now() - GC_GRACE_DAYS * 86_400_000)
  const report: GcReport = {
    at: new Date().toISOString(),
    dryRun: opts.dryRun,
    removedBlobs: 0,
    removedFiles: 0,
    freedBytes: 0,
    keptRecent: 0,
    keptUnknownUsage: 0,
    blobs: [],
  }

  // 1. Blobs nothing points at.
  const referenced = await referencedBlobIds(ctx)
  type Row = {
    id: string
    usage: string
    filename: string
    state: string
    created_at: Date | string
    bytes: number
  }
  const all = await ctx.db.execute<Row>(sql`
    select id, usage, filename, state, created_at,
      (case when state = 'archived' then coalesce(archived_size, 0) else size end)::float8 as bytes
    from ${blobs}`)
  const orphans: Row[] = []
  for (const b of all) {
    if (referenced.has(b.id)) continue
    if (!COLLECTABLE.includes(b.usage)) {
      report.keptUnknownUsage++
      continue
    }
    if (new Date(b.created_at) > cutoff) {
      report.keptRecent++
      continue
    }
    if (b.state !== 'hot' && b.state !== 'archived') continue
    orphans.push(b)
  }
  const stillOrphans = new Set<string>()
  for (let i = 0; i < orphans.length; i += BATCH) {
    const ids = orphans.slice(i, i + BATCH).map((b) => b.id)
    const found = await scanDatabaseFor(ctx, ids)
    for (const id of ids) if (!found.has(id)) stillOrphans.add(id)
  }
  const toDelete = orphans.filter((b) => stillOrphans.has(b.id))
  let n = 0
  for (const b of toDelete) {
    report.blobs.push({ id: b.id, filename: b.filename, usage: b.usage, bytes: Number(b.bytes) })
    report.freedBytes += Number(b.bytes)
    report.removedBlobs++
    if (!opts.dryRun) {
      await files.remove(b.id)
      ctx.log.info({ blobId: b.id, filename: b.filename, bytes: b.bytes }, 'removed unreferenced file')
    }
    if (++n % 20 === 0)
      await opts.progress?.(
        0.2 + (n / toDelete.length) * 0.6,
        `Removing unused files (${n} of ${toDelete.length})`,
      )
  }
  await opts.progress?.(0.85, 'Looking for stray files')

  // 2. Files on disk without a blob row (crashes between writing a file and recording it, half-finished packs).
  const known = new Set((await ctx.db.select({ id: blobs.id }).from(blobs)).map((r) => r.id))
  const staleBefore = cutoff.getTime()
  const removeStray = async (path: string, recursive = false) => {
    const st = await stat(path).catch(() => null)
    if (!st || st.mtimeMs > staleBefore) return
    report.removedFiles++
    report.freedBytes += st.isFile() ? st.size : 0
    if (!opts.dryRun) await rm(path, { force: true, recursive })
  }
  for (const area of ['blobs', 'archive', 'derived'] as const) {
    const root = files.dir(area)
    for (const shard of await readdir(root).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue
      for (const name of await readdir(join(root, shard)).catch(() => [] as string[])) {
        const id = name.slice(0, 36)
        if (!UUID_RE.test(id)) continue
        const partial = name.includes('.partial') || name.endsWith('.restoring')
        if (known.has(id) && !partial) continue
        // Partial packs and restores of known blobs are only stale once their blob is no longer moving.
        if (known.has(id) && partial) {
          const [row] = await ctx.db.execute<{ state: string }>(
            sql`select state from ${blobs} where id = ${id}::uuid`,
          )
          if (row && (row.state === 'archiving' || row.state === 'restoring')) continue
        }
        await removeStray(join(root, shard, name), area === 'derived')
      }
    }
  }
  // Scratch files and abandoned resumable uploads.
  for (const area of ['tmp', 'uploads'] as const) {
    const root = files.dir(area)
    for (const name of await readdir(root).catch(() => [] as string[]))
      await removeStray(join(root, name), true)
  }
  return report
}

/** Blob ids the known tables and other modules keep alive. */
async function referencedBlobIds(ctx: ModuleContext): Promise<Set<string>> {
  const ids = new Set<string>()
  // Formats (also of media in the trash: they can still be restored).
  for (const r of await ctx.db.selectDistinct({ id: mediaFormats.blobId }).from(mediaFormats)) ids.add(r.id)
  // File history and revisions, as long as their media item exists. Purged media free their files.
  const history = await ctx.db.execute<{ id: string }>(sql`
    select distinct mf.blob_id::text as id from ${mediaFiles} mf where exists (select 1 from ${media} m where m.id = mf.media_id)`)
  for (const r of history) ids.add(r.id)
  const revisions = await ctx.db.execute<{ id: string }>(sql`
    select distinct jsonb_array_elements_text(r.data->'blobIds') as id
    from revisions r
    where r.data ? 'blobIds' and jsonb_typeof(r.data->'blobIds') = 'array'
      and (r.entity_type <> 'media' or exists (select 1 from ${media} m where m.id = r.entity_id))`)
  for (const r of revisions) ids.add(r.id)
  // Comment attachments (the comments module may be switched off; its table still counts).
  const attachments = await ctx.db
    .selectDistinct({ id: commentAttachments.blobId })
    .from(commentAttachments)
    .catch(() => [] as { id: string | null }[])
  for (const r of attachments) if (r.id) ids.add(r.id)
  // Whatever other modules claim.
  for (const list of await ctx.hooks.run('storage.references', {})) for (const id of list) ids.add(id)
  return ids
}

/**
 * Last line of defence: looks for the ids in every other table of the database (uuid and uuid[] columns,
 * json and text columns), so a module that stores a blob id somewhere we do not know about keeps its file.
 */
async function scanDatabaseFor(ctx: ModuleContext, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  if (!ids.length) return found
  const columns = await ctx.db.execute<{
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
  }>(sql`
    select c.table_name, c.column_name, c.data_type, c.udt_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.udt_name in ('uuid', '_uuid', 'jsonb', 'json', 'text', '_text', 'varchar')`)
  const idArray = sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`
  for (const col of columns) {
    if (NOT_REFERENCES.has(col.table_name)) continue
    const left = ids.filter((id) => !found.has(id))
    if (!left.length) break
    const table = sql.identifier(col.table_name)
    const column = sql.identifier(col.column_name)
    let rows: { id: string }[]
    if (col.udt_name === 'uuid') {
      rows = await ctx.db.execute<{ id: string }>(
        sql`select distinct ${column}::text as id from ${table} where ${column}::text = any(${idArray})`,
      )
    } else if (col.udt_name === '_uuid') {
      rows = await ctx.db.execute<{ id: string }>(sql`
        select distinct u::text as id from ${table}, unnest(${column}) u where ${column}::text[] && ${idArray} and u::text = any(${idArray})`)
    } else {
      rows = await ctx.db.execute<{ id: string }>(sql`
        select c.id from unnest(${idArray}) as c(id)
        where exists (select 1 from ${table} t where t.${column}::text like '%' || c.id || '%')`)
    }
    for (const r of rows) found.add(r.id)
  }
  return found
}
