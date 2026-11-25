import { describe, expect, it } from 'vitest'
import { flowOf, type GraphEdge, lineageOf, processSteps } from './graph.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let next = 100
const edge = (
  from: [string, number],
  relation: GraphEdge['relation'],
  to: [string, number],
  extra: Partial<GraphEdge> = {},
): GraphEdge => ({
  id: id(next++),
  from: { type: from[0] as 'media', id: id(from[1]) },
  to: { type: to[0] as 'media', id: id(to[1]) },
  relation,
  auto: false,
  spans: [],
  ...extra,
})
const k = (type: string, n: number) => `${type}:${id(n)}`

describe('flowOf', () => {
  it('reads "uses" backwards and related as no direction', () => {
    const e = edge(['composition', 1], 'uses', ['media', 2])
    expect(flowOf(e)).toEqual({ up: e.to, down: e.from })
    expect(flowOf(edge(['media', 1], 'related', ['media', 2]))).toBeNull()
    const s = edge(['media', 1], 'source_of', ['media', 2])
    expect(flowOf(s)).toEqual({ up: s.from, down: s.to })
  })
})

describe('processSteps', () => {
  it('joins two links between the same items into the more telling step', () => {
    const { steps } = processSteps([
      edge(['post', 9], 'uses', ['media', 1], { auto: true }),
      edge(['media', 1], 'published_as', ['post', 9], { auto: true }),
    ])
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ up: k('media', 1), down: k('post', 9), relation: 'published_as' })
    expect(steps[0]!.links).toHaveLength(2)
  })

  it("leaves out an export's own made-from line where its edit shows the way", () => {
    const { steps } = processSteps([
      edge(['composition', 5], 'uses', ['media', 1], {
        auto: true,
        spans: [{ start: 4, duration: 2, in: 0 }],
      }),
      edge(['composition', 5], 'rendered_to', ['media', 6], { auto: true }),
      edge(['media', 1], 'source_of', ['media', 6], { auto: true }),
      edge(['media', 2], 'source_of', ['media', 6]),
    ])
    expect(steps.map((s) => `${s.up}>${s.down}`).sort()).toEqual(
      [
        `${k('composition', 5)}>${k('media', 6)}`,
        `${k('media', 1)}>${k('composition', 5)}`,
        `${k('media', 2)}>${k('media', 6)}`,
      ].sort(),
    )
    expect(steps.find((s) => s.down === k('composition', 5))!.spans).toEqual([
      { start: 4, duration: 2, in: 0 },
    ])
  })

  it('keeps a made-from line people drew themselves', () => {
    const { steps } = processSteps([
      edge(['composition', 5], 'uses', ['media', 1], { auto: true }),
      edge(['composition', 5], 'rendered_to', ['media', 6], { auto: true }),
      edge(['media', 1], 'source_of', ['media', 6]),
    ])
    expect(steps).toHaveLength(3)
  })

  it('returns related links apart, once per pair', () => {
    const { steps, related } = processSteps([
      edge(['media', 1], 'related', ['media', 2]),
      edge(['media', 2], 'related', ['media', 1]),
    ])
    expect(steps).toHaveLength(0)
    expect(related).toHaveLength(1)
  })
})

describe('lineageOf', () => {
  it("walks up to the camera and down to the posts, not into the film's other shots", () => {
    // photo 1 → still 2 → clip 3 → film 4 → post 5; clip 7 → film 4 (another shot)
    const { steps } = processSteps([
      edge(['media', 1], 'source_of', ['media', 2]),
      edge(['media', 2], 'source_of', ['media', 3]),
      edge(['media', 3], 'source_of', ['media', 4]),
      edge(['media', 7], 'source_of', ['media', 4]),
      edge(['media', 4], 'published_as', ['post', 5]),
    ])
    const l = lineageOf(steps, k('media', 3))
    expect([...l.up].sort()).toEqual([k('media', 1), k('media', 2)].sort())
    expect([...l.down].sort()).toEqual([k('media', 4), k('post', 5)].sort())
  })

  it('stops on loops', () => {
    const { steps } = processSteps([
      edge(['media', 1], 'source_of', ['media', 2]),
      edge(['media', 2], 'source_of', ['media', 1]),
    ])
    const l = lineageOf(steps, k('media', 1))
    expect([...l.up]).toEqual([k('media', 2)])
    expect([...l.down]).toEqual([k('media', 2)])
  })
})
