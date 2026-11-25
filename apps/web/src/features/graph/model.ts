import {
  type GraphNode,
  type LinkRelation,
  lineageOf,
  nodeKey,
  type ProcessStep,
  type ProductionGraph,
  processSteps,
} from '@greenlit/shared'

/**
 * Where an item stands in the production, which sets its colour: what was shot or drawn and then used (`source`),
 * what was made from something and went on into something else (`made`), what the work ends in (`final`), posts,
 * edits, and items nothing is linked to yet (`loose`).
 */
export type Stage = 'loose' | 'source' | 'made' | 'final' | 'edit' | 'post'
export const STAGES: Stage[] = ['source', 'made', 'edit', 'final', 'post', 'loose']

export interface GNode {
  key: string
  node: GraphNode
  stage: Stage
  /** Steps of the process from the first source (columns when arranged by process). */
  rank: number
  degree: number
  inputs: number
  outputs: number
  /** World radius. */
  r: number
  /** Project lane / cluster this node is drawn in (its own, or the one of what it publishes). */
  group: string
  // d3-force fields
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GLink {
  key: string
  source: GNode
  target: GNode
  relation: LinkRelation | 'related'
  auto: boolean
}

export interface GraphModel {
  nodes: GNode[]
  links: GLink[]
  steps: ProcessStep[]
  byKey: Map<string, GNode>
  /** Directly linked items, either way. */
  neighbors: Map<string, Set<string>>
  groups: { id: string; name: string; count: number }[]
  maxRank: number
}

export const NO_PROJECT = 'none'

export function buildModel(
  g: ProductionGraph,
  opts: { loose: boolean; noProjectName: string },
  previous?: Map<string, GNode>,
): GraphModel {
  const { steps, related } = processSteps(g.edges)
  const inputs = new Map<string, number>()
  const outputs = new Map<string, number>()
  for (const s of steps) {
    outputs.set(s.up, (outputs.get(s.up) ?? 0) + 1)
    inputs.set(s.down, (inputs.get(s.down) ?? 0) + 1)
  }
  const relatedCount = new Map<string, number>()
  for (const [a, b] of related) {
    relatedCount.set(a, (relatedCount.get(a) ?? 0) + 1)
    relatedCount.set(b, (relatedCount.get(b) ?? 0) + 1)
  }

  // Ranks: the longest way back to a source, so every step moves one column right (loops are cut).
  const ups = new Map<string, string[]>()
  for (const s of steps) ups.set(s.down, [...(ups.get(s.down) ?? []), s.up])
  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (k: string): number => {
    const have = rank.get(k)
    if (have !== undefined) return have
    if (visiting.has(k)) return 0
    visiting.add(k)
    let r = 0
    for (const u of ups.get(k) ?? []) r = Math.max(r, rankOf(u) + 1)
    visiting.delete(k)
    rank.set(k, r)
    return r
  }

  // Edits and posts without a project sit with the media they come from.
  const projectOf = new Map<string, string>()
  for (const n of g.nodes) if (n.projectId) projectOf.set(nodeKey(n), n.projectId)
  for (let pass = 0; pass < 3; pass++)
    for (const s of steps) {
      if (!projectOf.has(s.down) && projectOf.has(s.up)) projectOf.set(s.down, projectOf.get(s.up)!)
      if (!projectOf.has(s.up) && projectOf.has(s.down)) projectOf.set(s.up, projectOf.get(s.down)!)
    }

  const nodes: GNode[] = []
  const byKey = new Map<string, GNode>()
  for (const n of g.nodes) {
    const key = nodeKey(n)
    const ins = inputs.get(key) ?? 0
    const outs = outputs.get(key) ?? 0
    const degree = ins + outs + (relatedCount.get(key) ?? 0)
    if (!opts.loose && degree === 0) continue
    const stage: Stage =
      n.type === 'post'
        ? 'post'
        : n.type === 'composition'
          ? 'edit'
          : degree === 0
            ? 'loose'
            : ins === 0
              ? 'source'
              : outs === 0
                ? 'final'
                : 'made'
    const prev = previous?.get(key)
    const gn: GNode = {
      key,
      node: n,
      stage,
      rank: rankOf(key),
      degree,
      inputs: ins,
      outputs: outs,
      r: radiusFor(stage, degree),
      group: projectOf.get(key) ?? NO_PROJECT,
      x: prev?.x ?? Number.NaN,
      y: prev?.y ?? Number.NaN,
      vx: prev?.vx,
      vy: prev?.vy,
    }
    nodes.push(gn)
    byKey.set(key, gn)
  }

  const links: GLink[] = []
  const neighbors = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    neighbors.get(a)!.add(b)
  }
  for (const s of steps) {
    const a = byKey.get(s.up)
    const b = byKey.get(s.down)
    if (!a || !b) continue
    links.push({ key: s.key, source: a, target: b, relation: s.relation, auto: s.auto })
    touch(a.key, b.key)
    touch(b.key, a.key)
  }
  for (const [ka, kb] of related) {
    const a = byKey.get(ka)
    const b = byKey.get(kb)
    if (!a || !b) continue
    links.push({ key: `${ka}~${kb}`, source: a, target: b, relation: 'related', auto: false })
    touch(a.key, b.key)
    touch(b.key, a.key)
  }

  const names = new Map(g.projects.map((p) => [p.id, p.name]))
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1)
  const groups = [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? opts.noProjectName, count }))
    .sort((a, b) => (a.id === NO_PROJECT ? 1 : b.id === NO_PROJECT ? -1 : a.name.localeCompare(b.name)))

  return {
    nodes,
    links,
    steps,
    byKey,
    neighbors,
    groups,
    maxRank: Math.max(0, ...nodes.map((n) => n.rank)),
  }
}

function radiusFor(stage: Stage, degree: number) {
  const base = stage === 'final' ? 7 : stage === 'post' ? 5.5 : stage === 'edit' ? 6 : 4.5
  return base + Math.min(9, Math.sqrt(degree) * 1.6)
}

/** The item's chain (what it was made from and what was made with it), for lighting it up. */
export function chainOf(model: GraphModel, key: string): Set<string> {
  const { up, down } = lineageOf(model.steps, key)
  return new Set([key, ...up, ...down])
}

/** Keys of the links inside a set of nodes. */
export function linksWithin(model: GraphModel, keys: Set<string>) {
  return new Set(
    model.links.filter((l) => keys.has(l.source.key) && keys.has(l.target.key)).map((l) => l.key),
  )
}
