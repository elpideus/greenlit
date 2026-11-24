import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Logger } from '../../core/logger.ts'
import type { Backend } from '../../lib/gpu.ts'
import { OnnxWorker, type Opened, type WorkerTensor } from '../../lib/onnx-worker.ts'

/** A model file: pinned to one revision and checked by SHA-256, downloaded into the data folder when first needed. */
export interface ModelSpec {
  id: string
  name: string
  license: string
  url: string
  sha256: string
  size: number
  /** Backends it must not use (MoGe-2 needs more than 10 GB on WebGPU, ~2 GB on CUDA). */
  avoid?: Backend[]
}

/**
 * Pictures: MoGe-2 ViT-L (Microsoft, MIT), the official ONNX export (with normals). The cleanest shapes of the
 * models that may be used commercially, sky masked out, and real distances (metric scale). ~0.7 s a picture on an
 * RTX 3060, ~6 s on the processor.
 */
export const MOGE: ModelSpec = {
  id: 'moge-2-vitl',
  name: 'MoGe-2 ViT-L',
  license: 'MIT',
  url: 'https://huggingface.co/Ruicheng/moge-2-vitl-normal-onnx/resolve/1c02388b024dd34da413e1a934d7a941785f1460/model.onnx',
  sha256: 'afbc4ccc3450298f3afb35b90f015f4c4f552dea21dc6470d5f7b78b77e2d751',
  size: 1_324_265_014,
  // ONNX Runtime's WebGPU backend reuses little memory: MoGe-2 runs a 12 GB card out of it there.
  avoid: ['webgpu'],
}

/**
 * Videos: Depth Anything V2 Small (Apache-2.0, unlike Base and Large, which are non-commercial), the onnx-community
 * conversion. Fast enough for every frame (~0.1 s on a card).
 */
export const SMALL: ModelSpec = {
  id: 'depth-anything-v2-small',
  name: 'Depth Anything V2 Small',
  license: 'Apache-2.0',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx',
  sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
  size: 99_060_839,
}

/** Depth Anything's input: the shorter side at 518 (larger brings no detail with Small, only time), ImageNet colours. */
const SMALL_SHORT_SIDE = 518
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/** MoGe-2's input: the longer side at 1036, and the number of image tokens it works with (more = finer, slower). */
export const MOGE_LONG_SIDE = 1036
const MOGE_TOKENS = 2500n

/**
 * Unload a model after this long without work: MoGe-2 holds about 1.5 GB (more on the processor while it runs), and
 * opening it again takes a couple of seconds.
 */
const IDLE_MS = 2 * 60_000

/** One ONNX model: downloaded once, opened on the best backend (lib/gpu.ts) in its own process, closed when idle. */
export class OnnxModel {
  readonly spec: ModelSpec
  private readonly dataDir: string
  private readonly log: Logger
  private readonly worker = new OnnxWorker()
  private opened: Promise<Opened> | null = null
  /** Where the model runs, once it has been opened (a graphics card or the processor). */
  backend: Backend | null = null
  private download: Promise<void> | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  /** How many times the model was closed: a run that fails because it was closed isn't the card's fault. */
  private closes = 0
  /** The card failed it once (out of memory, a driver error): the processor from then on, until a restart. */
  private cardFailed = false

  constructor(spec: ModelSpec, dataDir: string, log: Logger) {
    this.spec = spec
    this.dataDir = dataDir
    this.log = log
  }

  /** DATA_DIR/models/<id>/<sha>.onnx: an offline install can put the file there itself. */
  get path() {
    return join(this.dataDir, 'models', this.spec.id, `${this.spec.sha256.slice(0, 16)}.onnx`)
  }

  installed() {
    return existsSync(this.path)
  }

  /** Downloads and checks the model once (concurrent callers share the download). */
  ensure(onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
    if (this.installed()) return Promise.resolve()
    this.download ??= this.fetchModel(onProgress, signal).finally(() => {
      this.download = null
    })
    return this.download
  }

