import { execFile } from 'node:child_process'
import { chmod, mkdir, readlink, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { type BrowserContext, chromium } from 'playwright-core'
import type { Logger } from '../../core/logger.ts'

/**
 * One persistent Chromium profile per signed-in login (DATA_DIR/sessions/<dir>). The profile keeps the cookies,
 * so the owner signs in once and stays signed in across restarts, exactly like their own browser.
 *
 * Contexts open on demand and close after a few idle minutes. Work on the same profile runs one operation at a
 * time (`use`), while a remote sign-in can keep a context open (`hold`) next to it.
 */

const IDLE_MS = 3 * 60_000
/** A real desktop window: the page sees a normal screen, not a headless 800×600. */
export const SCREEN = { width: 1920, height: 1080 }
export const DEFAULT_VIEWPORT = { width: 1366, height: 860 }
/**
 * Pages render at 2× so the remote sign-in looks sharp on Retina screens (headless screencasts only carry the
 * real device scale, not an emulated one). Viewers on 1× screens get frames scaled down by Chromium.
 */
export const DEVICE_SCALE = 2

interface Entry {
  dir: string
  context: Promise<BrowserContext>
  holders: number
  busy: number
  lastUsed: number
  /** Operations on this profile run in order. */
  queue: Promise<unknown>
}

export interface PoolOptions {
  root: string
  executablePath: string
  log: Logger
  timeZone: () => string
  locale: () => string
}

let versionPromise: Promise<string> | null = null
/** Major version of the system Chromium, so the user agent matches the real engine. */
export function chromiumMajor(executablePath: string): Promise<string> {
  versionPromise ??= promisify(execFile)(executablePath, ['--version'], { timeout: 15_000 })
    .then(({ stdout }) => stdout.match(/(\d+)\.\d+\.\d+/)?.[1] ?? '140')
    .catch(() => '140')
  return versionPromise
}

export const userAgentFor = (major: string) =>
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`

export class ProfilePool {
  private entries = new Map<string, Entry>()
  private sweeper: ReturnType<typeof setInterval>
  private opts: PoolOptions

  constructor(opts: PoolOptions) {
    this.opts = opts
    this.sweeper = setInterval(() => void this.sweep(), 30_000)
    this.sweeper.unref?.()
  }

  /** Absolute folder of a profile (refuses anything outside the sessions root). */
  path(rel: string) {
    const abs = resolve(this.opts.root, rel)
    if (!abs.startsWith(resolve(this.opts.root) + sep)) throw new Error('Bad session folder')
    return abs
  }

  isOpen(rel: string) {
    return this.entries.has(this.path(rel))
  }

  private entry(rel: string): Entry {
    const dir = this.path(rel)
    let e = this.entries.get(dir)
    if (!e) {
      const created: Entry = {
        dir,
        context: Promise.resolve(null as never),
        holders: 0,
        busy: 0,
        lastUsed: Date.now(),
        queue: Promise.resolve(),
      }
      created.context = this.launch(dir).catch((err) => {
        this.entries.delete(dir)
        throw err
      })
      this.entries.set(dir, created)
      e = created
    }
    e.lastUsed = Date.now()
    return e
  }

  private async launch(dir: string): Promise<BrowserContext> {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700).catch(() => {})
    await clearStaleLock(dir)
    const major = await chromiumMajor(this.opts.executablePath)
    const locale = this.opts.locale()
    const args = [
      // Sign-in pages (Google, Meta, TikTok) refuse browsers that announce automation.
      '--disable-blink-features=AutomationControlled',
      `--lang=${locale}`,
      '--disable-dev-shm-usage',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--autoplay-policy=no-user-gesture-required',
      `--force-device-scale-factor=${DEVICE_SCALE}`,
    ]
    if (process.getuid?.() === 0) args.push('--no-sandbox')
    this.opts.log.debug({ dir }, 'opening browser profile')
    let context: BrowserContext
    try {
      context = await chromium.launchPersistentContext(dir, {
        executablePath: this.opts.executablePath,
        headless: true,
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
        ],
        args,
        userAgent: userAgentFor(major),
        viewport: DEFAULT_VIEWPORT,
        screen: SCREEN,
        deviceScaleFactor: DEVICE_SCALE,
        locale,
        timezoneId: this.opts.timeZone(),
        colorScheme: 'light',
        acceptDownloads: false,
        extraHTTPHeaders: { 'Accept-Language': acceptLanguage(locale) },
      })
    } catch (err) {
      const msg = (err as Error).message
      if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(msg)) {
        throw new Error(
          'This account’s browser profile is in use by another Greenlit process. Try again in a minute.',
        )
      }
      throw new Error(`Could not start Chromium at ${this.opts.executablePath}: ${msg.split('\n')[0]}`)
    }
    context.setDefaultTimeout(30_000)
    context.setDefaultNavigationTimeout(60_000)
    // Pages opened by sites (pop-ups) never block a run; dialogs are answered like a person would.
    context.on('page', (p) => {
      p.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}))
    })
    for (const p of context.pages()) p.on('dialog', (d) => void d.dismiss().catch(() => {}))
    context.on('close', () => {
      if (this.entries.get(dir)?.context) this.entries.delete(dir)
    })
    return context
  }

  /** Runs `fn` with the profile's context, one operation per profile at a time. */
  async use<T>(rel: string, fn: (context: BrowserContext) => Promise<T>): Promise<T> {
    const e = this.entry(rel)
    e.busy++
    const run = e.queue.then(async () => fn(await e.context))
    e.queue = run.catch(() => {})
    try {
      return await run
    } finally {
      e.busy--
      e.lastUsed = Date.now()
    }
  }

  /** Keeps the profile open (remote sign-in). Call the returned function to let it go. */
  async hold(rel: string): Promise<{ context: BrowserContext; release: () => void }> {
    const e = this.entry(rel)
    e.holders++
    let released = false
    try {
      const context = await e.context
      return {
        context,
        release: () => {
          if (released) return
          released = true
          e.holders = Math.max(0, e.holders - 1)
          e.lastUsed = Date.now()
        },
      }
    } catch (err) {
      e.holders = Math.max(0, e.holders - 1)
      throw err
    }
  }

  async close(rel: string) {
    const dir = this.path(rel)
    const e = this.entries.get(dir)
    if (!e) return
    this.entries.delete(dir)
    await e.context.then((c) => c.close()).catch(() => {})
  }

  /** Deletes a profile folder (closing it first). */
  async destroy(rel: string) {
    await this.close(rel)
    await rm(this.path(rel), { recursive: true, force: true })
  }

  private async sweep() {
    const now = Date.now()
    for (const e of [...this.entries.values()]) {
      if (e.holders || e.busy || now - e.lastUsed < IDLE_MS) continue
      this.entries.delete(e.dir)
      this.opts.log.debug({ dir: e.dir }, 'closing idle browser profile')
      await e.context.then((c) => c.close()).catch(() => {})
    }
  }

  async closeAll() {
    clearInterval(this.sweeper)
    const all = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(all.map((e) => e.context.then((c) => c.close()).catch(() => {})))
  }
}

function acceptLanguage(locale: string) {
  const lang = locale.split('-')[0]!
  return lang === 'en' ? 'en-US,en;q=0.9' : `${locale},${lang};q=0.9,en-US;q=0.8,en;q=0.7`
}

/**
 * Chromium refuses a profile whose lock names another machine or a dead process — which happens after a crash
 * or when the container is recreated (new hostname). The lock is ours to clear when no live process holds it.
 */
async function clearStaleLock(dir: string) {
  const lock = join(dir, 'SingletonLock')
  const target = await readlink(lock).catch(() => null)
  if (!target) return
  const m = target.match(/^(.*)-(\d+)$/)
  const host = m?.[1]
  const pid = Number(m?.[2])
  let alive = false
  if (host === hostname() && pid) {
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      alive = false
    }
  }
  if (alive) return
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie'])
    await rm(join(dir, f), { force: true }).catch(() => {})
}
