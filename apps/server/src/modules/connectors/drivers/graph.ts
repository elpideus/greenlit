import type { BrowserContext } from 'playwright-core'
import { type DriverRun, NeedsLogin } from './types.ts'
import { sleep } from './util.ts'

/**
 * The Graph calls Meta Business Suite itself makes. Business Suite pages carry an access token for the signed-in
 * person (the same one its own planner uses); Greenlit reads it from the page when needed and keeps it in memory
 * only — nothing is stored, and no developer app or key is involved.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'
const TOKEN_TTL_MS = 20 * 60_000

interface Tokens {
  user: string
  at: number
  pages: Map<string, string>
}
const tokens = new WeakMap<BrowserContext, Tokens>()

/** Pages that embed the person's token (the first that has one wins). */
const TOKEN_PAGES = [
  // Business Suite settings carry it as BizKitSettingsConfig.apiAccessToken (2026).
  'https://business.facebook.com/latest/settings/business_assets',
  'https://business.facebook.com/business_locations',
  'https://business.facebook.com/latest/home',
  'https://business.facebook.com/content_management',
]

export async function userToken(run: DriverRun): Promise<string | null> {
  const cached = tokens.get(run.context)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.user
  const page = await run.page()
  for (const url of TOKEN_PAGES) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null)
    if (/\/login|checkpoint|loginpage/.test(page.url()))
      throw new NeedsLogin('Facebook asks to sign in again. Reconnect the account.')
    await sleep(1500)
    const html = await page.content().catch(() => '')
    const token = html.match(/"(EAA[A-Za-z0-9]{40,})"/)?.[1] ?? html.match(/\b(EAAG[A-Za-z0-9]{40,})\b/)?.[1]
    if (token) {
      tokens.set(run.context, { user: token, at: Date.now(), pages: new Map() })
      return token
    }
  }
  run.warn('Business Suite did not expose its planner token; Greenlit falls back to reading the pages')
  return null
}

export function rememberPageToken(context: BrowserContext, pageId: string, token: string) {
  tokens.get(context)?.pages.set(pageId, token)
}

/** The Page's own token (from /me/accounts), needed to change or delete Page posts. */
export async function pageToken(run: DriverRun, pageId: string): Promise<string | null> {
  const user = await userToken(run)
  if (!user) return null
  const hit = tokens.get(run.context)?.pages.get(pageId)
  if (hit) return hit
  const res = await graph<{ data?: { id: string; access_token?: string }[] }>(
    run,
    'me/accounts',
    { fields: 'id,access_token', limit: '100' },
    user,
  )
  for (const p of res.data ?? []) if (p.access_token) rememberPageToken(run.context, p.id, p.access_token)
  const listed = tokens.get(run.context)?.pages.get(pageId)
  if (listed) return listed
  // A Page reached through a business portfolio is not in me/accounts: ask the Page itself.
  const own = await graph<{ access_token?: string }>(run, pageId, { fields: 'access_token' }, user).catch(
    () => null,
  )
  if (own?.access_token) rememberPageToken(run.context, pageId, own.access_token)
  return own?.access_token ?? null
}

export class GraphError extends Error {
  readonly code: number | null
  constructor(message: string, code: number | null) {
    super(message)
    this.code = code
  }
}

export async function graph<T>(
  run: DriverRun,
  path: string,
  params: Record<string, string>,
  token: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<T> {
  const url = `${GRAPH}/${path.replace(/^\//, '')}`
  const res = await run.context.request.fetch(url, {
    method,
    params:
      method === 'GET' || method === 'DELETE' ? { ...params, access_token: token } : { access_token: token },
    form: method === 'POST' ? params : undefined,
    timeout: 30_000,
    headers: { referer: 'https://business.facebook.com/' },
  })
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; type?: string }
  }
  if (!res.ok() || body.error) {
    const code = body.error?.code ?? null
    throw new GraphError(body.error?.message ?? `Graph ${res.status()}`, code)
  }
  return body as T
}

/**
 * A Graph call as the person (`user`) or as a Page. An expired token (error 190) is read again from Business
 * Suite once; when that fails too, the session itself is gone.
 */
export async function graphAs<T>(
  run: DriverRun,
  as: 'user' | { pageId: string },
  path: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = as === 'user' ? await userToken(run) : await pageToken(run, as.pageId)
    if (!token) throw new GraphError('Business Suite did not give Greenlit access to this Page', null)
    try {
      return await graph<T>(run, path, params, token, method)
    } catch (err) {
      if (!(err instanceof GraphError) || err.code !== 190) throw err
      tokens.delete(run.context)
      if (attempt >= 1) throw new NeedsLogin('Facebook ended the session. Reconnect the account.')
    }
  }
}
