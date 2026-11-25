import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../../../core/logger.ts'
import type { PlannedRequest } from '../drivers/types.ts'

/**
 * API Anything (packages/api-anything, a fork of goodnight000/api-anything) runs the platforms' own requests
 * over plain HTTP: operations learned from their web and app traffic, kept as site specs in ./sites, called with
 * the session of the account that signed in.
 *
 * It runs inside this process with:
 * - its state in DATA_DIR/api-anything (specs, sessions, the write ledger);
 * - sessions sealed with a key derived from GREENLIT_SECRET (servers have no OS keychain);
 * - nothing shared with or reported to its public catalog (local only: signed-in operations stay here);
 * - uploads read only from Greenlit's data folder (API_ANYTHING_FILE_ROOTS).
 *
 * One API Anything "site" holds one signed-in session: Greenlit names them per sign-in (and per Facebook Page
 * acted as), from the platform's template spec.
 */

type Lib = typeof import('api-anything')
export type StoredCookie = import('api-anything').StoredCookie
export type CallResult = import('api-anything').CallResult
export type Plan = import('api-anything').Plan

/**
 * A plan as a dry run reports it: a text body cut short, a multipart body's fields, a protobuf body as JSON keyed
 * by field number, the files it would read.
 */
export function plannedRequest(p: Plan, lib?: Lib): PlannedRequest {
  const r = p.request
  const proto =
    r.protobuf !== undefined && lib
      ? JSON.stringify(lib.protobufJson(Buffer.from(r.protobuf, 'base64')))
      : null
  const text = r.body ?? proto ?? (p.body?.fields ? JSON.stringify(p.body.fields) : null)
  return {
    op: p.op,
    method: r.method,
    url: r.url,
    headers: { ...r.headers },
    body: text && text.length > 4000 ? `${text.slice(0, 4000)}…` : text,
    files: [
      ...(p.body?.file ? [{ path: p.body.file.path, bytes: p.body.file.bytes, filename: null }] : []),
      ...(p.body?.files ?? []).map((f) => ({ path: f.path, bytes: f.bytes, filename: f.filename })),
    ],
  }
}

export interface EngineOptions {
  dataDir: string
  secret: string
  chromium: string
  log: Logger
}

/** A call that did not do what was asked; `cls` is API Anything's class (auth, rate, drift, blocked, error…). */
export class EngineError extends Error {
  readonly cls: string
  readonly write: string | undefined
  readonly next: string | undefined
  constructor(op: string, r: CallResult) {
    super(`${op}: ${r.reason ?? r.class}`)
    this.name = 'EngineError'
    this.cls = String(r.class)
    this.write = r.write
    this.next = r.next
  }
  /** The platform signed the session out. */
  get auth() {
    return this.cls === 'auth'
  }
}

const TEMPLATES = join(import.meta.dirname, 'sites')
/** The longest answer the engine hands back (its view.maxChars allows 256 to 200 000; its default is 20 000). */
const MAX_ANSWER_CHARS = 200_000

export class Engine {
  private lib: Promise<Lib> | null = null
  private log: Logger
  private saved = new Map<string, string>()

  constructor(opts: EngineOptions) {
    this.log = opts.log
    const home = join(opts.dataDir, 'api-anything')
    // Set once, before the library is first loaded: it reads them as it starts.
    process.env.API_ANYTHING_HOME = home
    process.env.API_ANYTHING_LOCAL_ONLY = '1'
    process.env.API_ANYTHING_KEY = createHmac('sha256', opts.secret)
      .update('greenlit/api-anything')
      .digest('hex')
    process.env.API_ANYTHING_FILE_ROOTS = opts.dataDir
    if (existsSync(opts.chromium)) process.env.API_ANYTHING_BROWSER ??= opts.chromium
  }

  private load(): Promise<Lib> {
    this.lib ??= import('api-anything')
    return this.lib
  }

  /** The platform's template spec (./sites/<template>.json), saved under `site` when it changed. */
  async ensureSite(site: string, template: string) {
    const raw = readFileSync(join(TEMPLATES, `${template}.json`), 'utf8')
    const hash = createHash('sha1').update(raw).digest('hex')
    if (this.saved.get(site) === hash) return
    const lib = await this.load()
    const spec = lib.parseSite({ ...JSON.parse(raw), name: site })
    lib.saveSite(spec)
    this.saved.set(site, hash)
  }

