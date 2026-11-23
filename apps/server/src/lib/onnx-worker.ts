import { type ChildProcess, fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type * as ort from 'onnxruntime-node'
import type { Backend } from './gpu.ts'

/**
 * An ONNX model in its own process (onnx-worker-child.ts). A big model holds gigabytes, and memory a Node process
 * frees isn't handed back to the system (nor the graphics card's CUDA context): in a child process that exits when
 * the work is done, all of it is. The server stays as small as before the first depth map.
 */
export interface WorkerTensor {
  type: ort.Tensor.Type
  data: ort.Tensor.DataType
  dims: readonly number[]
}
export interface Opened {
  backend: Backend
  skipped: { backend: Backend; error: string }[]
  inputNames: readonly string[]
  outputNames: readonly string[]
}

const CHILD = fileURLToPath(new URL('./onnx-worker-child.ts', import.meta.url))

export class OnnxWorker {
  private child: ChildProcess | null = null
  private next = 1
  private readonly pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()

  get running() {
    return !!this.child
  }

  /** Starts the process (if needed) and opens the model in it. */
  open(path: string, opts: { threads: number; avoid?: Backend[] }): Promise<Opened> {
    return this.call<Opened>({ op: 'open', path, threads: opts.threads, avoid: opts.avoid })
  }

  run(feeds: Record<string, WorkerTensor>, fetches?: string[]): Promise<Record<string, WorkerTensor>> {
    return this.call({ op: 'run', feeds, fetches })
  }

  /** Ends the process: everything the model held goes back to the system. */
  stop() {
    const c = this.child
    this.child = null
    if (!c) return
    c.removeAllListeners('exit')
    c.kill('SIGTERM')
    for (const p of this.pending.values()) p.reject(new Error('The model was closed'))
    this.pending.clear()
  }

  private call<T>(msg: object): Promise<T> {
    const child = this.spawn()
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject })
      child.send({ id, ...msg })
    })
  }

  private spawn() {
    if (this.child) return this.child
    // No --watch or other flags of the server's own: just the model.
    const child = fork(CHILD, [], {
      serialization: 'advanced',
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    child.on('message', (m: { id: number; ok?: unknown; error?: string }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.error !== undefined) p.reject(new Error(m.error))
      else p.resolve(m.ok as never)
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null
      const err = new Error(`The model process stopped (${signal ?? `exit code ${code}`})`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
    this.child = child
    return child
  }
}
