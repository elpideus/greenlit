import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../core/logger.ts'
import { drained, percentiles, Steadier } from './estimate.ts'
import { DepthAnything, inferenceSize, recoverShift, SMALL } from './model.ts'

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

  it('recovers the depth offset of a MoGe point map', () => {
    // A box-like room seen by a camera with focal 1.3 (in half-diagonal units): depth 2..6, then shifted by -1.5,
    // which is what MoGe leaves open. The offset that makes the points project onto the pixels again is +1.5.
    const w = 64
    const h = 48
    const half = Math.hypot(w, h) / 2
    const f = 1.3
    const points = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5 - w / 2) / half
        const v = (y + 0.5 - h / 2) / half
        const depth = 2 + 4 * (y / h) + Math.abs(u)
        const i = (y * w + x) * 3
        points[i] = (u * depth) / f
        points[i + 1] = (v * depth) / f
        points[i + 2] = depth - 1.5
      }
    expect(recoverShift(points, undefined, w, h)).toBeCloseTo(1.5, 2)
  })

  it('never waits forever for an encoder that stopped', async () => {
    // A depth video's encoder, full: it takes no more until "drain".
    const full = () => new Writable({ highWaterMark: 1, write: () => {} })
    const a = full()
    a.write('x')
    const waiting = drained(a)
    a.emit('drain')
    await expect(waiting).resolves.toBeUndefined()
    // Killed when its job was stopped: its input closes, with no drain and (when nothing was pending) no error.
    const b = full()
    b.write('x')
    const killed = drained(b)
    b.destroy()
    await expect(killed).rejects.toThrow('stopped')
    // Already closed: a later wait doesn't hang either.
    await expect(drained(b)).rejects.toThrow('stopped')
    // The work was stopped.
    const stop = new AbortController()
    const c = full()
    c.write('x')
    const stopping = drained(c, stop.signal)
    stop.abort()
    await expect(stopping).rejects.toThrow('Cancelled')
    await expect(drained(c, stop.signal)).rejects.toThrow('Cancelled')
  })

  it('does not blame the graphics card for a run its own stop ended', async () => {
    const model = new DepthAnything(SMALL, '/nowhere', createLogger('silent', false))
    let opens = 0
    let pending: ((err: Error) => void) | null = null
    let running = false
    Object.assign(model as unknown as Record<string, unknown>, {
      worker: {
        get running() {
          return running
        },
        open: async () => {
          opens++
          running = true
          return { backend: 'cuda', skipped: [], inputNames: ['image'], outputNames: ['depth'] }
        },
        run: () => new Promise((_, reject) => (pending = reject)),
        stop: () => {
          running = false
          pending?.(new Error('The model was closed'))
        },
      },
    })
    const run = model.infer(new Uint8Array(3 * 14 * 14), 14, 14)
    await new Promise((r) => setTimeout(r, 10))
    // Its job was stopped: the model's process ends.
    model.close()
    await expect(run).rejects.toThrow('The model was closed')
    // Not opened again on the processor, and the card is still the card for the next one.
    expect(opens).toBe(1)
    expect((model as unknown as { cardFailed: boolean }).cardFailed).toBe(false)
  })
})