  private async fetchModel(onProgress?: (fraction: number) => void, signal?: AbortSignal) {
    const { url, sha256, size, name } = this.spec
    const target = this.path
    const part = `${target}.part`
    await mkdir(dirname(target), { recursive: true })
    this.log.info({ url }, `downloading ${name}`)
    const res = await fetch(url, { signal })
    if (!res.ok || !res.body) throw new Error(`${name} could not be downloaded (${res.status})`)
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      onProgress?.(Math.min(1, got / size))
    })
    try {
      await pipeline(body, createWriteStream(part), { signal })
      const digest = hash.digest('hex')
      if (digest !== sha256)
        throw new Error(`The downloaded ${name} is not the expected file (checksum differs)`)
      await rename(part, target)
    } catch (err) {
      await rm(part, { force: true })
      throw err
    }
    this.log.info({ size: (await stat(target)).size }, `${name} ready`)
  }

  /**
   * Runs the model; `feeds` gets its input and output names. A run that fails on the graphics card (out of memory
   * because something else holds it, a driver error) is done again on the processor, which then keeps it.
   */
  async run(feeds: (names: Opened) => Record<string, WorkerTensor>, fetches?: string[]) {
    const names = await this.open()
    const closes = this.closes
    try {
      return await this.worker.run(feeds(names), fetches)
    } catch (err) {
      // Closed meanwhile (its work was stopped): not to be done again, and the card did nothing wrong.
      if (this.closes !== closes) throw err
      if (this.backend === 'cpu' || this.backend === null) throw err
      this.log.warn(
        { model: this.spec.id, backend: this.backend, err },
        'the graphics card failed: on the processor',
      )
      this.cardFailed = true
      this.close()
      const again = await this.open()
      return this.worker.run(feeds(again), fetches)
    }
  }

  /** Opens the model in its own process (onnx-worker.ts), which ends after IDLE_MS without work. */
  open() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.close(), IDLE_MS)
    // On a graphics card when there is one (lib/gpu.ts); on the processor, most of it but not all: the rest of
    // Greenlit (and the computer) keeps going.
    this.opened ??= this.worker
      .open(this.path, {
        threads: Math.max(2, Math.round(cpus().length * 0.6)),
        avoid: this.cardFailed ? ['cuda', 'webgpu'] : this.spec.avoid,
      })
      .then((opened) => {
        this.backend = opened.backend
        this.log.info(
          { model: this.spec.id, backend: opened.backend, skipped: opened.skipped },
          'depth model opened',
        )
        return opened
      })
      .catch((err) => {
        this.close()
        throw err
      })
    return this.opened
  }

  /** Whether the model runs on the processor (opening it if needed). */
  async onProcessor() {
    await this.open()
    return this.backend === 'cpu'
  }

  /** Ends the model's process: everything it held goes back to the system. */
  close() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.opened = null
    if (this.worker.running) this.closes++
    this.worker.stop()
  }
}

/** Depth Anything V2 Small: disparity (relative inverse depth: bigger = closer) of an RGB picture. */
export class DepthAnything extends OnnxModel {
  async infer(rgb: Uint8Array, width: number, height: number): Promise<Float32Array> {
    const input: WorkerTensor = {
      type: 'float32',
      data: planar(rgb, width, height, true),
      dims: [1, 3, height, width],
    }
    let output = ''
    const out = await this.run((names) => {
      output = names.outputNames[0]!
      return { [names.inputNames[0]!]: input }
    })
    return out[output]!.data as Float32Array
  }
}

/**
 * MoGe-2: an affine point map (x, y, z up to a z offset), a sky/valid mask and the scene's metric scale. Returns the
 * distance of every pixel in metres (Infinity where the mask says sky or nothing).
 */
