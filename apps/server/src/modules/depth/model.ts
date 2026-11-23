import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as ort from 'onnxruntime-node'
import type { Logger } from '../../core/logger.ts'
import { type Backend, openSession } from '../../lib/gpu.ts'

/**
 * Depth Anything V2 Small (Apache-2.0, unlike Base and Large, which are non-commercial), as ONNX from the
 * onnx-community conversion, pinned to one revision and checked by its SHA-256. Downloaded into the data folder the
 * first time a depth map is made; `GREENLIT_DEPTH_MODEL` may point at a copy of the file instead (offline installs).
 */
export const DEPTH_MODEL = {
  id: 'depth-anything-v2-small',
  name: 'Depth Anything V2 Small',
  license: 'Apache-2.0',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx',
  sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
  size: 99_060_839,
  /** The model's own input size (shorter side, a multiple of 14): larger brings no detail with Small, only time. */
  shortSide: 518,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
} as const

/** Unload the model after this long without work (it holds about 400 MB). */
const IDLE_MS = 10 * 60_000

export class DepthModel {
  private readonly dataDir: string
  private readonly log: Logger
  private session: Promise<ort.InferenceSession> | null = null
  /** Where the model runs, once it has been opened (a graphics card or the processor). */
  backend: Backend | null = null
  private download: Promise<void> | null = null
  private idle: ReturnType<typeof setTimeout> | null = null

  constructor(dataDir: string, log: Logger) {
    this.dataDir = dataDir
    this.log = log
  }

  get path() {
    return (
      process.env.GREENLIT_DEPTH_MODEL ||
      join(this.dataDir, 'models', DEPTH_MODEL.id, `${DEPTH_MODEL.sha256.slice(0, 16)}.onnx`)
    )
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
    const target = this.path
    const part = `${target}.part`
    await mkdir(dirname(target), { recursive: true })
    this.log.info({ url: DEPTH_MODEL.url }, 'downloading the depth model')
    const res = await fetch(DEPTH_MODEL.url, { signal })
    if (!res.ok || !res.body) throw new Error(`The depth model could not be downloaded (${res.status})`)
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      onProgress?.(Math.min(1, got / DEPTH_MODEL.size))
    })
    try {
      await pipeline(body, createWriteStream(part), { signal })
      const digest = hash.digest('hex')
      if (digest !== DEPTH_MODEL.sha256)
        throw new Error('The downloaded depth model is not the expected file (checksum differs)')
      await rename(part, target)
    } catch (err) {
      await rm(part, { force: true })
      throw err
    }
    this.log.info({ size: (await stat(target)).size }, 'depth model ready')
  }

  /** Disparity (relative inverse depth: bigger = closer) of an RGB picture of `width`×`height` (multiples of 14). */
  async infer(rgb: Uint8Array, width: number, height: number): Promise<Float32Array> {
    const session = await this.open()
    const n = width * height
    const input = new Float32Array(3 * n)
    const [m0, m1, m2] = DEPTH_MODEL.mean
    const [s0, s1, s2] = DEPTH_MODEL.std
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      input[i] = (rgb[j]! / 255 - m0) / s0
      input[n + i] = (rgb[j + 1]! / 255 - m1) / s1
      input[2 * n + i] = (rgb[j + 2]! / 255 - m2) / s2
    }
    const out = await session.run({
      [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, height, width]),
    })
    return out[session.outputNames[0]!]!.data as Float32Array
  }

  private open() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => void this.close(), IDLE_MS)
    // On a graphics card when there is one (lib/gpu.ts); on the processor, most of it but not all: the rest of
    // Greenlit (and the computer) keeps going.
    this.session ??= openSession(this.path, { threads: Math.max(2, Math.round(cpus().length * 0.6)) })
      .then(({ session, backend, skipped }) => {
        this.backend = backend
        this.log.info({ backend, skipped }, 'depth model opened')
        return session
      })
      .catch((err) => {
        this.session = null
        throw err
      })
    return this.session
  }

  /** Whether the model runs on the processor (opening it if needed). */
  async onProcessor() {
    await this.open()
    return this.backend === 'cpu'
  }

  async close() {
    const s = this.session
    this.session = null
    if (s) await (await s).release()
  }
}

/** The model's input size for a picture: the shorter side at `short`, both sides multiples of 14. */
export function inferenceSize(width: number, height: number, short: number = DEPTH_MODEL.shortSide) {
  const k = short / Math.min(width, height)
  return {
    width: Math.max(14, Math.round((width * k) / 14) * 14),
    height: Math.max(14, Math.round((height * k) / 14) * 14),
  }
}
