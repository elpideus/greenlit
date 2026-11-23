import { CreateLinkInput, EntityRef, Link, LinkRelation } from '@greenlit/shared'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, actorUserId } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule, type ModuleContext } from '../../core/module.ts'
import { links } from './schema.ts'

export interface LinksService {
  /** Create (or keep) a link. `auto` links are made by Greenlit itself (editor usage, renders, publishing). */
  link: (
    from: EntityRef,
    relation: LinkRelation,
    to: EntityRef,
    opts?: { auto?: boolean; note?: string; actor?: Actor },
  ) => Promise<void>
  /** Replace every automatic link of one relation from an entity (e.g. the media an editing project uses). */
  syncAuto: (from: EntityRef, relation: LinkRelation, to: EntityRef[]) => Promise<void>
  list: (ref: EntityRef, actor: Actor) => Promise<Link[]>
}
declare module '../../core/services.ts' {
  interface Services {
    links?: LinksService
  }
}

export default defineModule({
  id: 'links',
  name: 'Links',
  description:
    'Relations between media, editing projects, posts and projects (source of, uses, rendered to...).',
  dependsOn: ['users'],
  after: ['media', 'projects'],
  permissions: {
    'links.read': { description: 'See how things are linked', roles: ['reviewer'] },
    'links.manage': { description: 'Add and remove links', roles: [] },
  },
  setup(ctx) {
    const svc = build(ctx)
    ctx.services.provide('links', svc)
    const tags = ['Links']

    ctx.hooks.add('media.decorate', async ({ ids }) => {
      const rows = await ctx.db
        .select({
          id: sql<string>`case when ${links.fromType} = 'media' and ${links.fromId} in (${sql.join(
            ids.map((i) => sql`${i}::uuid`),
            sql`, `,
          )}) then ${links.fromId} else ${links.toId} end`,
          n: sql<number>`count(*)::int`,
        })
        .from(links)
        .where(
          or(
            and(eq(links.fromType, 'media'), inArray(links.fromId, ids)),
            and(eq(links.toType, 'media'), inArray(links.toId, ids)),
          ),
        )
        .groupBy(sql`1`)
      return Object.fromEntries(rows.map((r) => [r.id, { linkCount: r.n }]))
    })

    route(ctx.api, {
      method: 'get',
      path: '/links',
      summary: 'Everything linked to an item, both directions',
      tags,
      access: 'links.read',
      query: EntityRef,
      response: z.array(Link),
      handler: ({ actor, query }) => svc.list(query, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/links',
      summary: 'Link two items',
      tags,
      access: 'links.manage',
      body: CreateLinkInput,
      response: Ok,
      status: 201,
      handler: async ({ actor, body }) => {
        await svc.link(body.from, body.relation, body.to, { note: body.note, actor })
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'delete',
      path: '/links/{id}',
      summary: 'Remove a link',
      tags,
      access: 'links.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ params }) => {
        const [row] = await ctx.db.delete(links).where(eq(links.id, params.id)).returning()
        if (!row) throw notFound()
        svc.publish(row)
        return { ok: true as const }
      },
    })

    ctx.mcp.tool({
      name: 'links_list',
      description:
        'What an item is linked to (sources, renders, where it is used, posts that publish it). type: media | composition | post | project.',
      input: { type: z.enum(['media', 'composition', 'post', 'project']), id: z.uuid() },
      access: 'links.read',
      readOnly: true,
      handler: ({ type, id }, { actor }) => svc.list({ type, id }, actor),
    })
    ctx.mcp.tool({
      name: 'links_create',
      description:
        'Link two items. relation: source_of (from is raw material of to), uses, rendered_to, related, reference_for, published_as.',
      input: { from: EntityRef, relation: LinkRelation, to: EntityRef, note: z.string().optional() },
      access: 'links.manage',
      handler: async ({ from, relation, to, note }, { actor }) => {
        await svc.link(from, relation, to, { note, actor })
        return { ok: true }
      },
    })
  },
})

function build(ctx: ModuleContext) {
  const { db } = ctx
  const publish = (r: { fromType: string; fromId: string; toType: string; toId: string }) => {
    ctx.realtime.publish(`${r.fromType}:${r.fromId}`, 'links.updated', {})
    ctx.realtime.publish(`${r.toType}:${r.toId}`, 'links.updated', {})
  }
  return {
    publish,
    async link(
      from: EntityRef,
      relation: LinkRelation,
      to: EntityRef,
      opts: { auto?: boolean; note?: string; actor?: Actor } = {},
    ) {
      if (from.type === to.type && from.id === to.id) throw badRequest('An item cannot be linked to itself')
      if (opts.actor) {
        const a = opts.actor
        if (
          !(await ctx.entities.canView(from.type, from.id, a)) ||
          !(await ctx.entities.canView(to.type, to.id, a))
        )
          throw notFound()
      }
      await db
        .insert(links)
        .values({
          fromType: from.type,
          fromId: from.id,
          relation,
          toType: to.type,
          toId: to.id,
          note: opts.note ?? '',
          auto: opts.auto ?? false,
          createdBy: opts.actor ? actorUserId(opts.actor) : null,
        })
        .onConflictDoNothing()
      publish({ fromType: from.type, fromId: from.id, toType: to.type, toId: to.id })
    },
    async syncAuto(from: EntityRef, relation: LinkRelation, to: EntityRef[]) {
      const existing = await db
        .select()
        .from(links)
        .where(
          and(
            eq(links.fromType, from.type),
            eq(links.fromId, from.id),
            eq(links.relation, relation),
            eq(links.auto, true),
          ),
        )
      const want = new Set(to.map((t) => `${t.type}:${t.id}`))
      for (const e of existing)
        if (!want.has(`${e.toType}:${e.toId}`)) await db.delete(links).where(eq(links.id, e.id))
      for (const t of to)
        await db
          .insert(links)
          .values({ fromType: from.type, fromId: from.id, relation, toType: t.type, toId: t.id, auto: true })
          .onConflictDoNothing()
      if (existing.length || to.length) ctx.realtime.publish(`${from.type}:${from.id}`, 'links.updated', {})
      for (const t of to) ctx.realtime.publish(`${t.type}:${t.id}`, 'links.updated', {})
    },
    async list(ref: EntityRef, actor: Actor): Promise<Link[]> {
      if (!(await ctx.entities.canView(ref.type, ref.id, actor))) throw notFound()
      const rows = await db
        .select()
        .from(links)
        .where(
          or(
            and(eq(links.fromType, ref.type), eq(links.fromId, ref.id)),
            and(eq(links.toType, ref.type), eq(links.toId, ref.id)),
          ),
        )
      const summaries = await ctx.entities.summarize(
        rows.flatMap((r) => [
          { type: r.fromType, id: r.fromId },
          { type: r.toType, id: r.toId },
        ]),
        actor,
      )
      const out: Link[] = []
      for (const r of rows) {
        const from = summaries.get(`${r.fromType}:${r.fromId}`)
        const to = summaries.get(`${r.toType}:${r.toId}`)
        if (!from || !to) continue // the other end is hidden from this person or gone
        out.push({
          id: r.id,
          from: {
            type: r.fromType as EntityRef['type'],
            id: r.fromId,
            title: from.title,
            thumbnailUrl: from.thumbnailUrl,
            kind: from.kind,
          },
          to: {
            type: r.toType as EntityRef['type'],
            id: r.toId,
            title: to.title,
            thumbnailUrl: to.thumbnailUrl,
            kind: to.kind,
          },
          relation: r.relation as LinkRelation,
          note: r.note,
          auto: r.auto,
          createdAt: r.createdAt.toISOString(),
        })
      }
      return out
    },
  }
}