export class MoGe extends OnnxModel {
  async infer(rgb: Uint8Array, width: number, height: number): Promise<Float32Array> {
    const feeds: Record<string, WorkerTensor> = {
      image: { type: 'float32', data: planar(rgb, width, height, false), dims: [1, 3, height, width] },
      num_tokens: { type: 'int64', data: BigInt64Array.from([MOGE_TOKENS]), dims: [] },
    }
    // Not the normals: less to compute and to hand back.
    const out = await this.run(() => feeds, ['points', 'mask', 'metric_scale'])
    const points = out.points!.data as Float32Array
    const mask = out.mask?.data as Float32Array | undefined
    const scale = Number((out.metric_scale!.data as Float32Array)[0])
    const shift = recoverShift(points, mask, width, height)
    const metres = new Float32Array(width * height)
    for (let i = 0; i < metres.length; i++) {
      const z = points[i * 3 + 2]! + shift
      metres[i] = (mask && mask[i]! < 0.5) || !(z > 0) ? Number.POSITIVE_INFINITY : z * scale
    }
    return metres
  }
}

/** RGB bytes → planar float32 (0..1, or ImageNet-normalised). */
function planar(rgb: Uint8Array, width: number, height: number, normalise: boolean) {
  const n = width * height
  const out = new Float32Array(3 * n)
  for (let i = 0, j = 0; i < n; i++, j += 3)
    for (let c = 0; c < 3; c++) {
      const v = rgb[j + c]! / 255
      out[c * n + i] = normalise ? (v - MEAN[c]!) / STD[c]! : v
    }
  return out
}

/**
 * The z offset that makes MoGe's affine point map project onto the pixel grid best (as MoGe's own
 * recover_focal_shift): for a trial offset the best focal length follows by least squares, and a golden-section
 * search over the offset finds the smallest error. On a sample of valid points; image coordinates are normalised so
 * the diagonal is 2.
 */
export function recoverShift(
  points: Float32Array,
  mask: Float32Array | undefined,
  width: number,
  height: number,
) {
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const us: number[] = []
  const vs: number[] = []
  const half = Math.hypot(width, height) / 2
  const step = Math.max(1, Math.floor((width * height) / 8000))
  for (let i = 0; i < width * height; i += step) {
    if (mask && mask[i]! < 0.5) continue
    xs.push(points[i * 3]!)
    ys.push(points[i * 3 + 1]!)
    zs.push(points[i * 3 + 2]!)
    us.push(((i % width) + 0.5 - width / 2) / half)
    vs.push((Math.floor(i / width) + 0.5 - height / 2) / half)
  }
  if (zs.length < 10) return 0
  const cost = (s: number) => {
    let num = 0
    let den = 0
    const px = new Float64Array(zs.length)
    const py = new Float64Array(zs.length)
    for (let k = 0; k < zs.length; k++) {
      const z = zs[k]! + s
      if (z <= 1e-6) return Number.POSITIVE_INFINITY
      px[k] = xs[k]! / z
      py[k] = ys[k]! / z
      num += px[k]! * us[k]! + py[k]! * vs[k]!
      den += px[k]! * px[k]! + py[k]! * py[k]!
    }
    const f = num / den
    let r = 0
    for (let k = 0; k < zs.length; k++) r += (f * px[k]! - us[k]!) ** 2 + (f * py[k]! - vs[k]!) ** 2
    return r
  }
  let zmin = Number.POSITIVE_INFINITY
  let zmax = Number.NEGATIVE_INFINITY
  for (const z of zs) {
    if (z < zmin) zmin = z
    if (z > zmax) zmax = z
  }
  let lo = -zmin + 1e-4
  let hi = -zmin + 50 * (zmax - zmin + 1e-3)
  for (let it = 0; it < 80; it++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (cost(a) < cost(b)) hi = b
    else lo = a
  }
  return (lo + hi) / 2
}

/** Depth Anything's input size for a picture: the shorter side at 518, both sides multiples of 14. */
export function inferenceSize(width: number, height: number, short: number = SMALL_SHORT_SIDE) {
  const k = short / Math.min(width, height)
  return {
    width: Math.max(14, Math.round((width * k) / 14) * 14),
    height: Math.max(14, Math.round((height * k) / 14) * 14),
  }
}
