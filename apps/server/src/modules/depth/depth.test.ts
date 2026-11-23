import { describe, expect, it } from 'vitest'
import { percentiles, Steadier } from './estimate.ts'
import { inferenceSize } from './model.ts'

/** A "disparity" frame: a left-to-right ramp, scaled and shifted the way Depth Anything's frames drift. */
const ramp = (n: number, scale: number, shift: number) =>
  Float32Array.from({ length: n }, (_, i) => (i / (n - 1)) * scale + shift)

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length

describe('depth estimation', () => {
  it('sizes the model input to a 518 px shorter side in multiples of 14', () => {
    expect(inferenceSize(1920, 1080)).toEqual({ width: 924, height: 518 })
    expect(inferenceSize(2048, 1536)).toEqual({ width: 686, height: 518 })
    expect(inferenceSize(1080, 1920)).toEqual({ width: 518, height: 924 })
  })

  it('finds quantiles of the finite values', () => {
    const v = Float32Array.from({ length: 1001 }, (_, i) => i)
    v[3] = Number.POSITIVE_INFINITY
    expect(percentiles(v, 0, 1)).toEqual([0, 1000])
    expect(percentiles(v, 0.5, 0.5)[0]).toBeCloseTo(500, -1)
  })

  it('keeps a video steady when the model changes its scale from one frame to the next', () => {
    const n = 50_000
    const s = new Steadier(n)
    const first = s.next(ramp(n, 4, 1))
    // The same scene, but the model doubled its numbers and moved them: the map must not jump.
    const second = s.next(ramp(n, 8, 3))
    expect(Math.abs(mean(second) - mean(first))).toBeLessThan(0.005)
    expect(Math.abs(second[n - 1]! - first[n - 1]!)).toBeLessThan(0.01)
    expect(first[0]!).toBeGreaterThan(0)
    expect(first[n - 1]!).toBeLessThan(1)
  })

  it('starts afresh at a cut', () => {
    const n = 50_000
    const s = new Steadier(n)
    s.next(ramp(n, 4, 1))
    // A different picture (reversed): it cannot be fitted to the last one, so it gets its own range.
    const cut = s.next(ramp(n, -4, 5))
    expect(cut[0]!).toBeGreaterThan(cut[n - 1]!)
    expect(cut[0]!).toBeGreaterThan(0.9)
  })
})
