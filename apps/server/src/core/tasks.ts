import { and, count, desc, eq, ilike, inArray, lt, type SQL, sql } from 'drizzle-orm'
import type { Db } from './db.ts'
import type { RealtimeHub } from './realtime.ts'
import { tasks } from './schema.ts'

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** Waiting or being worked on. Every other state is final. */
export const ACTIVE_STATES = ['queued', 'running'] as const satisfies TaskState[]

export interface TaskPatch {
  state: TaskState
  progress: number
  message: string
  result: unknown
  error: string
}

export interface TaskView {
  id: string
  kind: string
  title: string
  state: TaskState
  progress: number
  message: string
  entityType: string | null
  entityId: string | null
  /** Who started it (null: Greenlit itself, an upload's processing, a schedule). */
  createdBy: string | null
  error: string | null
  result: unknown
  createdAt: string
  updatedAt: string
}

/** What the Activity page filters by: "active" is queued or running. */
export type TaskFilter = 'active' | 'done' | 'failed' | 'cancelled'

const toView = (r: typeof tasks.$inferSelect): TaskView => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  state: r.state as TaskState,
  progress: r.progress,
  message: r.message,
  entityType: r.entityType,
  entityId: r.entityId,
  createdBy: r.createdBy,
  error: r.error,
  result: r.result,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

/** Progress records for background work, pushed live to the activity panel. */
export class TaskService {
  private lastPush = new Map<string, number>()
  private db: Db
  private realtime: RealtimeHub
  constructor(db: Db, realtime: RealtimeHub) {
    this.db = db
    this.realtime = realtime
  }

  async create(t: {
    kind: string
    title: string
    entityType?: string
    entityId?: string
    createdBy?: string | null
  }) {
    const [row] = await this.db
      .insert(tasks)
      .values({
        kind: t.kind,
        title: t.title,
        entityType: t.entityType,
        entityId: t.entityId,
        createdBy: t.createdBy ?? null,
      })
      .returning()
    this.push(toView(row!))
    return row!.id
  }

  /**
   * Changes a task that is still waiting or running. A finished one (done, failed, cancelled) is never changed
   * again, so work that was stopped and still reports progress can't make it "running" once more. Returns false
   * when nothing changed: the task is finished or gone, or (`notUpdatedSince`) it was updated after that moment.
   * With `throttle` (progress), at most ~4 updates a second per task are written; the others count as done.
   */
  async update(
    id: string,
    patch: Partial<TaskPatch>,
    opts: { throttle?: boolean; notUpdatedSince?: Date } = {},
  ): Promise<boolean> {
    const now = Date.now()
    if (opts.throttle && now - (this.lastPush.get(id) ?? 0) < 250) return true
    this.lastPush.set(id, now)
    const [row] = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date(now) })
      .where(
        and(
          eq(tasks.id, id),
          inArray(tasks.state, ACTIVE_STATES),
          opts.notUpdatedSince ? lt(tasks.updatedAt, opts.notUpdatedSince) : undefined,
        ),
      )
      .returning()
    if (!row || !isActive(row.state)) this.lastPush.delete(id)
    if (!row) return false
    this.push(toView(row))
    return true
  }

  async get(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id))
    return row ? toView(row) : null
  }

  async recent(limit = 30) {
    const rows = await this.db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(limit)
    return rows.map(toView)
  }

  /**
   * Every task, newest first, a page at a time (`before`: the `next` of the previous page), with how many there are
   * of each state and kind (for the same kind and search, any state).
   */
  async list(opts: { state?: TaskFilter; kind?: string; q?: string; before?: string; limit?: number } = {}) {
    const limit = opts.limit ?? 50
    const q = opts.q?.trim()
    const scope = [
      opts.kind ? eq(tasks.kind, opts.kind) : undefined,
      q ? ilike(tasks.title, `%${q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    ]
    const states: Record<TaskFilter, readonly TaskState[]> = {
      active: ACTIVE_STATES,
      done: ['done'],
      failed: ['failed'],
      cancelled: ['cancelled'],
    }
    // In the milliseconds a page's `next` carries (tasks queued together can share one), then by id.
    const at = sql`date_trunc('milliseconds', ${tasks.createdAt})`
    const cursor = parseCursor(opts.before)
    const where: (SQL | undefined)[] = [
      ...scope,
      opts.state ? inArray(tasks.state, states[opts.state]) : undefined,
      cursor ? sql`(${at}, ${tasks.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
    ]
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(desc(at), desc(tasks.id))
      .limit(limit + 1)
    const byState = await this.db
      .select({ state: tasks.state, n: count() })
      .from(tasks)
      .where(and(...scope))
      .groupBy(tasks.state)
    const byKind = await this.db
      .select({ kind: tasks.kind, n: count() })
      .from(tasks)
      .groupBy(tasks.kind)
      .orderBy(desc(count()))
    const n = (...s: readonly string[]) =>
      byState.filter((r) => s.includes(r.state)).reduce((a, r) => a + r.n, 0)
    const items = rows.slice(0, limit).map(toView)
    return {
      items,
      next: rows.length > limit && items.length ? `${items.at(-1)!.createdAt}_${items.at(-1)!.id}` : null,
      counts: {
        all: n(...byState.map((r) => r.state)),
        active: n(...ACTIVE_STATES),
        done: n('done'),
        failed: n('failed'),
        cancelled: n('cancelled'),
      },
      kinds: byKind.map((r) => ({ kind: r.kind, count: r.n })),
    }
  }

  async active() {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(inArray(tasks.state, ACTIVE_STATES))
      .orderBy(desc(tasks.createdAt))
    return rows.map(toView)
  }

  private push(view: TaskView) {
    this.realtime.publish('tasks', 'task.updated', view)
    if (view.entityType && view.entityId) {
      this.realtime.publish(`${view.entityType}:${view.entityId}`, 'task.updated', view)
    }
  }
}

/** A page's `next`: the createdAt (ISO, in milliseconds) and id of its last task. */
function parseCursor(cursor: string | undefined) {
  const m = cursor?.match(/^(.+)_([0-9a-f-]{36})$/i)
  if (!m || Number.isNaN(Date.parse(m[1]!))) return null
  return { at: new Date(m[1]!).toISOString(), id: m[2]! }
}

export const isActive = (state: string) => (ACTIVE_STATES as readonly string[]).includes(state)
