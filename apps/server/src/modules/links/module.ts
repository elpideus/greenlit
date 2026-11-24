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
  /**
   * Change a link's relation and/or turn it around (`reverse`: from and to swap). Greenlit's own links can't change
   * (it keeps them in step with the editor, renders and posts). When the result exists already, the two become one.
   */
  change: (id: string, relation: LinkRelation, reverse: boolean) => Promise<void>
  /** Replace every automatic link of one relation from an entity (e.g. the media an editing project uses). */
  syncAuto: (from: EntityRef, relation: LinkRelation, to: EntityRef[]) => Promise<void>
  /** The same, into an entity: replace every automatic link of one relation to it (e.g. the media a render is made from). */
  syncAutoInto: (to: EntityRef, relation: LinkRelation, from: EntityRef[]) => Promise<void>
  list: (ref: EntityRef, actor: Actor) => Promise<Link[]>
}
declare module '../../core/services.ts' {
  interface Services {
    links?: LinksService
  }
}

const ChangeLinkInput = z.object({
  relation: LinkRelation,
  /** Swap from and to ("source of" ⇄ "made from"). */
  reverse: z.boolean().default(false),
})

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
      method: 'patch',
      path: '/links/{id}',
      summary: "Change a link's relation, or turn it around (reverse: from and to swap)",
      tags,
      access: 'links.manage',
      params: IdParams,
      body: ChangeLinkInput,
      response: Ok,
      handler: async ({ params, body }) => {
        await svc.change(params.id, body.relation, body.reverse)
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
      name: 'links_update',
      description:
        "Change a link's relation (id from links_list), or turn it around with reverse: true (from and to swap: " +
        '"source of" becomes "made from"). Links Greenlit added itself (auto) cannot change.',
      input: { id: z.uuid(), ...ChangeLinkInput.shape },
      access: 'links.manage',
      handler: async ({ id, relation, reverse }) => {
        await svc.change(id, relation, reverse)
        return { ok: true }
      },
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

/** Of an entity's automatic links (`otherId`: the far end), those a sync to `want` removes: to anything else. */
export function staleLinks<T extends { type: string; otherId: string }>(
  existing: T[],
  want: EntityRef[],
): T[] {
  const keep = new Set(want.map((t) => `${t.type}:${t.id}`))
  return existing.filter((e) => !keep.has(`${e.type}:${e.otherId}`))
}

function build(ctx: ModuleContext) {
  const { db } = ctx
  const publish = (r: { fromType: string; fromId: string; toType: string; toId: string }) => {
    ctx.realtime.publish(`${r.fromType}:${r.fromId}`, 'links.updated', {})
    ctx.realtime.publish(`${r.toType}:${r.toId}`, 'links.updated', {})
  }
  /**
   * Makes the automatic links of one relation between `end` (on its `side`) and `others` exactly these: missing ones
   * are added, ones to anything else removed. Links people made, and other relations, stay as they are.
   */
  const syncAuto = async (
    side: 'from' | 'to',
    end: EntityRef,
    relation: LinkRelation,
    others: EntityRef[],
  ) => {
    const [endType, endId, otherType, otherId] =
      side === 'from'
        ? [links.fromType, links.fromId, links.toType, links.toId]
        : [links.toType, links.toId, links.fromType, links.fromId]
    const existing = await db
      .select({ id: links.id, type: otherType, otherId })
      .from(links)
      .where(
        and(eq(endType, end.type), eq(endId, end.id), eq(links.relation, relation), eq(links.auto, true)),
      )
    const gone = staleLinks(existing, others)
    for (const e of gone) await db.delete(links).where(eq(links.id, e.id))
    for (const o of others) {
      const [from, to] = side === 'from' ? [end, o] : [o, end]
      await db
        .insert(links)
        .values({ fromType: from.type, fromId: from.id, relation, toType: to.type, toId: to.id, auto: true })
        .onConflictDoNothing()
    }
    if (existing.length || others.length) ctx.realtime.publish(`${end.type}:${end.id}`, 'links.updated', {})
    for (const o of [...others, ...gone.map((e) => ({ type: e.type, id: e.otherId }))])
      ctx.realtime.publish(`${o.type}:${o.id}`, 'links.updated', {})
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
    async change(id: string, relation: LinkRelation, reverse: boolean) {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(links).where(eq(links.id, id)).for('update')
        if (!r) throw notFound()
        if (r.auto) throw badRequest('Greenlit keeps this link itself, so it cannot be changed')
        const ends = reverse
          ? { fromType: r.toType, fromId: r.toId, toType: r.fromType, toId: r.fromId }
          : { fromType: r.fromType, fromId: r.fromId, toType: r.toType, toId: r.toId }
        const [same] = await tx
          .select({ id: links.id })
          .from(links)
          .where(
            and(
              eq(links.fromType, ends.fromType),
              eq(links.fromId, ends.fromId),
              eq(links.relation, relation),
              eq(links.toType, ends.toType),
              eq(links.toId, ends.toId),
            ),
          )
        // That link exists already: keep it and drop this one.
        if (same && same.id !== r.id) await tx.delete(links).where(eq(links.id, r.id))
        else
          await tx
            .update(links)
            .set({ ...ends, relation })
            .where(eq(links.id, r.id))
        return r
      })
      publish(row)
    },
    syncAuto(from: EntityRef, relation: LinkRelation, to: EntityRef[]) {
      return syncAuto('from', from, relation, to)
    },
    syncAutoInto(to: EntityRef, relation: LinkRelation, from: EntityRef[]) {
      return syncAuto('to', to, relation, from)
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
