import { and, desc, eq, inArray, lt } from 'drizzle-orm'
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
  error: string | null
  result: unknown
  createdAt: string
  updatedAt: string
}

const toView = (r: typeof tasks.$inferSelect): TaskView => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  state: r.state as TaskState,
  progress: r.progress,
  message: r.message,
  entityType: r.entityType,
  entityId: r.entityId,
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

export const isActive = (state: string) => (ACTIVE_STATES as readonly string[]).includes(state)
