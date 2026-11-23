import { DepthAuto, DepthStatus, GenerateDepthInput, GenerateDepthManyInput } from '@greenlit/shared'
import { z } from 'zod'
import { type Actor, actorUserId, assertCan } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import { IdParams, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { type DepthJobData, DepthService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    depth: DepthService
  }
}

const Queued = z.object({ queued: z.number().int() })

export default defineModule({
  id: 'depth',
  name: 'Depth maps',
  description:
    'Makes depth maps of pictures and videos with Depth Anything V2 Small (on the processor, no service needed): on request, or for every new upload.',
  dependsOn: ['media', 'files', 'projects'],
  permissions: {
    'depth.manage': {
      description: 'Turn automatic depth maps on or off, and make them for the whole library',
      roles: [],
    },
  },
  setup(ctx) {
    const svc = new DepthService(ctx)
    ctx.services.provide('depth', svc)

    ctx.jobs.define<DepthJobData>('depth.generate', {
      concurrency: 1,
      // A restart (an update) in the middle of a long video: it starts again.
      retryLimit: 2,
      // A long video takes a while (about 0.4 s a frame).
      expireInSeconds: 6 * 3600,
      handler: (data, job) => svc.run(data, job),
    })
    ctx.events.on('media.processed', ({ formatId }) => svc.onProcessed(formatId))
    // depth:<media id> carries the progress of that item's depth maps.
    ctx.realtime.guard('depth', (actor, topic) => ctx.services.media.canView(topic.split(':')[1]!, actor))
    ctx.hooks.add('media.decorate', ({ ids }) => {
      const jobs = svc.jobsFor(ids)
      return Object.fromEntries(Object.entries(jobs).map(([id, depthJobs]) => [id, { depthJobs }]))
    })

    const tags = ['Depth maps']
    const many = async (body: z.infer<typeof GenerateDepthManyInput>, actor: Actor) => {
      if (body.missing) assertCan(actor, 'depth.manage')
      const ids = body.missing ? await svc.missingIds(body.missing) : (body.ids ?? [])
      if (!ids.length && !body.missing) throw badRequest('Choose some pictures or videos')
      const visible = (await ctx.services.media.many(ids, actor)).map((m) => m.id)
      return { queued: await svc.queueMany(visible, { replace: body.replace }, actor) }
    }

    route(ctx.api, {
      method: 'get',
      path: '/depth/status',
      summary: 'The depth generator: model, automatic setting, what has no depth map yet',
      tags,
      access: 'media.read',
      response: DepthStatus,
      handler: () => svc.status(),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/depth/auto',
      summary: 'Make depth maps for new uploads (pictures and videos, or pictures only)',
      tags,
      access: 'depth.manage',
      body: DepthAuto.partial(),
      response: DepthAuto,
      handler: ({ actor, body }) =>
        svc.auto.set({ ...svc.auto.get(), ...body } as DepthAuto, actorUserId(actor) ?? null),
    })
    route(ctx.api, {
      method: 'post',
      path: '/media/{id}/depth/generate',
      summary: "Make the depth map of one of an item's formats (default: the main version's main format)",
      description:
        "Runs in the background (a task). A depth map that was uploaded is kept unless `replace`; Greenlit's own is made again.",
      tags,
      access: 'media.upload',
      params: IdParams,
      body: GenerateDepthInput,
      response: Queued,
      status: 202,
      handler: async ({ actor, params, body }) => {
        const m = await ctx.services.media.get(params.id, actor)
        const formatId = body.formatId ?? (m.formats.find((f) => f.isPrimary) ?? m.formats[0])?.id
        const all = [...m.formats, ...m.versions.flatMap((v) => v.formats)]
        if (!formatId || !all.some((f) => f.id === formatId)) throw notFound('Format not found')
        const queued = await svc.queue(formatId, { replaceUploaded: body.replace, force: true }, actor)
        return { queued: queued ? 1 : 0 }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/depth/generate',
      summary: 'Make depth maps for many items, or for everything that has none (`missing`)',
      tags,
      access: 'media.upload',
      body: GenerateDepthManyInput,
      response: Queued,
      status: 202,
      handler: ({ actor, body }) => many(body, actor),
    })

    ctx.mcp.tool({
      name: 'depth_generate',
      description:
        "Make depth maps with Greenlit's own model (Depth Anything V2 Small; near is light), in the background: give ids (each item's main version formats) or one id with a format key / version. Uploaded depth maps are kept unless replace:true. They then show in media_get (depthMaps) and media_view with depth:true.",
      input: {
        ids: z.array(z.uuid()).max(500).optional(),
        id: z.uuid().optional(),
        format: z.string().optional().describe('A format key of `id` (default: its main one)'),
        version: z.string().optional().describe('A version key of `id` (default: the main one)'),
        replace: z.boolean().optional(),
      },
      access: 'media.upload',
      handler: async ({ ids, id, format, version, replace }, { actor }) => {
        if (id) {
          const m = await ctx.services.media.get(id, actor)
          const v = version === 'main' ? '' : (version ?? '')
          const fs = v ? (m.versions.find((x) => x.key === v)?.formats ?? []) : m.formats
          const f = fs.find((x) => x.key === format) ?? fs.find((x) => x.isPrimary) ?? fs[0]
          if (!f) throw notFound('No such format')
          return { queued: (await svc.queue(f.id, { replaceUploaded: replace, force: true }, actor)) ? 1 : 0 }
        }
        return many({ ids, replace }, actor)
      },
    })
  },
})
