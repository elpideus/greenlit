import {
  type EntityRef,
  type GraphEdge,
  type GraphNode,
  type GraphProject,
  GraphQuery,
  Lineage,
  type LinkableType,
  type LinkRelation,
  lineageOf,
  nodeKey,
  ProductionGraph,
  processSteps,
  type UseSpan,
} from '@greenlit/shared'
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor } from '../../core/actor.ts'
import { notFound } from '../../core/errors.ts'
import { route } from '../../core/http.ts'
import { defineModule, type ModuleContext } from '../../core/module.ts'
import { compositions } from '../compositions/schema.ts'
import { links } from '../links/schema.ts'
import { media } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'

type LinkRow = typeof links.$inferSelect

/** How far the lineage walks each way, and how many items it holds at most. */
const MAX_DEPTH = 24
const MAX_NODES = 400

/**
 * The production graph: the projects' media, the edits and posts made with them and every link between them, for
 * the Graph page; and one item's lineage (what it was made from, back to the camera, and what was made with it) for
 * the viewer's process strip.
 */
export default defineModule({
  id: 'graph',
  name: 'Production graph',
  description: "Every item of the projects and how they were made from one another, and one item's lineage.",
  dependsOn: ['links', 'media', 'projects'],
  after: ['compositions', 'posts'],
  setup(ctx) {
    const svc = build(ctx)
    const tags = ['Graph']

    route(ctx.api, {
      method: 'get',
      path: '/graph',
      summary: 'Every item of the projects and the links between them',
      description:
        'Media of every project (or one, with projectId), the edits and posts linked to them, and the links. Brand kit files are left out unless brandKits=true.',
      tags,
      access: 'links.read',
      query: GraphQuery,
      response: ProductionGraph,
      handler: ({ actor, query }) => svc.graph(actor, query),
    })
    route(ctx.api, {
      method: 'get',
      path: '/graph/lineage',
      summary: "One item's place in the process",
      description:
        'Everything the item was made from (back to the camera), everything made with it (up to the posts), what it is related to, and for each how many other inputs and outputs are left out.',
      tags,
      access: 'links.read',
      query: z.object({ type: z.enum(['media', 'composition', 'post']), id: z.uuid() }),
      response: Lineage,
      handler: ({ actor, query }) => svc.lineage(actor, query),
    })

    ctx.mcp.tool({
      name: 'media_process',
      description:
        "An item's production process: what it was made from, step by step back to the photos and videos taken, and what was made with it (edits, films, posts). type: media | composition | post.",
      input: { type: z.enum(['media', 'composition', 'post']), id: z.uuid() },
      access: 'links.read',
      readOnly: true,
      handler: async (ref, { actor }) => {
        const l = await svc.lineage(actor, ref)
        const name = new Map(l.nodes.map((n) => [nodeKey(n), `${n.title} (${n.type}:${n.id})`]))
        const { steps, related } = processSteps(l.edges)
        return {
          steps: steps.map((s) => ({
            from: name.get(s.up),
            relation: s.relation,
            to: name.get(s.down),
            ...(s.spans.length ? { playsAt: s.spans } : {}),
          })),
          related: related.map(([a, b]) => [name.get(a), name.get(b)]),
          leftOut: Object.fromEntries(Object.entries(l.hidden).map(([k, v]) => [name.get(k) ?? k, v])),
        }
      },
    })
  },
})

