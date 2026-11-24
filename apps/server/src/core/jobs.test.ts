import type { Job } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, runMigrations } from './db.ts'
import { type JobDefinition, JobQueue, settleTask } from './jobs.ts'
import { createLogger } from './logger.ts'
import { RealtimeHub } from './realtime.ts'
import { isActive, type TaskPatch, TaskService, type TaskView } from './tasks.ts'

const log = createLogger('silent', false)
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Tasks in memory, with the rule of the real ones: a finished task never changes again. */
class MemoryTasks {
  rows = new Map<string, Partial<TaskView> & { state: TaskView['state'] }>()
  async get(id: string) {
    const row = this.rows.get(id)
    return row ? { id, kind: 'depth.generate', ...row } : null
  }
  async update(id: string, patch: Partial<TaskPatch>) {
    const row = this.rows.get(id)
    if (!row || !isActive(row.state)) return false
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
    return true
  }
}

type Run = (name: string, def: JobDefinition<never>, job: Job<Record<string, unknown>>) => Promise<void>

/** pg-boss's jobs, in memory: what `cancel` looks up and cancels. */
type FakeJob = { id: string; name: string; state: string; data: Record<string, unknown> }

/** A queue that is never started (pg-boss connects on start), to call its runner on hand-made jobs. */
function runner() {
  const tasks = new MemoryTasks()
  const queue = new JobQueue('postgres://nowhere/none', log, tasks as unknown as TaskService, true)
  const run = (queue as unknown as { run: Run }).run.bind(queue)
  const jobs: FakeJob[] = []
  const boss = {
    findJobs: vi.fn(async (name: string, opts: { data: { __taskId: string } }) =>
      jobs.filter((j) => j.name === name && j.data.__taskId === opts.data.__taskId),
    ),
    cancel: vi.fn(async (name: string, id: string) => {
      for (const j of jobs) if (j.name === name && j.id === id) j.state = 'cancelled'
    }),
  }
  ;(queue as unknown as { boss: unknown }).boss = boss
  return { tasks, run, queue, jobs, boss }
}

/** A handler that never reports progress: it ends only when its signal says so. */
const waiting = (seen: { signal?: AbortSignal }) => async (_: unknown, ctx: { signal: AbortSignal }) => {
  seen.signal = ctx.signal
  await new Promise((_, reject) =>
    ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
  )
}

const jobOf = (taskId: string, signal: AbortSignal, retryCount = 0) =>
  ({ id: 'j1', name: 'depth.generate', data: { __taskId: taskId }, retryCount, signal }) as unknown as Job<
    Record<string, unknown>
  >

/** A handler like a depth map of a video: reports progress until it is done or told to stop. */
const working =
  (steps: number, seen: { signal?: AbortSignal }) =>
  async (_: unknown, ctx: { progress: (x: number) => Promise<void>; signal: AbortSignal }) => {
    seen.signal = ctx.signal
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 5))
      await ctx.progress(i / steps)
      if (ctx.signal.aborted) throw new Error('Cancelled')
    }
    return { made: 'map' }
  }

