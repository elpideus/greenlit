import { LabelRevisionInput, Revision } from '@greenlit/shared'
import { z } from 'zod'
import type { Actor } from '../../core/actor.ts'
import { forbidden } from '../../core/errors.ts'
import { route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'

const Params = z.object({ type: z.string().regex(/^[a-z][a-z-]*$/), id: z.uuid() })

export default defineModule({
  id: 'history',
  name: 'Version history',
  description: 'Browse, name, compare and restore versions of anything that is versioned.',
  dependsOn: ['users'],
  permissions: {
    'history.read': { description: 'See the version history of things you can see', roles: ['reviewer'] },
    'history.label': { description: 'Name versions and add notes to them', roles: [] },
    'history.restore': { description: 'Bring back an older version', roles: [] },
  },
  setup(ctx) {
    const { versions, entities, services } = ctx
    const tags = ['History']

    const ensureVisible = async (type: string, id: string, actor: Actor) => {
      if (!(await entities.canView(type, id, actor))) throw forbidden('You cannot see this')
    }

    const toRevision = async (rows: Awaited<ReturnType<typeof versions.list>>) => {
      const refs = await services.users.refs(rows.map((r) => r.authorId))
      return rows.map((r) => ({
        id: r.id,
        entityType: '',
        entityId: '',
        seq: r.seq,
        author: r.authorId ? (refs.get(r.authorId) ?? null) : null,
        source: r.source as Revision['source'],
        changed: r.changed,
        summary: r.summary,
        name: r.name,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      }))
    }

    route(ctx.api, {
      method: 'get',
      path: '/history/{type}/{id}',
      summary: 'Versions of an item, newest first',
      tags,
      access: 'history.read',
      params: Params,
      query: z.object({
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
      response: z.array(Revision),
      handler: async ({ actor, params, query }) => {
        await ensureVisible(params.type, params.id, actor)
        const rows = await versions.list(params.type, params.id, query)
        return (await toRevision(rows)).map((r) => ({ ...r, entityType: params.type, entityId: params.id }))
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/history/{type}/{id}/{seq}',
      summary: 'One version with its full snapshot',
      tags,
      access: 'history.read',
      params: Params.extend({ seq: z.coerce.number().int().min(1) }),
      response: Revision,
      handler: async ({ actor, params }) => {
        await ensureVisible(params.type, params.id, actor)
        const row = await versions.get(params.type, params.id, params.seq)
        const [rev] = await toRevision([row])
        return {
          ...rev!,
          entityType: params.type,
          entityId: params.id,
          data: row.data as Record<string, unknown>,
        }
      },
    })

    route(ctx.api, {
      method: 'patch',
      path: '/history/{type}/{id}/{seq}',
      summary: 'Name a version or add a note',
      tags,
      access: 'history.label',
      params: Params.extend({ seq: z.coerce.number().int().min(1) }),
      body: LabelRevisionInput,
      response: z.object({ ok: z.literal(true) }),
      handler: async ({ params, body }) => {
        await versions.label(params.type, params.id, params.seq, body)
        return { ok: true as const }
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/history/{type}/{id}/{seq}/restore',
      summary: 'Restore this version (creates a new version)',
      tags,
      access: 'history.restore',
      params: Params.extend({ seq: z.coerce.number().int().min(1) }),
      response: z.object({ seq: z.number().nullable() }),
      handler: async ({ actor, params }) => ({
        seq: await versions.restore(params.type, params.id, params.seq, actor),
      }),
    })

    ctx.mcp.tool({
      name: 'history_list',
      description:
        'List versions of a versioned item (type: media, project, post, composition...). Newest first.',
      input: { type: z.string(), id: z.uuid(), limit: z.number().int().max(200).optional() },
      access: 'history.read',
      readOnly: true,
      handler: async (input, { actor }) => {
        await ensureVisible(input.type, input.id, actor)
        return toRevision(await versions.list(input.type, input.id, { limit: input.limit ?? 50 }))
      },
    })
    ctx.mcp.tool({
      name: 'history_restore',
      description:
        'Restore an older version of an item. The restore becomes a new version, so it can be undone.',
      input: { type: z.string(), id: z.uuid(), seq: z.number().int().min(1) },
      access: 'history.restore',
      handler: async (input, { actor }) => ({
        newVersion: await versions.restore(input.type, input.id, input.seq, actor),
      }),
    })
    ctx.mcp.tool({
      name: 'history_label',
      description: 'Give a version a name (e.g. "Sent to client") and/or a note.',
      input: {
        type: z.string(),
        id: z.uuid(),
        seq: z.number().int().min(1),
        name: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      },
      access: 'history.label',
      handler: async (input) => {
        await versions.label(input.type, input.id, input.seq, { name: input.name, note: input.note })
        return { ok: true }
      },
    })
  },
})