function build(ctx: ModuleContext) {
  const { db } = ctx

  /** Ids of brand kits, whose files are the brand an item wears, not what it is made of. */
  const brandProjects = async () =>
    new Set(
      (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.kind, 'brand'), isNull(projects.deletedAt)))
      ).map((r) => r.id),
    )

  /** Every link that touches one of these items. */
  const linksOf = async (refs: EntityRef[]): Promise<LinkRow[]> => {
    const byType = new Map<string, string[]>()
    for (const r of refs) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id])
    if (!byType.size) return []
    const conds: SQL[] = []
    for (const [type, ids] of byType)
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        conds.push(
          and(eq(links.fromType, type), inArray(links.fromId, chunk))!,
          and(eq(links.toType, type), inArray(links.toId, chunk))!,
        )
      }
    return db
      .select()
      .from(links)
      .where(or(...conds))
  }

  /** Where each media item plays in each edit: composition id → media id → spans on the edit's timeline. */
  const spansOf = async (ids: string[]) => {
    const out = new Map<string, Map<string, UseSpan[]>>()
    if (!ids.length) return { spans: out, info: new Map<string, { duration: number | null; at: string }>() }
    const rows = await db
      .select({ id: compositions.id, document: compositions.document, createdAt: compositions.createdAt })
      .from(compositions)
      .where(inArray(compositions.id, ids))
    const info = new Map<string, { duration: number | null; at: string }>()
    for (const r of rows) {
      const doc = r.document as {
        duration?: number
        assets?: Record<string, { mediaId?: string }>
        tracks?: {
          hidden?: boolean
          clips?: { assetId?: string; start?: number; duration?: number; in?: number; hidden?: boolean }[]
        }[]
      }
      info.set(r.id, { duration: doc.duration ?? null, at: r.createdAt.toISOString() })
      const byMedia = new Map<string, UseSpan[]>()
      for (const t of doc.tracks ?? [])
        for (const c of t.clips ?? []) {
          const mediaId = c.assetId ? doc.assets?.[c.assetId]?.mediaId : undefined
          if (!mediaId || c.hidden || t.hidden) continue
          if ((c.start ?? 0) >= (doc.duration ?? Number.POSITIVE_INFINITY)) continue
          byMedia.set(mediaId, [
            ...(byMedia.get(mediaId) ?? []),
            { start: c.start ?? 0, duration: c.duration ?? 0, in: c.in ?? 0 },
          ])
        }
      out.set(r.id, byMedia)
    }
    return { spans: out, info }
  }

  /** Nodes for these items, as far as this person may see them (others are left out). */
  const describe = async (refs: EntityRef[], actor: Actor, brand: Set<string>, brandKits: boolean) => {
    const nodes = new Map<string, GraphNode>()
    const mediaIds = [...new Set(refs.filter((r) => r.type === 'media').map((r) => r.id))]
    for (const m of await ctx.services.media.many(mediaIds, actor)) {
      if (!brandKits && m.projectId && brand.has(m.projectId)) continue
      const primary = m.formats.find((f) => f.isPrimary) ?? m.formats[0]
      nodes.set(nodeKey({ type: 'media', id: m.id }), {
        type: 'media',
        id: m.id,
        title: m.title,
        thumbnailUrl: m.thumbnailUrl,
        kind: m.kind,
        href: `/media/${m.id}`,
        projectId: m.projectId,
        status: m.status,
        at: m.takenAt ?? m.createdAt,
        duration: primary?.duration ?? null,
        versions: Math.max(1, m.versions.length),
        formats: Math.max(1, m.formats.length),
      })
    }
    const others = refs.filter((r) => r.type !== 'media')
    const compIds = [...new Set(others.filter((r) => r.type === 'composition').map((r) => r.id))]
    const { spans, info } = await spansOf(compIds)
    const summaries = await ctx.entities.summarize(others, actor)
    for (const s of summaries.values()) {
      const comp = s.type === 'composition' ? info.get(s.id) : undefined
      nodes.set(nodeKey(s), {
        type: s.type as LinkableType,
        id: s.id,
        title: s.title,
        thumbnailUrl: s.thumbnailUrl,
        kind: s.kind,
        href: s.href,
        projectId: s.projectId,
        status: null,
        at: comp?.at ?? null,
        duration: comp?.duration ?? null,
        versions: 1,
        formats: 1,
      })
    }
    return { nodes, spans }
  }

  const toEdges = (
    rows: LinkRow[],
    nodes: Map<string, GraphNode>,
    spans: Map<string, Map<string, UseSpan[]>>,
  ) => {
    const out: GraphEdge[] = []
    for (const r of rows) {
      const from = { type: r.fromType as LinkableType, id: r.fromId }
      const to = { type: r.toType as LinkableType, id: r.toId }
      if (!nodes.has(nodeKey(from)) || !nodes.has(nodeKey(to))) continue
      out.push({
        id: r.id,
        from,
        to,
        relation: r.relation as LinkRelation,
        auto: r.auto,
        spans:
          r.relation === 'uses' && from.type === 'composition' && to.type === 'media'
            ? (spans.get(from.id)?.get(to.id) ?? [])
            : [],
      })
    }
    return out
  }

  const projectList = async (ids: string[], actor: Actor): Promise<GraphProject[]> => {
    if (!ids.length) return []
    const rows = await db
      .select({ id: projects.id, name: projects.name, kind: projects.kind })
      .from(projects)
      .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)))
    const visible = await ctx.entities.summarize(
      rows.map((r) => ({ type: 'project', id: r.id })),
      actor,
    )
    return rows
      .filter((r) => visible.has(`project:${r.id}`))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind as GraphProject['kind'] }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    async graph(actor: Actor, q: z.infer<typeof GraphQuery>) {
      const brand = await brandProjects()
      const brandKits = q.brandKits ?? false
      if (q.projectId && !(await ctx.entities.canView('project', q.projectId, actor))) throw notFound()
      // One project, or every project (brand kits only when asked) and the items in none.
      const where = [isNull(media.deletedAt), await ctx.services.media.visibleWhere(actor)]
      if (q.projectId) where.push(eq(media.projectId, q.projectId))
      const rows = await db
        .select({ id: media.id, projectId: media.projectId })
        .from(media)
        .where(and(...where))
      const own = rows.filter((r) => brandKits || q.projectId || !r.projectId || !brand.has(r.projectId))
      const compRows = await db
        .select({ id: compositions.id })
        .from(compositions)
        .where(
          and(
            isNull(compositions.deletedAt),
            q.projectId ? eq(compositions.projectId, q.projectId) : undefined,
          ),
        )
      const seeds: EntityRef[] = [
        ...own.map((r) => ({ type: 'media' as const, id: r.id })),
        ...compRows.map((r) => ({ type: 'composition' as const, id: r.id })),
      ]
      const linkRows = await linksOf(seeds)
      const refs = new Map(seeds.map((s) => [nodeKey(s), s]))
      for (const r of linkRows) {
        refs.set(`${r.fromType}:${r.fromId}`, { type: r.fromType as LinkableType, id: r.fromId })
        refs.set(`${r.toType}:${r.toId}`, { type: r.toType as LinkableType, id: r.toId })
      }
      const { nodes, spans } = await describe([...refs.values()], actor, brand, brandKits)
      const edges = toEdges(linkRows, nodes, spans)
      const projectIds = [
        ...new Set([...nodes.values()].map((n) => n.projectId).filter((p): p is string => !!p)),
      ]
      return { projects: await projectList(projectIds, actor), nodes: [...nodes.values()], edges }
    },

    async lineage(actor: Actor, focus: EntityRef) {
      if (!(await ctx.entities.canView(focus.type, focus.id, actor))) throw notFound()
      const brand = await brandProjects()
      const fetched = new Map<string, LinkRow>()
      const touched = new Set<string>()
      const refOf = new Map<string, EntityRef>([[nodeKey(focus), focus]])
      // Walk one way (up: what each item was made from; down: what was made with it), fetching every link of each
      // item reached, so its other inputs and outputs can be counted.
      const walk = async (side: 'up' | 'down') => {
        let frontier: EntityRef[] = [focus]
        const seen = new Set([nodeKey(focus)])
        for (let depth = 0; depth < MAX_DEPTH && frontier.length && seen.size < MAX_NODES; depth++) {
          const todo = frontier.filter((r) => !touched.has(`${side}:${nodeKey(r)}`))
          for (const r of todo) touched.add(`${side}:${nodeKey(r)}`)
          const rows = await linksOf(todo)
          for (const r of rows) fetched.set(r.id, r)
          const here = new Set(frontier.map(nodeKey))
          const next: EntityRef[] = []
          for (const s of processSteps(toRaw(rows)).steps) {
            const [from, to] = side === 'up' ? [s.down, s.up] : [s.up, s.down]
            if (!here.has(from) || seen.has(to)) continue
            seen.add(to)
            const ref = parseKey(to)
            refOf.set(to, ref)
            next.push(ref)
          }
          frontier = next
        }
      }
      await walk('up')
      await walk('down')
      const all = [...fetched.values()]
      for (const r of all) {
        refOf.set(`${r.fromType}:${r.fromId}`, { type: r.fromType as LinkableType, id: r.fromId })
        refOf.set(`${r.toType}:${r.toId}`, { type: r.toType as LinkableType, id: r.toId })
      }
      // Brand kit files stay out, unless the item is one.
      const fk = nodeKey(focus)
      const self = (await describe([focus], actor, brand, true)).nodes.get(fk)
      const inKit = !!self?.projectId && brand.has(self.projectId)
      const { nodes, spans } = await describe([...refOf.values()], actor, brand, inKit)
      const edges = toEdges(all, nodes, spans)
      const { steps, related } = processSteps(edges)
      const { up, down } = lineageOf(steps, fk)
      const keep = new Set([fk, ...up, ...down])
      for (const [a, b] of related) {
        if (a === fk) keep.add(b)
        if (b === fk) keep.add(a)
      }
      const hidden: Record<string, { inputs: number; outputs: number }> = {}
      for (const s of steps) {
        if (keep.has(s.down) && !keep.has(s.up)) {
          hidden[s.down] ??= { inputs: 0, outputs: 0 }
          hidden[s.down]!.inputs++
        }
        if (keep.has(s.up) && !keep.has(s.down)) {
          hidden[s.up] ??= { inputs: 0, outputs: 0 }
          hidden[s.up]!.outputs++
        }
      }
      return {
        focus,
        nodes: [...nodes.values()].filter((n) => keep.has(nodeKey(n))),
        edges: edges.filter((e) => keep.has(nodeKey(e.from)) && keep.has(nodeKey(e.to))),
        hidden,
      }
    },
  }
}

/** Link rows as graph edges (no spans), for reading the process while walking. */
function toRaw(rows: LinkRow[]): GraphEdge[] {
  return rows.map((r) => ({
    id: r.id,
    from: { type: r.fromType as LinkableType, id: r.fromId },
    to: { type: r.toType as LinkableType, id: r.toId },
    relation: r.relation as LinkRelation,
    auto: r.auto,
    spans: [],
  }))
}

function parseKey(k: string): EntityRef {
  const i = k.indexOf(':')
  return { type: k.slice(0, i) as LinkableType, id: k.slice(i + 1) }
}
