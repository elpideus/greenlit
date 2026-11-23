import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import sharp from 'sharp'
import { ffmpegBin, type ProbeResult } from '../../lib/ffmpeg.ts'
import { type DepthModel, inferenceSize } from './model.ts'

/**
 * Depth maps made by Greenlit, from Depth Anything's disparity (bigger = closer, so near is light):
 * - a picture: one 16-bit grey PNG the size of the picture;
 * - a video: a grey MP4 of the same length (at most 30 frames a second and 1920 px wide), each frame lined up with
 *   the one before it so the map doesn't flicker (see Steadier). About 0.4 s per frame on a 20-thread processor.
 */

/** The values between these shares of a map become black and white (stray pixels don't flatten the rest). */
const LOW = 0.005
const HIGH = 0.995

/** Picture → 16-bit depth PNG at `out`. Returns the size it was made at (the picture's, upright). */
export async function depthOfPicture(model: DepthModel, src: string, out: string) {
  const meta = await sharp(src, { failOn: 'none' }).metadata()
  const rotated = (meta.orientation ?? 1) >= 5
  const width = (rotated ? meta.height : meta.width) ?? 0
  const height = (rotated ? meta.width : meta.height) ?? 0
  if (!width || !height) throw new Error('Greenlit cannot read this picture')
  const size = inferenceSize(width, height)
  const rgb = await sharp(src, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(size.width, size.height, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer()
  const disparity = await model.infer(rgb, size.width, size.height)
  const [lo, hi] = percentiles(disparity, LOW, HIGH)
  const span = hi - lo || 1
  const px = new Uint16Array(disparity.length)
  for (let i = 0; i < px.length; i++) px[i] = Math.round(clamp01((disparity[i]! - lo) / span) * 65535)
  await sharp(px, { raw: { width: size.width, height: size.height, channels: 1 } })
    .toColourspace('grey16')
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .png({ compressionLevel: 7 })
    .toFile(out)
  return { width, height }
}

/** Video → grey depth MP4 at `out`, the same length as the video. */
export async function depthOfVideo(
  model: DepthModel,
  src: string,
  out: string,
  p: ProbeResult,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
) {
  if (!p.width || !p.height) throw new Error('Greenlit cannot read this video')
  const fps = Math.min(30, p.fps && p.fps > 0 ? p.fps : 30)
  const size = inferenceSize(p.width, p.height)
  const scale = Math.min(1, 1920 / Math.max(p.width, p.height))
  const outW = Math.max(2, Math.round((p.width * scale) / 2) * 2)
  const outH = Math.max(2, Math.round((p.height * scale) / 2) * 2)
  const total = Math.max(1, Math.round((p.durationSec ?? 0) * fps))

  // Frames at a constant rate (so the map lasts exactly as long), upright, at the model's size.
  const decoder = spawn(
    ffmpegBin(),
    [
      ...['-hide_banner', '-loglevel', 'error', '-i', src, '-an', '-sn'],
      ...['-vf', `fps=${fps},scale=${size.width}:${size.height}:flags=bicubic`],
      ...['-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const encoder = spawn(
    ffmpegBin(),
    [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'rawvideo', '-pix_fmt', 'gray16le', '-s', `${size.width}x${size.height}`, '-r', String(fps)],
      ...['-i', 'pipe:0', '-vf', `scale=${outW}:${outH}:flags=bicubic,format=yuv420p`],
      ...['-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-movflags', '+faststart', out],
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  )
  const errors = [collect(decoder), collect(encoder)]
  const stop = () => {
    decoder.kill('SIGKILL')
    encoder.kill('SIGKILL')
  }
  opts.signal?.addEventListener('abort', stop, { once: true })
  const exited = [exitOf(decoder), exitOf(encoder)]
  try {
    const steady = new Steadier(size.width * size.height)
    let done = 0
    const write = async (level: Float32Array) => {
      const px = new Uint16Array(level.length)
      for (let i = 0; i < px.length; i++) px[i] = Math.round(level[i]! * 65535)
      if (!encoder.stdin!.write(Buffer.from(px.buffer))) await once(encoder.stdin!, 'drain')
      done++
      opts.onProgress?.(Math.min(0.999, done / total))
    }
    // From 24 frames a second up, the model sees every other frame and the ones between are blended: half the time,
    // and property footage (slow, smooth moves) looks the same.
    const every = fps >= 24 ? 2 : 1
    let last: Float32Array | null = null
    let waiting = 0
    let index = 0
    for await (const frame of framesOf(decoder, size.width * size.height * 3)) {
      if (opts.signal?.aborted) throw new Error('Cancelled')
      if (index++ % every) {
        waiting++
        continue
      }
      const key = steady.next(await model.infer(frame, size.width, size.height))
      for (let j = 1; last && j <= waiting; j++) await write(mix(last, key, j / (waiting + 1)))
      await write(key)
      last = key
      waiting = 0
    }
    // Frames after the last one the model saw keep its map.
    for (let j = 0; last && j < waiting; j++) await write(last)
    encoder.stdin!.end()
    const [dec, enc] = await Promise.all(exited)
    if (opts.signal?.aborted) throw new Error('Cancelled')
    if (dec !== 0) throw new Error(`The video could not be read: ${errors[0]!.text()}`)
    if (enc !== 0) throw new Error(`The depth video could not be written: ${errors[1]!.text()}`)
    if (!done) throw new Error('The video has no frames')
    return { width: outW, height: outH, frames: done, fps }
  } catch (err) {
    stop()
    throw err
  } finally {
    opts.signal?.removeEventListener('abort', stop)
  }
}

/**
 * Keeps a video's depth steady. Depth Anything gives each frame its own scale (a person walking in makes the whole
 * room jump darker), so every frame is fitted to the one before it (the scale and offset that make them agree best,
 * by least squares), pulled very slowly towards its own full range so it never drifts away, and still pixels are
 * averaged with the previous frame while moving ones are kept as they are. A cut (frames that don't fit each other)
 * starts afresh.
 */
export class Steadier {
  private prev: Float32Array | null = null
  private readonly n: number
  constructor(pixels: number) {
    this.n = pixels
  }

  next(d: Float32Array): Float32Array {
    const out = new Float32Array(this.n)
    // Its own range, with room above and below for what comes later.
    const [lo, hi] = percentiles(d, LOW, HIGH)
    const own = { a: 0.9 / (hi - lo || 1), b: 0 }
    own.b = 0.05 - lo * own.a
    let a = own.a
    let b = own.b
    const prev = this.prev
    if (prev) {
      const fit = leastSquares(d, prev)
      if (fit && fit.r2 > 0.6 && fit.a > 0) {
        a = fit.a * 0.99 + own.a * 0.01
        b = fit.b * 0.99 + own.b * 0.01
      }
    }
    for (let i = 0; i < this.n; i++) {
      let v = clamp01(a * d[i]! + b)
      if (prev) {
        const p = prev[i]!
        if (Math.abs(v - p) < 0.03) v = (v + p) / 2
      }
      out[i] = v
    }
    this.prev = out
    return out
  }
}

/** The scale and offset that best turn `x` into `y` (on a sample of pixels), and how well they do (r²). */
function leastSquares(x: Float32Array, y: Float32Array) {
  const step = Math.max(1, Math.floor(x.length / 40_000))
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < x.length; i += step) {
    const yi = y[i]!
    // Pixels pinned at black or white say nothing about the scale.
    if (yi <= 0.001 || yi >= 0.999) continue
    const xi = x[i]!
    n++
    sx += xi
    sy += yi
    sxx += xi * xi
    sxy += xi * yi
    syy += yi * yi
  }
  if (n < 100) return null
  const vx = n * sxx - sx * sx
  const vy = n * syy - sy * sy
  if (vx <= 0 || vy <= 0) return null
  const cov = n * sxy - sx * sy
  const a = cov / vx
  return { a, b: (sy - a * sx) / n, r2: (cov * cov) / (vx * vy) }
}

/** Two quantiles of the finite values (from a sample of at most 200 000). */
export function percentiles(values: ArrayLike<number>, low: number, high: number): [number, number] {
  const step = Math.max(1, Math.floor(values.length / 200_000))
  const sample: number[] = []
  for (let i = 0; i < values.length; i += step) {
    const v = values[i]!
    if (Number.isFinite(v)) sample.push(v)
  }
  if (!sample.length) return [0, 1]
  sample.sort((p, q) => p - q)
  const at = (q: number) => sample[Math.min(sample.length - 1, Math.round(q * (sample.length - 1)))]!
  return [at(low), at(high)]
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** `a` and `b` blended, `t` of the way to `b`. */
function mix(a: Float32Array, b: Float32Array, t: number) {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t
  return out
}

/** The decoder's output, one whole frame at a time (the buffer is reused: use it before asking for the next). */
async function* framesOf(proc: ChildProcess, size: number) {
  const frame = Buffer.allocUnsafe(size)
  let filled = 0
  for await (const chunk of proc.stdout! as AsyncIterable<Buffer>) {
    let off = 0
    while (off < chunk.length) {
      const n = Math.min(size - filled, chunk.length - off)
      chunk.copy(frame, filled, off, off + n)
      filled += n
      off += n
      if (filled === size) {
        yield frame
        filled = 0
      }
    }
  }
}

function collect(proc: ChildProcess) {
  let err = ''
  proc.stderr?.on('data', (d: Buffer) => {
    err = (err + d.toString()).slice(-4000)
  })
  return { text: () => err.trim().split('\n').slice(-4).join(' ') }
}

function exitOf(proc: ChildProcess) {
  return new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1))
    proc.on('error', () => resolve(1))
  })
}
