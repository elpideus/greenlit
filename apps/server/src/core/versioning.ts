import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { type Actor, actorUserId } from './actor.ts'
import type { Db } from './db.ts'
import { notFound } from './errors.ts'
import type { RealtimeHub } from './realtime.ts'
import { revisions } from './schema.ts'

export interface VersionedEntity<T extends Record<string, unknown>> {
  /** Read the current state as a plain JSON snapshot. */
  snapshot: (id: string) => Promise<T | null>
  /** Write a snapshot back (used by restore). Must record its own revision through the service. */
  restore: (id: string, data: T, actor: Actor, revisionSeq: number) => Promise<void>
  /** Human label per field for change summaries. */
  labels?: Record<string, string>
  /** Fields that never count as a change (timestamps, counters). */
  ignore?: string[]
  /** Merge consecutive edits by the same author within this many seconds into one revision. */
  coalesceSeconds?: number
}

export interface RecordOptions {
  name?: string | null
  note?: string | null
  /** Skip coalescing (e.g. a file upload is always its own version). */
  force?: boolean
}

/**
 * Everything users edit is versioned through here: each change stores a full snapshot plus the fields that
 * changed, so any version can be inspected, compared, named and restored on its own.
 */
export class VersioningService {
  private entities = new Map<string, VersionedEntity<Record<string, unknown>>>()

  private db: Db
  private realtime: RealtimeHub
  constructor(db: Db, realtime: RealtimeHub) {
    this.db = db
    this.realtime = realtime
  }

  register<T extends Record<string, unknown>>(type: string, def: VersionedEntity<T>) {
    this.entities.set(type, def as unknown as VersionedEntity<Record<string, unknown>>)
  }

  types() {
    return [...this.entities.keys()]
  }

  /** Snapshot the entity as it is now and store it if anything changed. Returns the revision seq. */
  async record(type: string, id: string, actor: Actor, opts: RecordOptions = {}): Promise<number | null> {
    const def = this.entities.get(type)
    if (!def) throw new Error(`${type} is not versioned`)
    const data = await def.snapshot(id)
    if (!data) return null
    const [prev] = await this.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.entityType, type), eq(revisions.entityId, id)))
      .orderBy(desc(revisions.seq))
      .limit(1)
    const changed = prev
      ? diffKeys(prev.data as Record<string, unknown>, data, def.ignore ?? [])
      : Object.keys(data)
    if (prev && changed.length === 0 && !opts.name && !opts.note) return prev.seq
    const authorId = actorUserId(actor)
    const summary = summarize(changed, def.labels ?? {}, !prev)
    // Coalesce quick successive edits by the same person into the previous revision.
    const window = def.coalesceSeconds ?? 0
    if (
      prev &&
      !opts.force &&
      !prev.name &&
      window > 0 &&
      prev.authorId === authorId &&
      prev.source === actor.source &&
      Date.now() - prev.updatedAt.getTime() < window * 1000
    ) {
      const merged = [...new Set([...prev.changed, ...changed])]
      await this.db
        .update(revisions)
        .set({
          data,
          changed: merged,
          summary: summarize(merged, def.labels ?? {}, prev.seq === 1),
          updatedAt: new Date(),
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.note ? { note: opts.note } : {}),
        })
        .where(eq(revisions.id, prev.id))
      this.realtime.publish(`${type}:${id}`, 'revision.updated', { seq: prev.seq })
      return prev.seq
    }
    const seq = (prev?.seq ?? 0) + 1
    await this.db.insert(revisions).values({
      entityType: type,
      entityId: id,
      seq,
      authorId,
      source: actor.source,
      changed,
      summary,
      name: opts.name ?? null,
      note: opts.note ?? null,
      data,
    })
    this.realtime.publish(`${type}:${id}`, 'revision.created', { seq })
    return seq
  }

  async list(type: string, id: string, opts: { before?: number; limit?: number } = {}) {
    const where = [eq(revisions.entityType, type), eq(revisions.entityId, id)]
    if (opts.before) where.push(lt(revisions.seq, opts.before))
    return this.db
      .select({
        id: revisions.id,
        seq: revisions.seq,
        authorId: revisions.authorId,
        source: revisions.source,
        changed: revisions.changed,
        summary: revisions.summary,
        name: revisions.name,
        note: revisions.note,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(and(...where))
      .orderBy(desc(revisions.seq))
      .limit(opts.limit ?? 100)
  }

  async get(type: string, id: string, seq: number) {
    const [row] = await this.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.entityType, type), eq(revisions.entityId, id), eq(revisions.seq, seq)))
    if (!row) throw notFound('Version not found')
    return row
  }

  async label(type: string, id: string, seq: number, patch: { name?: string | null; note?: string | null }) {
    const [row] = await this.db
      .update(revisions)
      .set({ ...patch })
      .where(and(eq(revisions.entityType, type), eq(revisions.entityId, id), eq(revisions.seq, seq)))
      .returning()
    if (!row) throw notFound('Version not found')
    this.realtime.publish(`${type}:${id}`, 'revision.updated', { seq })
    return row
  }

  /** Bring an old version back. The restore itself becomes a new version ("Restored version 3"). */
  async restore(type: string, id: string, seq: number, actor: Actor) {
    const def = this.entities.get(type)
    if (!def) throw new Error(`${type} is not versioned`)
    const rev = await this.get(type, id, seq)
    await def.restore(id, rev.data as Record<string, unknown>, actor, seq)
    const newSeq = await this.record(type, id, actor, { force: true })
    if (newSeq) {
      await this.db
        .update(revisions)
        .set({ summary: sql`${`Restored version ${seq}`}` })
        .where(and(eq(revisions.entityType, type), eq(revisions.entityId, id), eq(revisions.seq, newSeq)))
    }
    return newSeq
  }

  /** Blob ids referenced by any revision: they are kept on disk so old file versions stay restorable. */
  async referencedBlobIds(): Promise<Set<string>> {
    const rows = await this.db.execute<{ id: string }>(
      sql`select distinct jsonb_array_elements(data->'blobIds')->>0 as id from revisions where data ? 'blobIds'`,
    )
    return new Set(rows.map((r) => r.id).filter(Boolean))
  }
}

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>, ignore: string[]): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: string[] = []
  for (const k of keys) {
    if (ignore.includes(k)) continue
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k)
  }
  return out
}

function summarize(changed: string[], labels: Record<string, string | undefined>, first: boolean): string {
  if (first) return 'Created'
  if (changed.length === 0) return 'No changes'
  const names = changed.map((k) => labels[k] ?? k)
  if (names.length <= 3) return `Changed ${names.join(', ')}`
  return `Changed ${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}
