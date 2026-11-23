import { desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './db.ts'
import type { RealtimeHub } from './realtime.ts'
import { tasks } from './schema.ts'

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

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

  async update(
    id: string,
    patch: Partial<{ state: TaskState; progress: number; message: string; result: unknown; error: string }>,
  ) {
    // Progress-only updates are throttled to ~4 per second per task.
    const now = Date.now()
    const onlyProgress = patch.state === 'running' && patch.result === undefined && patch.error === undefined
    if (onlyProgress && now - (this.lastPush.get(id) ?? 0) < 250) return
    this.lastPush.set(id, now)
    const [row] = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
    if (row) this.push(toView(row))
    if (patch.state === 'done' || patch.state === 'failed') this.lastPush.delete(id)
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
      .where(inArray(tasks.state, ['queued', 'running']))
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
