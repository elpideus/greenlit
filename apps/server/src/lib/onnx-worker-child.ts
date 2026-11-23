/**
 * The model process (see onnx-worker.ts): opens one ONNX model on the best backend (lib/gpu.ts) and runs it for the
 * server over IPC. It lives only while there is work, so everything the model held (memory, the graphics card's
 * context) goes back to the system when it exits.
 */
import * as ort from 'onnxruntime-node'
import { type Backend, openSession } from './gpu.ts'

type Wire = { type: ort.Tensor.Type; data: ort.Tensor.DataType; dims: readonly number[] }
type Request =
  | { id: number; op: 'open'; path: string; threads: number; avoid?: Backend[] }
  | { id: number; op: 'run'; feeds: Record<string, Wire>; fetches?: string[] }

let session: ort.InferenceSession | null = null

const reply = (msg: object) => process.send?.(msg)

process.on('message', async (msg: Request) => {
  try {
    if (msg.op === 'open') {
      await session?.release()
      const opened = await openSession(msg.path, { threads: msg.threads, avoid: msg.avoid })
      session = opened.session
      reply({
        id: msg.id,
        ok: {
          backend: opened.backend,
          skipped: opened.skipped,
          inputNames: session.inputNames,
          outputNames: session.outputNames,
        },
      })
      return
    }
    if (!session) throw new Error('No model is open')
    const feeds: Record<string, ort.Tensor> = {}
    for (const [name, t] of Object.entries(msg.feeds))
      feeds[name] = new ort.Tensor(t.type, t.data as never, t.dims)
    const out = msg.fetches ? await session.run(feeds, msg.fetches) : await session.run(feeds)
    const outputs: Record<string, Wire> = {}
    for (const [name, t] of Object.entries(out)) outputs[name] = { type: t.type, data: t.data, dims: t.dims }
    reply({ id: msg.id, ok: outputs })
  } catch (err) {
    reply({ id: msg.id, error: (err as Error).message })
  }
})

// The server went away: so does the model.
process.on('disconnect', () => process.exit(0))
