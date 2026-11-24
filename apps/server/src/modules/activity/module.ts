import { UserRef } from '@greenlit/shared'
import { z } from 'zod'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { conflict, forbidden, notFound } from '../../core/errors.ts'
import { IdParams, route } from '../../core/http.ts'
import { defineModule, type ModuleContext } from '../../core/module.ts'

const TaskView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  state: z.string(),
  progress: z.number(),
  message: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdBy: z.string().nullable(),
  error: z.string().nullable(),
  result: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const TaskFilter = z.enum(['active', 'done', 'failed', 'cancelled'])

/**
 * Stops a task and its background job (JobQueue.cancel): whoever started it, or an admin. A task that finished
 * already is a conflict.
 */
async function stopTask(ctx: ModuleContext, id: string, actor: Actor) {
  const task = await ctx.tasks.get(id)
  if (!task) throw notFound('No such task')
  const mine = !!task.createdBy && task.createdBy === actorUserId(actor)
  if (!mine && !isAdmin(actor)) throw forbidden('Only whoever started it, or an admin, can stop it')
  const name = actor.kind === 'user' ? actor.user.displayName : (actor.label ?? 'Greenlit')
  if (!(await ctx.jobs.cancel(id, `Stopped by ${name}`))) {
    const now = await ctx.tasks.get(id)
    throw conflict(`It has finished already (${now?.state ?? 'gone'})`, now)
  }
  return (await ctx.tasks.get(id))!
}

export default defineModule({
  id: 'activity',
  name: 'Activity',
  description: 'Background work you can follow: processing, renders, publishing, archival.',
  dependsOn: ['users'],
  permissions: {
    'activity.read': { description: 'See background work', roles: [] },
  },
  setup(ctx) {
    ctx.realtime.guard('tasks', (actor) => actor.kind === 'system' || actor.permissions.has('*'))

    route(ctx.api, {
      method: 'get',
      path: '/tasks',
      summary: 'Running and recent background work',
      tags: ['Activity'],
      access: 'activity.read',
      response: z.object({ active: z.array(TaskView), recent: z.array(TaskView) }),
      handler: async () => ({ active: await ctx.tasks.active(), recent: await ctx.tasks.recent(40) }),
    })

    // Before /tasks/{id}, which would take "history" for an id.
    route(ctx.api, {
      method: 'get',
      path: '/tasks/history',
      summary: 'All background work, newest first, a page at a time',
      description:
        '`before`: the `next` of the previous page. `counts` and `kinds` count every state and kind (counts: for the same kind and search).',
      tags: ['Activity'],
      access: 'activity.read',
      query: z.object({
        state: TaskFilter.optional(),
        kind: z.string().max(100).optional(),
        q: z.string().max(200).optional(),
        before: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      response: z.object({
        items: z.array(TaskView),
        next: z.string().nullable(),
        counts: z.object({
          all: z.number(),
          active: z.number(),
          done: z.number(),
          failed: z.number(),
          cancelled: z.number(),
        }),
        kinds: z.array(z.object({ kind: z.string(), count: z.number() })),
        /** Who started the tasks of this page. */
        people: z.array(UserRef),
      }),
      handler: async ({ query }) => {
        const page = await ctx.tasks.list(query)
        const people = await ctx.services.users.refs(page.items.map((t) => t.createdBy))
        return { ...page, people: [...people.values()] }
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/tasks/{id}',
      summary: 'One background task',
      tags: ['Activity'],
      access: 'signed-in',
      params: IdParams,
      response: TaskView,
      handler: async ({ params }) => {
        const t = await ctx.tasks.get(params.id)
        if (!t) throw notFound('No such task')
        return t
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/tasks/{id}/cancel',
      summary: 'Stop a background task that is waiting or running',
      description:
        'Its job is cancelled and never tried again; work in progress stops within seconds. Whoever started it, or an admin. 409 when it has finished already.',
      tags: ['Activity'],
      access: 'signed-in',
      params: IdParams,
      response: TaskView,
      handler: ({ actor, params }) => stopTask(ctx, params.id, actor),
    })

    ctx.mcp.tool({
      name: 'task_status',
      description:
        'Progress of a background task (render, processing, publishing). Poll it after starting long work.',
      input: { id: z.uuid() },
      access: 'signed-in',
      readOnly: true,
      handler: async ({ id }) => (await ctx.tasks.get(id)) ?? { error: 'not found' },
    })

    ctx.mcp.tool({
      name: 'task_cancel',
      description:
        'Stop a background task that is waiting or running (a depth map, a render, processing...): its job is cancelled and never tried again, and work in progress stops within seconds (a graphics card it used is freed). Only tasks you started, unless you are an admin. Returns the task, now cancelled.',
      input: { id: z.uuid() },
      access: 'signed-in',
      destructive: true,
      handler: ({ id }, { actor }) => stopTask(ctx, id, actor),
    })
  },
})
