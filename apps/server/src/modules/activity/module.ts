import { z } from 'zod'
import { notFound } from '../../core/errors.ts'
import { IdParams, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'

const TaskView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  state: z.string(),
  progress: z.number(),
  message: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  error: z.string().nullable(),
  result: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export default defineModule({
  id: 'activity',
  name: 'Activity',
  description: 'Background work you can follow: processing, renders, publishing, archival.',
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

    ctx.mcp.tool({
      name: 'task_status',
      description:
        'Progress of a background task (render, processing, publishing). Poll it after starting long work.',
      input: { id: z.uuid() },
      access: 'signed-in',
      readOnly: true,
      handler: async ({ id }) => (await ctx.tasks.get(id)) ?? { error: 'not found' },
    })
  },
})
