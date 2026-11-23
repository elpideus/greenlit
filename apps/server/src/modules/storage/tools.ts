import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'
import zlib from 'node:zlib'
import type { StorageTools } from '@greenlit/shared/areas/storage-admin'
import { availableEncoders } from '../../lib/ffmpeg.ts'

/** Background encoders run below normal priority so the machine stays responsive while the archive pass runs. */
const NICE = 10

export interface RunOptions {
  signal?: AbortSignal
  /** ffmpeg only: report progress (0..1) from `-progress` when the duration is known. */
  durationSec?: number | null
  onProgress?: (fraction: number) => void
  /** Keep stdout (e.g. `ffmpeg -f md5 -`). */
  captureStdout?: boolean
}

/** Runs a command-line tool at low priority; rejects with the tail of stderr when it fails. */
export function runTool(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', opts.captureStdout ? 'pipe' : 'ignore', 'pipe'],
      signal: opts.signal,
    })
    try {
      if (child.pid) setPriority(child.pid, NICE)
    } catch {
      /* not allowed on this system: run at normal priority */
    }
    const out: Buffer[] = []
    let err = ''
    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      err = (err + s).slice(-8000)
      if (opts.onProgress && opts.durationSec) {
        for (const line of s.split(/\r|\n/)) {
          const m = line.match(/^out_time_us=(\d+)/)
          if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec))
        }
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out).toString() })
      else reject(new Error(`${bin} exited with ${code}: ${err.trim().split('\n').slice(-4).join(' / ')}`))
    })
  })
}

const binaries = new Map<string, Promise<boolean>>()
/** Is a command available on this machine? (cached) */
export function hasBinary(bin: string): Promise<boolean> {
  let p = binaries.get(bin)
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const child = spawn(bin, ['--version'], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('close', () => resolve(true))
    })
    binaries.set(bin, p)
  }
  return p
}

let cached: Promise<StorageTools & { opus: boolean }> | null = null
/** What this server can pack with. Missing encoders fall back to lossless zstd. */
export function storageTools() {
  cached ??= (async () => {
    const enc = await availableEncoders()
    const [cjxl, djxl] = await Promise.all([hasBinary('cjxl'), hasBinary('djxl')])
    return {
      zstd: typeof zlib.createZstdCompress === 'function',
      av1: enc.has('libsvtav1'),
      opus: enc.has('libopus'),
      flac: enc.has('flac'),
      jxl: cjxl && djxl,
    }
  })()
  return cached
}
