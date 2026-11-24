import { type Job, type JobWithMetadata, PgBoss } from 'pg-boss'
import type { Logger } from './logger.ts'
import type { TaskPatch, TaskService, TaskView } from './tasks.ts'

export interface JobContext {
  job: Job<unknown>
  log: Logger
  /** Report progress (0..1) on the task attached to this job, if any. */
  progress: (fraction: number, message?: string) => Promise<void>
  /**
   * Aborted when the work should stop: pg-boss took the job back (a shutdown's grace ran out, the job timed out, its
   * claim is gone) or its task was stopped.
   */
  signal: AbortSignal
}

export interface JobDefinition<T> {
  handler: (data: T, ctx: JobContext) => Promise<unknown>
  concurrency?: number
  retryLimit?: number
  retryDelaySeconds?: number
  expireInSeconds?: number
}

export interface SendOptions {
  startAfter?: Date | number
  singletonKey?: string
  /** Create a visible task (shown in the activity panel) for this job. Its kind is the job's name. */
  task?: { kind: string; title: string; entityType?: string; entityId?: string; createdBy?: string | null }
  priority?: number
}

/** A task whose job pg-boss will run again (after a restart, or a failure with retries left). */
const AGAIN = 'Stopped by a restart: it starts again shortly'

/** How often unfinished tasks are checked against their jobs (see `sweep`). */
const SWEEP_MS = 5 * 60_000

/** A task this young may have a job that isn't stored yet (`send` makes the task first). */
const JOB_STORED_MS = 60_000

/** A job as findJobs returns it: its output is null until it finishes (and when the handler returned nothing). */
type JobRecord = { state: JobWithMetadata['state']; output?: unknown }

/** pg-boss keeps a failure as the error (`message`) or as `{ value }` (its own reasons, like a shutdown). */
function errorOf(output: unknown): string | null {
  if (typeof output === 'string') return output || null
  if (!output || typeof output !== 'object') return null
  const o = output as { message?: unknown; value?: unknown }
  return typeof o.message === 'string' ? o.message : errorOf(o.value)
}

/**
 * What an unfinished task (queued or running) should say when no worker reports on it, from the pg-boss job behind
 * it (null: gone, past its retention or never stored). Null when it is right as it is: a job that is active (a
 * worker has it, or pg-boss hands it back when it times out), or waiting while its task waits too.
 */
export function settleTask(task: Pick<TaskView, 'state'>, job: JobRecord | null): Partial<TaskPatch> | null {
  if (!job) return { state: 'failed', error: 'Its background job is gone' }
  switch (job.state) {
    case 'completed':
      return { state: 'done', progress: 1, result: job.output ?? null }
    case 'failed':
      return { state: 'failed', error: errorOf(job.output) ?? 'It failed' }
    case 'cancelled':
      return { state: 'cancelled' }
    case 'created':
    case 'retry':
      return task.state === 'running' ? { state: 'queued', progress: 0, message: AGAIN } : null
    default:
      return null
  }
}

/** Background work on pg-boss (Postgres only — no Redis to run). */
export class JobQueue {
  private boss: PgBoss
  private defs = new Map<string, JobDefinition<never>>()
  private schedules: { name: string; cron: string; data: object; tz: string }[] = []
  private started = false
  private stopping = false
  private sweeper: ReturnType<typeof setInterval> | null = null
  private sweeping = false
  /** Jobs with a task this process is working on: the task, and whether pg-boss tries the job again if it fails. */
  private readonly running = new Map<string, { taskId: string; again: boolean }>()

  private log: Logger
  private tasks: TaskService
  private runWorkers: boolean
  /** How long a stop waits for handlers before pg-boss takes their jobs back (compose gives the app 40 s). */
  private stopGraceMs: number
  constructor(
    url: string,
    log: Logger,
    tasks: TaskService,
    runWorkers: boolean,
    opts: { stopGraceMs?: number } = {},
  ) {
    this.log = log
    this.tasks = tasks
    this.runWorkers = runWorkers
    this.stopGraceMs = opts.stopGraceMs ?? 20_000

    this.boss = new PgBoss({ connectionString: url, schema: 'jobs' })
    this.boss.on('error', (err) => log.error({ err }, 'job queue error'))
  }

  define<T>(name: string, def: JobDefinition<T>) {
    if (this.defs.has(name)) throw new Error(`Job ${name} defined twice`)
    this.defs.set(name, def as JobDefinition<never>)
  }

  /** Cron in the platform time zone, e.g. ('storage.archive', '30 3 * * *'). */
  schedule(name: string, cron: string, data: object = {}, tz = 'UTC') {
    this.schedules.push({ name, cron, data, tz })
    if (this.started) void this.boss.schedule(name, cron, data, { tz })
  }

  async send<T extends object>(
    name: string,
    data: T,
    opts: SendOptions = {},
  ): Promise<{ jobId: string | null; taskId: string | null }> {
    let taskId: string | null = null
    if (opts.task) taskId = await this.tasks.create(opts.task)
    const options: Record<string, unknown> = { ...this.retryOptions(name) }
    if (opts.startAfter !== undefined) options.startAfter = opts.startAfter
    if (opts.singletonKey !== undefined) options.singletonKey = opts.singletonKey
    if (opts.priority !== undefined) options.priority = opts.priority
    const jobId = await this.boss.send(name, { ...data, __taskId: taskId }, options)
    // No job was made (one with the same singleton key is already waiting): nothing would ever finish the task.
    if (taskId && !jobId) await this.tasks.update(taskId, { state: 'cancelled', message: 'Already waiting' })
    return { jobId, taskId }
  }