describe('background jobs and their tasks', () => {
  it('stops the work when pg-boss takes the job back, and the task waits for the retry', async () => {
    const { tasks, run } = runner()
    tasks.rows.set('t', { state: 'queued' })
    const boss = new AbortController()
    const seen: { signal?: AbortSignal } = {}
    const def = {
      retryLimit: 2,
      handler: async (d: unknown, ctx: never) => {
        setTimeout(() => boss.abort(), 20)
        return working(1000, seen)(d, ctx)
      },
    }
    await expect(run('depth.generate', def as never, jobOf('t', boss.signal))).rejects.toThrow('Cancelled')
    expect(seen.signal?.aborted).toBe(true)
    expect(tasks.rows.get('t')).toMatchObject({ state: 'queued', progress: 0 })
    expect(tasks.rows.get('t')?.message).toMatch(/^Trying again/)
  })

  it('leaves a cancelled task cancelled when the work goes on reporting progress, and stops the work', async () => {
    // 23 Nov 2026: the job and task were cancelled by hand; the handler's next progress report made it "running".
    const { tasks, run } = runner()
    tasks.rows.set('t', { state: 'queued' })
    const seen: { signal?: AbortSignal } = {}
    const def = {
      handler: async (d: unknown, ctx: never) => {
        setTimeout(() => {
          tasks.rows.set('t', { state: 'cancelled', message: 'Stopped to free the graphics card' })
        }, 20)
        return working(1000, seen)(d, ctx)
      },
    }
    // Not thrown: pg-boss must not try it again.
    await run('depth.generate', def as never, jobOf('t', new AbortController().signal))
    expect(seen.signal?.aborted).toBe(true)
    expect(tasks.rows.get('t')).toEqual({ state: 'cancelled', message: 'Stopped to free the graphics card' })
  })

  it('fails the task on the last attempt only', async () => {
    const { tasks, run } = runner()
    const def = {
      retryLimit: 2,
      handler: async () => {
        throw new Error('No space left')
      },
    }
    tasks.rows.set('first', { state: 'queued' })
    await expect(run('x', def as never, jobOf('first', new AbortController().signal, 0))).rejects.toThrow()
    expect(tasks.rows.get('first')).toMatchObject({ state: 'queued', message: 'Trying again: No space left' })
    tasks.rows.set('last', { state: 'queued' })
    await expect(run('x', def as never, jobOf('last', new AbortController().signal, 2))).rejects.toThrow()
    expect(tasks.rows.get('last')).toMatchObject({ state: 'failed', error: 'No space left' })
  })

  it('does not redo a job whose task is already finished', async () => {
    const { tasks, run } = runner()
    tasks.rows.set('t', { state: 'done', progress: 1 })
    let ran = false
    const def = {
      handler: async () => {
        ran = true
      },
    }
    await run('x', def as never, jobOf('t', new AbortController().signal, 1))
    expect(ran).toBe(false)
    expect(tasks.rows.get('t')).toEqual({ state: 'done', progress: 1 })
  })

  it('stops work it runs at once when its task is stopped, cancels its job and does not try it again', async () => {
    const { tasks, run, queue, jobs, boss } = runner()
    tasks.rows.set('t', { state: 'queued' })
    jobs.push({ id: 'j1', name: 'depth.generate', state: 'active', data: { __taskId: 't', formatId: 'f' } })
    const seen: { signal?: AbortSignal } = {}
    const onCancel = vi.fn()
    const def = { retryLimit: 2, handler: waiting(seen), onCancel }
    queue.define('depth.generate', def as never)
    const ran = run('depth.generate', def as never, jobOf('t', new AbortController().signal))
    await until(() => tasks.rows.get('t')?.state === 'running')

    expect(await queue.cancel('t', 'Stopped by Ada')).toBe(true)
    // Not thrown (pg-boss must not try it again), and without waiting for a progress report.
    await ran
    expect(seen.signal?.aborted).toBe(true)
    expect(boss.cancel).toHaveBeenCalledWith('depth.generate', 'j1')
    expect(jobs[0]!.state).toBe('cancelled')
    expect(tasks.rows.get('t')).toMatchObject({ state: 'cancelled', message: 'Stopped by Ada' })
    // Its module hears of it, with the job's own data.
    expect(onCancel).toHaveBeenCalledWith({ formatId: 'f' })
  })

  it('cancels a job that is waiting, and tells its module', async () => {
    const { tasks, queue, jobs, boss } = runner()
    tasks.rows.set('t', { state: 'queued' })
    jobs.push({ id: 'j1', name: 'depth.generate', state: 'created', data: { __taskId: 't', formatId: 'f' } })
    const onCancel = vi.fn()
    queue.define('depth.generate', { handler: async () => {}, onCancel })
    expect(await queue.cancel('t')).toBe(true)
    expect(boss.cancel).toHaveBeenCalledWith('depth.generate', 'j1')
    expect(tasks.rows.get('t')).toMatchObject({ state: 'cancelled', message: 'Stopped' })
    expect(onCancel).toHaveBeenCalledWith({ formatId: 'f' })
  })

  it('leaves a task that has finished as it is', async () => {
    const { tasks, queue, jobs, boss } = runner()
    tasks.rows.set('t', { state: 'done', progress: 1 })
    jobs.push({ id: 'j1', name: 'depth.generate', state: 'completed', data: { __taskId: 't' } })
    const onCancel = vi.fn()
    queue.define('depth.generate', { handler: async () => {}, onCancel })
    expect(await queue.cancel('t')).toBe(false)
    expect(await queue.cancel('missing')).toBe(false)
    expect(boss.cancel).not.toHaveBeenCalled()
    expect(tasks.rows.get('t')).toEqual({ state: 'done', progress: 1 })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('settles an unfinished task from the state of its job', () => {
    const running = { state: 'running' as const }
    const queued = { state: 'queued' as const }
    // The task of 23 Nov: running at 33%, its job cancelled.
    expect(settleTask(running, { state: 'cancelled', output: null })).toEqual({ state: 'cancelled' })
    expect(
      settleTask(running, { state: 'failed', output: { value: 'pg-boss shut down while active' } }),
    ).toEqual({
      state: 'failed',
      error: 'pg-boss shut down while active',
    })
    expect(settleTask(running, { state: 'failed', output: { message: 'Out of memory' } })).toMatchObject({
      error: 'Out of memory',
    })
    expect(settleTask(running, { state: 'completed', output: { made: 'x' } })).toEqual({
      state: 'done',
      progress: 1,
      result: { made: 'x' },
    })
    expect(settleTask(running, { state: 'retry', output: null })).toMatchObject({
      state: 'queued',
      progress: 0,
    })
    expect(settleTask(queued, { state: 'retry', output: null })).toBeNull()
    expect(settleTask(queued, { state: 'created', output: null })).toBeNull()
    expect(settleTask(running, { state: 'active', output: null })).toBeNull()
    expect(settleTask(running, null)).toEqual({ state: 'failed', error: 'Its background job is gone' })
  })
})

/**
 * With a database of its own (GREENLIT_TEST_DATABASE_URL, emptied of test.* tasks): the real tasks table and
 * pg-boss, as on 23 Nov 2026.
 */
const url = process.env.GREENLIT_TEST_DATABASE_URL
describe.skipIf(!url)('background jobs on a database', () => {
  const { db, client } = createDb(url ?? 'postgres://unused', log)
  const tasks = new TaskService(db, new RealtimeHub(log))
  const queues: JobQueue[] = []
  const queue = (workers = true) => {
    const q = new JobQueue(url!, log, tasks, workers, { stopGraceMs: 1000 })
    queues.push(q)
    return q
  }
  /** Reports progress every 20 ms for ~30 s, stopping on its signal. */
  const slow = (seen: { signal?: AbortSignal } = {}): JobDefinition<object> => ({
    retryLimit: 2,
    retryDelaySeconds: 1,
    handler: async (_, ctx) => {
      seen.signal = ctx.signal
      for (let i = 1; i <= 1500 && !ctx.signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 20))
        await ctx.progress(i / 1500)
      }
      if (ctx.signal.aborted) throw new Error('Cancelled')
    },
  })
  const task = async (id: string) => (await tasks.get(id))!

  beforeAll(async () => {
    await runMigrations(url!, log)
    await client`delete from tasks where kind like 'test.%'`
  }, 60_000)
  afterAll(async () => {
    for (const q of queues) await q.stop().catch(() => {})
    await client.end()
  })

  it('keeps a task cancelled by hand cancelled while its work winds down', async () => {
    const seen: { signal?: AbortSignal } = {}
    const q = queue()
    q.define('test.cancel', slow(seen))
    await q.start()
    const { taskId } = await q.send('test.cancel', {}, { task: { kind: 'test.cancel', title: 'Slow' } })
    await until(async () => (await task(taskId!)).progress > 0.01)
    // What was run on 23 Nov to free the graphics card.
    await client.begin(async (sql) => {
      await sql`update jobs.job set state = 'cancelled', completed_on = now()
        where name = 'test.cancel' and state in ('created', 'active', 'retry')`
      await sql`update tasks set state = 'cancelled', message = 'Stopped to free the graphics card', updated_at = now()
        where kind = 'test.cancel' and state in ('queued', 'running')`
    })
    await until(() => !!seen.signal?.aborted)
    await q.stop()
    expect(await task(taskId!)).toMatchObject({
      state: 'cancelled',
      message: 'Stopped to free the graphics card',
    })
  }, 30_000)

  it('hands the task back on a restart and finishes it after', async () => {
    const before = queue()
    before.define('test.restart', slow())
    await before.start()
    const { taskId, jobId } = await before.send(
      'test.restart',
      {},
      { task: { kind: 'test.restart', title: 'Slow' } },
    )
    await until(async () => (await task(taskId!)).state === 'running')
    await before.stop()
    expect(await task(taskId!)).toMatchObject({ state: 'queued', progress: 0 })
    const [job] = await client`select state from jobs.job where id = ${jobId!}`
    expect(job!.state).toBe('retry')

    // The new server picks the job up again; this time it is quick.
    const after = queue()
    after.define('test.restart', { retryDelaySeconds: 1, handler: async () => ({ ok: true }) })
    await after.start()
    await until(async () => (await task(taskId!)).state === 'done')
    await after.stop()
  }, 40_000)

  it('stops a running job: at once, cancelled in pg-boss, never tried again', async () => {
    const seen: { signal?: AbortSignal } = {}
    let runs = 0
    const q = queue()
    q.define<object>('test.stop', {
      retryLimit: 2,
      retryDelaySeconds: 1,
      handler: async (d, ctx) => {
        runs++
        return waiting(seen)(d, ctx)
      },
    })
    await q.start()
    const { taskId, jobId } = await q.send('test.stop', {}, { task: { kind: 'test.stop', title: 'Slow' } })
    await until(async () => (await task(taskId!)).state === 'running')
    const at = Date.now()
    expect(await q.cancel(taskId!, 'Stopped from Activity')).toBe(true)
    await until(() => !!seen.signal?.aborted, 2000)
    expect(Date.now() - at).toBeLessThan(1000)
    // Longer than its retry delay: nothing runs it again, and pg-boss keeps it cancelled.
    await new Promise((r) => setTimeout(r, 2500))
    expect(runs).toBe(1)
    const [job] = await client`select state from jobs.job where id = ${jobId!}`
    expect(job!.state).toBe('cancelled')
    expect(await task(taskId!)).toMatchObject({ state: 'cancelled', message: 'Stopped from Activity' })
    expect(await q.cancel(taskId!)).toBe(false)
    await q.stop()
  }, 30_000)

  it('stops work running in another process at its next progress report', async () => {
    const seen: { signal?: AbortSignal } = {}
    const worker = queue()
    worker.define('test.elsewhere', slow(seen))
    await worker.start()
    // The API process: the same jobs, no workers.
    const api = queue(false)
    api.define('test.elsewhere', slow())
    await api.start()
    const { taskId, jobId } = await api.send(
      'test.elsewhere',
      {},
      { task: { kind: 'test.elsewhere', title: 'Slow' } },
    )
    await until(async () => (await task(taskId!)).progress > 0.01)
    expect(await api.cancel(taskId!)).toBe(true)
    await until(() => !!seen.signal?.aborted, 3000)
    await worker.stop()
    const [job] = await client`select state from jobs.job where id = ${jobId!}`
    expect(job!.state).toBe('cancelled')
    expect(await task(taskId!)).toMatchObject({ state: 'cancelled' })
    await api.stop()
  }, 30_000)

  it('cancels a waiting job, and its module hears of it', async () => {
    const onCancel = vi.fn()
    const q = queue(false)
    q.define<{ formatId: string }>('test.waiting', { handler: async () => {}, onCancel })
    await q.start()
    const { taskId, jobId } = await q.send(
      'test.waiting',
      { formatId: 'f1' },
      { task: { kind: 'test.waiting', title: 'Waiting' } },
    )
    expect(await q.cancel(taskId!)).toBe(true)
    const [job] = await client`select state from jobs.job where id = ${jobId!}`
    expect(job!.state).toBe('cancelled')
    expect(await task(taskId!)).toMatchObject({ state: 'cancelled' })
    expect(onCancel).toHaveBeenCalledWith({ formatId: 'f1' })
    await q.stop()
  }, 30_000)

  it('lists every task a page at a time, by state, kind and title', async () => {
    // Queued together, as queueMany does: several can share a millisecond.
    const ids = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => tasks.create({ kind: 'test.list', title: `Depth map ${i}_%` })),
    )
    await tasks.update(ids[0]!, { state: 'done' })
    await tasks.update(ids[1]!, { state: 'failed', error: 'Out of memory' })
    await tasks.update(ids[2]!, { state: 'cancelled' })
    const seen: string[] = []
    let before: string | undefined
    for (let i = 0; i < 4; i++) {
      const page = await tasks.list({ kind: 'test.list', limit: 2, before })
      seen.push(...page.items.map((t) => t.id))
      expect(page.counts).toEqual({ all: 6, active: 3, done: 1, failed: 1, cancelled: 1 })
      if (!page.next) break
      before = page.next
    }
    // Every task once, newest first.
    expect(seen.toSorted()).toEqual(ids.toSorted())
    const all = (await tasks.list({ kind: 'test.list' })).items
    expect(all.map((t) => t.id)).toEqual(seen)
    expect(all.map((t) => Date.parse(t.createdAt))).toEqual(
      all.map((t) => Date.parse(t.createdAt)).toSorted((a, b) => b - a),
    )
    expect((await tasks.list({ kind: 'test.list', state: 'active' })).items).toHaveLength(3)
    expect((await tasks.list({ kind: 'test.list', state: 'failed' })).items[0]).toMatchObject({
      id: ids[1],
      error: 'Out of memory',
    })
    // A search is plain text: % and _ are no wildcards.
    expect((await tasks.list({ kind: 'test.list', q: 'map 4_%' })).items.map((t) => t.id)).toEqual([ids[4]])
    expect((await tasks.list({ kind: 'test.list', q: 'map _' })).items).toHaveLength(0)
    expect((await tasks.list()).kinds).toContainEqual({ kind: 'test.list', count: 6 })
    // No job behind them: finished, so the tests below see only their own.
    for (const id of ids) await tasks.update(id, { state: 'done' })
  })

  it('settles the tasks a stopped or killed server left unfinished when it starts', async () => {
    const send = queue(false)
    for (const n of ['test.cancelled', 'test.retry', 'test.failed', 'test.gone']) send.define(n, slow())
    await send.start()
    const sent = async (name: string) =>
      (await send.send(name, {}, { task: { kind: name, title: name } })) as { jobId: string; taskId: string }
    const cancelled = await sent('test.cancelled')
    const retry = await sent('test.retry')
    const failed = await sent('test.failed')
    const gone = await sent('test.gone')
    await send.stop()
    // The rows a killed server leaves: tasks "running" (2 minutes ago), their jobs in every other state.
    const stale = [cancelled, retry, failed, gone].map((s) => s.taskId)
    await client`update tasks set state = 'running', progress = 0.33, updated_at = now() - interval '2 minutes',
      created_at = now() - interval '2 minutes' where id in ${client(stale)}`
    await client`update jobs.job set state = 'cancelled' where id = ${cancelled.jobId}`
    await client`update jobs.job set state = 'retry', start_after = now() + interval '1 hour' where id = ${retry.jobId}`
    await client`update jobs.job set state = 'failed', output = ${JSON.stringify({ message: 'Out of memory' })}::jsonb
      where id = ${failed.jobId}`
    await client`delete from jobs.job where id = ${gone.jobId}`

    const restarted = queue()
    const onCancel = vi.fn()
    for (const n of ['test.cancelled', 'test.retry', 'test.failed', 'test.gone'])
      restarted.define(n, { ...slow(), onCancel })
    await restarted.start()
    expect(await task(cancelled.taskId)).toMatchObject({ state: 'cancelled' })
    // Cancelled by hand while it waited: its module forgets it too.
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(await task(retry.taskId)).toMatchObject({ state: 'queued', progress: 0 })
    expect(await task(failed.taskId)).toMatchObject({ state: 'failed', error: 'Out of memory' })
    expect(await task(gone.taskId)).toMatchObject({ state: 'failed', error: 'Its background job is gone' })
    expect((await tasks.active()).filter((t) => t.kind.startsWith('test.')).map((t) => t.id)).toEqual([
      retry.taskId,
    ])
    await restarted.stop()
  }, 40_000)
})
