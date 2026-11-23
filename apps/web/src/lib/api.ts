import type { ErrorCode } from '@greenlit/shared'

/** An error answered by the Greenlit API (or a network failure, as `unavailable`). */
export class ApiError extends Error {
  readonly code: ErrorCode | 'network'
  readonly status: number
  readonly details: unknown
  constructor(code: ErrorCode | 'network', message: string, status: number, details?: unknown) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

export type Query = Record<string, string | number | boolean | null | undefined | string[]>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) for (const item of v) params.append(k, item)
    else params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query, signal?: AbortSignal) {
  const url = withQuery(path.startsWith('/api') ? path : `/api${path}`, query)
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('network', 'Greenlit cannot be reached. Check your connection.', 0)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    // A proxy (Cloudflare) answered with its own HTML page.
    throw new ApiError(
      'bad_gateway',
      'Greenlit is restarting or unreachable. Try again in a moment.',
      res.status,
    )
  }
  if (!res.ok) {
    const e = (data as { error?: { code: ErrorCode; message: string; details?: unknown } })?.error
    throw new ApiError(e?.code ?? 'internal', e?.message ?? res.statusText, res.status, e?.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>('GET', path, undefined, query, signal),
  post: <T = { ok: true }>(path: string, body: unknown = {}, query?: Query) =>
    request<T>('POST', path, body, query),
  patch: <T = { ok: true }>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = { ok: true }>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = { ok: true }>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
  /** Multipart form (branding images, avatars). */
  form: async <T>(path: string, form: FormData, method = 'POST') => {
    const res = await fetch(`/api${path}`, { method, body: form, credentials: 'include' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok)
      throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? res.statusText, res.status)
    return data as T
  },
  url: (path: string, query?: Query) => withQuery(path.startsWith('/api') ? path : `/api${path}`, query),
}

/** A sentence for any error, for toasts and inline messages. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}
