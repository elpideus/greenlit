import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as ort from 'onnxruntime-node'

/**
 * Graphics cards for the models Greenlit runs itself (depth maps today). ONNX Runtime tries, in order:
 * - CUDA: NVIDIA cards, when the CUDA build of the image put its libraries in (docker/gpu, `GPU=cuda`) and the card
 *   is passed into the container (docker/compose.gpu.yaml);
 * - WebGPU: through Vulkan, any card with a Vulkan driver (a computer running Greenlit outside Docker, like dev);
 * - the processor.
 * `GREENLIT_GPU` = auto (default) | cuda | webgpu | off picks one or turns the card off.
 */
export type Backend = 'cuda' | 'webgpu' | 'cpu'

export interface GpuInfo {
  name: string
  memoryMB: number
  driver: string
}

const require = createRequire(import.meta.url)
const bindingDir = () =>
  join(
    dirname(require.resolve('onnxruntime-node')),
    '..',
    'bin',
    'napi-v6',
    `${process.platform}`,
    process.arch,
  )

/** ONNX Runtime's CUDA provider is in place (it isn't on npm: the CUDA image build adds it). */
export function cudaInstalled() {
  try {
    return existsSync(join(bindingDir(), 'libonnxruntime_providers_cuda.so'))
  } catch {
    return false
  }
}

/** A Vulkan driver is installed or mounted in (WebGPU would only fail noisily without one). */
export function vulkanDriverPresent() {
  for (const dir of ['/etc/vulkan/icd.d', '/usr/share/vulkan/icd.d', '/usr/local/share/vulkan/icd.d'])
    try {
      if (readdirSync(dir).some((f) => f.endsWith('.json'))) return true
    } catch {}
  return false
}

export function gpuPreference(): 'auto' | Backend | 'off' {
  const v = (process.env.GREENLIT_GPU ?? 'auto').toLowerCase()
  return v === 'cuda' || v === 'webgpu' || v === 'off' || v === 'cpu' ? (v === 'cpu' ? 'off' : v) : 'auto'
}

/** The backends worth trying, best first. */
export function backendOrder(): Backend[] {
  const pref = gpuPreference()
  if (pref === 'off') return ['cpu']
  if (pref === 'cuda') return ['cuda', 'cpu']
  if (pref === 'webgpu') return ['webgpu', 'cpu']
  return [
    ...(cudaInstalled() ? (['cuda'] as const) : []),
    ...(vulkanDriverPresent() ? (['webgpu'] as const) : []),
    'cpu',
  ]
}

let cards: Promise<GpuInfo[]> | null = null
/** NVIDIA cards nvidia-smi reports (mounted into containers by NVIDIA's toolkit); [] without one. Asked once. */
export function nvidiaGpus(): Promise<GpuInfo[]> {
  cards ??= new Promise((resolve) => {
    let out = ''
    const p = spawn('nvidia-smi', [
      '--query-gpu=name,memory.total,driver_version',
      '--format=csv,noheader,nounits',
    ])
    const timer = setTimeout(() => p.kill(), 4000)
    p.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    p.on('error', () => resolve([]))
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve([])
      resolve(
        out
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [name = '', mem = '0', driver = ''] = line.split(',').map((s) => s.trim())
            return { name, memoryMB: Number(mem) || 0, driver }
          }),
      )
    })
  })
  return cards
}

/**
 * Opens a model on the best backend that works here (see backendOrder): a backend that can't start (no card passed
 * in, a driver missing) falls through to the next one. Says which one it got and why the better ones didn't.
 */
export async function openSession(
  path: string,
  opts: { threads: number },
): Promise<{
  session: ort.InferenceSession
  backend: Backend
  skipped: { backend: Backend; error: string }[]
}> {
  const skipped: { backend: Backend; error: string }[] = []
  for (const backend of backendOrder()) {
    try {
      const session = await ort.InferenceSession.create(path, {
        executionProviders: backend === 'cpu' ? ['cpu'] : [backend, 'cpu'],
        intraOpNumThreads: opts.threads,
        graphOptimizationLevel: 'all',
        // Warnings only (which nodes run on the processor beside the card): not worth the log.
        logSeverityLevel: 3,
      })
      return { session, backend, skipped }
    } catch (err) {
      skipped.push({ backend, error: (err as Error).message.split('\n')[0]!.slice(0, 300) })
    }
  }
  throw new Error(
    `The model could not be opened: ${skipped.map((s) => `${s.backend}: ${s.error}`).join('; ')}`,
  )
}