  private retryOptions(name: string) {
    const d = this.defs.get(name)
    return {
      retryLimit: d?.retryLimit ?? 2,
      retryDelay: d?.retryDelaySeconds ?? 30,
      retryBackoff: true,
      expireInSeconds: d?.expireInSeconds ?? 60 * 60 * 6,
    }
  }

  async start() {
    await this.boss.start()
    for (const name of this.defs.keys()) await this.boss.createQueue(name, this.retryOptions(name))
    for (const s of this.schedules) await this.boss.schedule(s.name, s.cron, s.data, { tz: s.tz })
    this.started = true
    // Before any worker starts: tasks a stopped (or killed) server left unfinished say what became of their job.
    await this.sweep()
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS)
    this.sweeper.unref()
    if (!this.runWorkers) return
    for (const [name, def] of this.defs) {
      await this.boss.work<Record<string, unknown>>(
        name,
        // With metadata, a handler knows which attempt it is (retryCount / retryLimit).
        {
          localConcurrency: def.concurrency ?? 1,
          batchSize: 1,
          pollingIntervalSeconds: 1,
          includeMetadata: true,
        },
        async (jobs) => {
          for (const job of jobs) await this.run(name, def, job)
        },
      )
    }
    this.log.info({ queues: this.defs.size }, 'background workers started')
  }

  private async run(
    name: string,
    def: JobDefinition<never>,
    job: Job<Record<string, unknown>> & { retryLimit?: number },
  ) {
    const taskId = (job.data?.__taskId as string | null) ?? null
    const log = this.log.child({ job: name, jobId: job.id })
    // pg-boss aborts job.signal when it takes the job back; ours also stops the work when its task was stopped.
    const controller = new AbortController()
    const signal = job.signal ? AbortSignal.any([job.signal, controller.signal]) : controller.signal
    // The same test as pg-boss's when the job fails: another attempt follows.
    const again = (job.retryCount ?? 0) < (job.retryLimit ?? def.retryLimit ?? 2)
    let taskStopped = false
    const progress = async (fraction: number, message?: string) => {
      // Work that was stopped may still report progress while it winds down: its task has moved on.
      if (!taskId || signal.aborted) return
      if (
        await this.tasks.update(taskId, { state: 'running', progress: fraction, message }, { throttle: true })
      )
        return
      taskStopped = true
      controller.abort(new Error('Its task was stopped'))
    }
    if (taskId) {
      // A retry starts from the beginning; a task that is finished (stopped, or done before a restart) stays so.
      if (!(await this.tasks.update(taskId, { state: 'running', progress: 0, message: '' }))) {
        log.info('its task is finished: skipped')
        return
      }
      this.running.set(job.id, { taskId, again })
    }
    const started = performance.now()
    try {
      const { __taskId: _, ...data } = job.data ?? {}
      const result = await def.handler(data as never, { job, log, progress, signal })
      if (taskId) await this.tasks.update(taskId, { state: 'done', progress: 1, result: result ?? null })
      log.debug({ ms: Math.round(performance.now() - started) }, 'job done')
    } catch (err) {
      // Stopped with its task: done with, not to be tried again.
      if (taskStopped) return void log.info('stopped with its task')
      const message = (err as Error).message
      log.error({ err }, 'job failed')
      if (taskId)
        await this.tasks.update(
          taskId,
          again
            ? { state: 'queued', progress: 0, message: this.stopping ? AGAIN : `Trying again: ${message}` }
            : { state: 'failed', error: message },
        )
      throw err
    } finally {
      this.running.delete(job.id)
    }
  }

  /**
   * Tasks still queued or running whose job nobody works on: a server stopped or killed in the middle of one, a job
   * cancelled or failed outside its handler, or one that is gone. Each takes the state of its job (`settleTask`).
   * Runs on start, before the workers, then every few minutes; a task updated meanwhile is left to its worker.
   */
  async sweep() {
    if (this.sweeping) return
    this.sweeping = true
    const since = new Date()
    try {
      for (const task of await this.tasks.active()) {
        // A task's kind is its job's name: only the jobs defined here can be looked up.
        if (!this.defs.has(task.kind) || Date.parse(task.updatedAt) >= since.getTime()) continue
        const [job] = await this.boss.findJobs(task.kind, { data: { __taskId: task.id }, limit: 1 })
        if (!job && since.getTime() - Date.parse(task.createdAt) < JOB_STORED_MS) continue
        const patch = settleTask(task, job ?? null)
        if (patch && (await this.tasks.update(task.id, patch, { notUpdatedSince: since })))
          this.log.info(
            { task: task.id, kind: task.kind, job: job?.state ?? 'gone', ...patch },
            'unfinished task settled',
          )
      }
    } catch (err) {
      this.log.warn({ err }, 'could not check unfinished tasks')
    } finally {
      this.sweeping = false
    }
  }

  async stop() {
    this.stopping = true
    if (this.sweeper) clearInterval(this.sweeper)
    if (!this.started) return
    // Handlers get 20 s to finish; then pg-boss takes their jobs back (to run again, or failed) and aborts them.
    await this.boss.stop({ graceful: true, timeout: this.stopGraceMs })
    // Work still winding down when the process ends: its task says what pg-boss did with the job.
    await Promise.all(
      [...this.running.values()].map(({ taskId, again }) =>
        this.tasks
          .update(
            taskId,
            again
              ? { state: 'queued', progress: 0, message: AGAIN }
              : { state: 'failed', error: 'Stopped by a restart' },
          )
          .catch(() => false),
      ),
    )
  }
}
