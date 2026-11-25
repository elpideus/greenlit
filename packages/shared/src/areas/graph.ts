import { z } from 'zod'
import { Id, IsoDate } from '../common.ts'
import { EntityRef, LinkableType, LinkRelation } from './links.ts'
import { ProjectKind } from './projects.ts'

/**
 * The production graph: every item of the projects (photos, videos, AI stills, clips, edits, films, posts) and the
 * links between them, read as a process: work flows from what was shot or drawn to what was made with it.
 */

export const GraphNode = z.object({
  type: LinkableType,
  id: Id,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Media kind (video, image, audio, document, design…), or composition / post / project. */
  kind: z.string().nullable(),
  /** Where it opens in the web app. */
  href: z.string(),
  projectId: Id.nullable(),
  /** Media: the review status (draft, in_review, changes_requested, approved). */
  status: z.string().nullable(),
  /** When it was shot (media taken), else made. */
  at: IsoDate.nullable(),
  /** Media and edits: length in seconds. */
  duration: z.number().nullable(),
  /** Media: versions and formats of the main version. */
  versions: z.number().int(),
  formats: z.number().int(),
})
export type GraphNode = z.infer<typeof GraphNode>

/** Where a media item plays on an edit's timeline: `start` and `duration` on the edit, `in` = seconds into the item. */
export const UseSpan = z.object({ start: z.number(), duration: z.number(), in: z.number() })
export type UseSpan = z.infer<typeof UseSpan>

export const GraphEdge = z.object({
  id: Id,
  from: EntityRef,
  to: EntityRef,
  relation: LinkRelation,
  /** Kept by Greenlit itself (editor usage, exports, posts). */
  auto: z.boolean(),
  /** An edit that uses a media item: where it plays in the edit. */
  spans: z.array(UseSpan),
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphProject = z.object({ id: Id, name: z.string(), kind: ProjectKind })
export type GraphProject = z.infer<typeof GraphProject>

export const ProductionGraph = z.object({
  projects: z.array(GraphProject),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
})
export type ProductionGraph = z.infer<typeof ProductionGraph>

export const GraphQuery = z.object({
  /** Only this project's items (and what they are linked to elsewhere). */
  projectId: Id.optional(),
  /** Also brand kits' files (logos, fonts…), left out by default. */
  brandKits: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})

/** One item's place in the process: everything it was made from, everything made with it, and what it relates to. */
export const Lineage = z.object({
  focus: EntityRef,
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  /**
   * Inputs and outputs of each node that the lineage leaves out (the other shots a film is made of, the other
   * edits a clip went into after the film…), by node key.
   */
  hidden: z.record(z.string(), z.object({ inputs: z.number().int(), outputs: z.number().int() })),
})
export type Lineage = z.infer<typeof Lineage>

export const nodeKey = (r: { type: string; id: string }) => `${r.type}:${r.id}`

/**
 * Which way the work flows along a link: from the earlier thing (`up`) to what was made with it (`down`).
 * "A uses B" means B came first; related items have no direction (null).
 */
export function flowOf(e: {
  from: EntityRef
  to: EntityRef
  relation: LinkRelation
}): { up: EntityRef; down: EntityRef } | null {
  switch (e.relation) {
    case 'source_of':
    case 'reference_for':
    case 'rendered_to':
    case 'published_as':
      return { up: e.from, down: e.to }
    case 'uses':
      return { up: e.to, down: e.from }
    default:
      return null
  }
}

/** A step of the process, from `up` to `down` (node keys), made of one or more links between the same two items. */
export interface ProcessStep {
  key: string
  up: string
  down: string
  relation: LinkRelation
  auto: boolean
  spans: UseSpan[]
  /** The links it stands for. */
  links: string[]
}

/** When two links join the same items, the step shows the more telling one ("Published as" over "Uses"). */
const PRIORITY: LinkRelation[] = ['rendered_to', 'published_as', 'source_of', 'reference_for', 'uses']

/**
 * The links read as process steps, tidied for drawing:
 * - one step per pair of items (a post "uses" and "publishes" the same video: one step, "Published as");
 * - an export's own "Made from" links are left out where its edit shows them (clip → edit → export says it, the
 *   direct clip → export line would only cross the drawing);
 * - related links come back apart, as pairs.
 */
export function processSteps(edges: GraphEdge[]): { steps: ProcessStep[]; related: [string, string][] } {
  const byPair = new Map<string, ProcessStep>()
  const related: [string, string][] = []
  const seenRelated = new Set<string>()
  for (const e of edges) {
    const flow = flowOf(e)
    if (!flow) {
      const a = nodeKey(e.from)
      const b = nodeKey(e.to)
      const k = a < b ? `${a}|${b}` : `${b}|${a}`
      if (!seenRelated.has(k)) {
        seenRelated.add(k)
        related.push([a, b])
      }
      continue
    }
    const up = nodeKey(flow.up)
    const down = nodeKey(flow.down)
    if (up === down) continue
    const key = `${up}>${down}`
    const have = byPair.get(key)
    if (!have) {
      byPair.set(key, {
        key,
        up,
        down,
        relation: e.relation,
        auto: e.auto,
        spans: [...e.spans],
        links: [e.id],
      })
      continue
    }
    have.links.push(e.id)
    have.spans.push(...e.spans)
    have.auto = have.auto && e.auto
    if (PRIORITY.indexOf(e.relation) < PRIORITY.indexOf(have.relation)) have.relation = e.relation
  }
  // item → edit → export: drop the export's direct auto "made from" line.
  const downOf = new Map<string, Set<string>>()
  for (const s of byPair.values()) {
    if (!downOf.has(s.up)) downOf.set(s.up, new Set())
    downOf.get(s.up)!.add(s.down)
  }
  for (const s of [...byPair.values()]) {
    if (!s.auto || s.relation !== 'source_of') continue
    const via = [...(downOf.get(s.up) ?? [])].some(
      (mid) => mid.startsWith('composition:') && downOf.get(mid)?.has(s.down),
    )
    if (via) byPair.delete(s.key)
  }
  for (const s of byPair.values()) s.spans.sort((a, b) => a.start - b.start)
  return { steps: [...byPair.values()], related }
}

/**
 * The part of the process an item belongs to: everything upstream of it (what it was made from, and so on back to
 * the camera) and everything downstream (what was made with it, up to the posts). Not the other branches: a clip's
 * lineage holds its still and photo and the film it went into, not the film's other clips.
 */
export function lineageOf(steps: ProcessStep[], focus: string): { up: Set<string>; down: Set<string> } {
  const ups = new Map<string, string[]>()
  const downs = new Map<string, string[]>()
  for (const s of steps) {
    ups.set(s.down, [...(ups.get(s.down) ?? []), s.up])
    downs.set(s.up, [...(downs.get(s.up) ?? []), s.down])
  }
  const walk = (from: string, next: Map<string, string[]>) => {
    const seen = new Set<string>()
    const queue = [from]
    while (queue.length) {
      const k = queue.shift()!
      for (const n of next.get(k) ?? [])
        if (n !== focus && !seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
    }
    return seen
  }
  return { up: walk(focus, ups), down: walk(focus, downs) }
}