  /** Hands the cookies of a sign-in (Greenlit's own browser profile) to the site's session. */
  async setCookies(site: string, cookies: StoredCookie[]) {
    const lib = await this.load()
    const s = lib.loadSession(site)
    lib.saveSession(site, { ...s, cookies, source: 'greenlit', updatedAt: new Date().toISOString() })
  }

  async cookies(site: string): Promise<StoredCookie[]> {
    return (await this.load()).loadSession(site).cookies
  }

  /** Sets a session value (`session:<name>` in a spec: the token an app's requests carry). */
  async setValue(site: string, name: string, value: string) {
    const lib = await this.load()
    const s = lib.loadSession(site)
    if (s.values[name] === value) return
    lib.saveSession(site, { ...s, values: { ...s.values, [name]: value } })
  }

  /** Adds a cookie to the session (Facebook's i_user: act as a Page). */
  async putCookie(site: string, cookie: StoredCookie) {
    const lib = await this.load()
    const s = lib.loadSession(site)
    const rest = s.cookies.filter((c) => !(c.name === cookie.name && c.domain === cookie.domain))
    lib.saveSession(site, { ...s, cookies: [...rest, cookie] })
  }

  /**
   * Calls one operation and returns its data. Writes are sent once: `key` (an idempotency key) makes a retry of
   * the same step the same call; a different key is a different write.
   *
   * The engine shortens answers to 20 000 characters by default (it is made for an agent's context). Greenlit wants
   * the whole answer: Instagram's sound search gave 6 of its 13 sounds (each carries its DASH manifest), so most
   * searches showed 5 unrelated sounds and a chosen sound could not be found again to publish. So every call asks
   * for the most the engine keeps, and a still-shortened answer is logged.
   */
  async call<T = unknown>(
    site: string,
    op: string,
    args: Record<string, unknown> = {},
    opts: { write?: boolean; key?: string; timeoutMs?: number; maxTier?: 1 | 2 | 3 } = {},
  ): Promise<T> {
    const lib = await this.load()
    const r = await lib.call(site, op, args, {
      // Plain requests only unless a call asks for more: a higher tier opens API Anything's own browser with the
      // sign-in's cookies, a second browser for one session, which platforms answer by ending it.
      maxTier: opts.maxTier ?? 1,
      timeoutMs: opts.timeoutMs ?? 60_000,
      view: { maxChars: MAX_ANSWER_CHARS },
      ...(opts.write ? { allowWrites: true } : {}),
      ...(opts.key ? { idempotencyKey: opts.key } : {}),
    })
    this.log.debug({ site, op, ok: r.ok, class: r.class, tier: r.tier, ms: r.ms, write: r.write }, 'api call')
    if (r.ok && (r as { truncated?: string }).truncated)
      this.log.warn({ site, op, truncated: (r as { truncated?: string }).truncated }, 'api answer shortened')
    if (!r.ok) throw new EngineError(op, r)
    return r.data as T
  }

  /** The request `call` would send for these args, the session's values masked. Sends nothing. */
  async plan(site: string, op: string, args: Record<string, unknown> = {}) {
    const lib = await this.load()
    return lib.plan(site, op, args)
  }

  /** The plan as a dry run reports it (`plannedRequest`). */
  async planned(site: string, op: string, args: Record<string, unknown> = {}) {
    const lib = await this.load()
    return plannedRequest(lib.plan(site, op, args), lib)
  }

  /** Forgets a sign-in's site and every actor site made from it (`<base>-…`): their specs and sessions. */
  async dropAll(base: string) {
    const home = process.env.API_ANYTHING_HOME!
    const { readdir, rm } = await import('node:fs/promises')
    for (const dir of ['sites', 'sessions']) {
      const names = await readdir(join(home, dir)).catch(() => [] as string[])
      for (const n of names)
        if (n === `${base}.json` || n.startsWith(`${base}-`)) {
          this.saved.delete(n.replace(/\.json$/, ''))
          await rm(join(home, dir, n), { force: true }).catch(() => {})
        }
    }
  }
}
