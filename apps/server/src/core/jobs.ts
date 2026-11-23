import { type Job, PgBoss } from 'pg-boss'
import type { Logger } from './logger.ts'
import type { TaskService } from './tasks.ts'

export interface JobContext {
  job: Job<unknown>
  log: Logger
  /** Report progress (0..1) on the task attached to this job, if any. */
  progress: (fraction: number, message?: string) => Promise<void>
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
  /** Create a visible task (shown in the activity panel) for this job. */
  task?: { kind: string; title: string; entityType?: string; entityId?: string; createdBy?: string | null }
  priority?: number
}

/** Background work on pg-boss (Postgres only — no Redis to run). */
export class JobQueue {
  private boss: PgBoss
  private defs = new Map<string, JobDefinition<never>>()
  private schedules: { name: string; cron: string; data: object; tz: string }[] = []
  private started = false

  private log: Logger
  private tasks: TaskService
  private runWorkers: boolean
  constructor(url: string, log: Logger, tasks: TaskService, runWorkers: boolean) {
    this.log = log
    this.tasks = tasks
    this.runWorkers = runWorkers

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

  private async run(name: string, def: JobDefinition<never>, job: Job<Record<string, unknown>>) {
    const taskId = (job.data?.__taskId as string | null) ?? null
    const log = this.log.child({ job: name, jobId: job.id })
    const controller = new AbortController()
    const progress = async (fraction: number, message?: string) => {
      if (taskId) await this.tasks.update(taskId, { state: 'running', progress: fraction, message })
    }
    if (taskId) await this.tasks.update(taskId, { state: 'running' })
    const started = performance.now()
    try {
      const { __taskId: _, ...data } = job.data ?? {}
      const result = await def.handler(data as never, { job, log, progress, signal: controller.signal })
      if (taskId) await this.tasks.update(taskId, { state: 'done', progress: 1, result: result ?? null })
      log.debug({ ms: Math.round(performance.now() - started) }, 'job done')
    } catch (err) {
      log.error({ err }, 'job failed')
      if (taskId) await this.tasks.update(taskId, { state: 'failed', error: (err as Error).message })
      throw err
    }
  }

  async stop() {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 20_000 })
  }
}
