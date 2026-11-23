import { UPLOAD_CHUNK_BYTES } from '@greenlit/shared'
import * as tus from 'tus-js-client'
import { create } from 'zustand'

/**
 * Resumable uploads (tus, `/api/uploads`). Each upload names a purpose registered by a server module
 * (`media.upload`, `comment.attachment`…) and a target with purpose-specific fields; the server decides what the
 * finished file becomes and answers with `result`.
 */
export interface UploadItem {
  id: string
  file: File
  purpose: string
  target: Record<string, unknown>
  label: string
  progress: number
  bytesSent: number
  state: 'queued' | 'uploading' | 'processing' | 'done' | 'failed' | 'cancelled'
  error: string | null
  result: unknown
  startedAt: number
}

interface UploadsState {
  items: UploadItem[]
  update: (id: string, patch: Partial<UploadItem>) => void
  clearFinished: () => void
}

export const useUploads = create<UploadsState>((set) => ({
  items: [],
  update: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => !['done', 'cancelled'].includes(i.state)) })),
}))

const running = new Map<string, tus.Upload>()

export interface UploadOptions {
  purpose: string
  target?: Record<string, unknown>
  /** Shown in the upload tray instead of the file name. */
  label?: string
  onDone?: (result: unknown) => void
  onError?: (message: string) => void
}

/** Starts uploading a file; resolves with the server's `result` for the purpose. */
export function upload(file: File, opts: UploadOptions): Promise<unknown> {
  const id = crypto.randomUUID()
  const item: UploadItem = {
    id,
    file,
    purpose: opts.purpose,
    target: opts.target ?? {},
    label: opts.label ?? file.name,
    progress: 0,
    bytesSent: 0,
    state: 'queued',
    error: null,
    result: null,
    startedAt: Date.now(),
  }
  useUploads.setState((s) => ({ items: [...s.items, item] }))
  const { update } = useUploads.getState()
  return new Promise((resolve, reject) => {
    const u = new tus.Upload(file, {
      endpoint: '/api/uploads',
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 8000, 15000],
      removeFingerprintOnSuccess: true,
      metadata: {
        purpose: opts.purpose,
        filename: file.name,
        filetype: file.type || 'application/octet-stream',
        target: JSON.stringify(opts.target ?? {}),
      },
      onProgress: (sent, total) =>
        update(id, { state: 'uploading', bytesSent: sent, progress: total ? sent / total : 0 }),
      onAfterResponse: (_req, res) => {
        // The finishing PATCH answers with the purpose's result.
        const body = res.getBody()
        if (body && res.getStatus() === 200 && body.startsWith('{')) {
          try {
            const parsed = JSON.parse(body) as { result?: unknown }
            if ('result' in parsed) update(id, { result: parsed.result })
          } catch {}
        }
      },
      onError: (err) => {
        running.delete(id)
        const message = String((err as tus.DetailedError).originalResponse?.getBody() || err.message)
        update(id, { state: 'failed', error: message })
        opts.onError?.(message)
        reject(new Error(message))
      },
      onSuccess: () => {
        running.delete(id)
        const result = useUploads.getState().items.find((i) => i.id === id)?.result ?? null
        update(id, { state: 'done', progress: 1, result })
        opts.onDone?.(result)
        resolve(result)
      },
    })
    running.set(id, u)
    void u.findPreviousUploads().then((prev) => {
      if (prev[0]) u.resumeFromPreviousUpload(prev[0])
      u.start()
    })
  })
}

export function cancelUpload(id: string) {
  const u = running.get(id)
  void u?.abort(true)
  running.delete(id)
  useUploads.getState().update(id, { state: 'cancelled' })
}

export function retryUpload(id: string) {
  const item = useUploads.getState().items.find((i) => i.id === id)
  if (!item) return
  useUploads.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  void upload(item.file, { purpose: item.purpose, target: item.target, label: item.label }).catch(() => {})
}

/** Files from a paste event (pictures copied to the clipboard, files copied in a file manager). */
export function filesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const out: File[] = []
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}
