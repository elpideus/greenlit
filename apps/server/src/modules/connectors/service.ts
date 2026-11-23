import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, link, mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  type Account,
  type Capabilities,
  type Connectable,
  type MusicTrack,
  platformKeepsSchedule,
  type RemoteSession,
} from '@greenlit/shared/areas/connectors'
import type { Placement, Platform } from '@greenlit/shared/areas/posts'
import { asc, eq } from 'drizzle-orm'
import type { BrowserContext, Page } from 'playwright-core'
import sharp from 'sharp'
import { type Actor, actorUserId } from '../../core/actor.ts'
import { badRequest, conflict, HttpError, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { Engine, EngineError } from './aa/engine.ts'
import { ProfilePool } from './browser.ts'
import { parseCookies } from './cookies.ts'
import { driverFor, drivers } from './drivers/index.ts'
import {
  accountKey,
  type ConnectorsService,
  DeviceUnavailable,
  type DiscoveredAccount,
  type Driver,
  type DriverAccount,
  type DriverRun,
  NeedsLogin,
  type PlannedRequest,
  type PublishOutcome,
  type PublishRequest,
  type RemotePost,
  type ScheduleQuestion,
} from './drivers/types.ts'
import { sleep } from './drivers/util.ts'
import { identities, mergeCapabilities, pickConnector, planMerges, sameJson, usable } from './merge.ts'
import { type InputMessage, type LiveSession, RemoteStreams } from './remote.ts'
import { type AccountRow, connectorAccounts } from './schema.ts'
import { previewHostOk, type SoundPreview, SoundPreviews } from './sounds.ts'

declare module '../../core/events.ts' {
  interface Events {
    /** Posts read back from a platform (every sync), so Greenlit can follow changes made on the platform. */
    'connectors.remotePosts': { accountId: string; posts: RemotePost[] }
    /** An account was connected, changed state or was disconnected. */
    'connectors.accountChanged': { id: string; state: Account['state'] | 'removed' }
  }
}

/** Sign-in sessions close after this long without input, or when nobody is watching any more. */
/** The device apps' driver ids (their sign-ins are on Greenlit's Android device). */
const DEVICE: Record<string, true> = Object.fromEntries(
  drivers.filter((d) => d.device).map((d) => [d.id, true]),
)

/** An account a platform's app on the device is signed in to that matches no connected account. */
export interface DeviceAppAccount {
  /** The app ("Facebook"). */
  app: string
  platform: Platform
  name: string
  handle: string
  /** The platform's id of it: a channel, user or profile id. */
  id: string
}

const SESSION_IDLE_MS = 15 * 60_000
const SESSION_UNWATCHED_MS = 2 * 60_000

export class Connectors implements ConnectorsService {
  readonly pool: ProfilePool
  readonly streams: RemoteStreams
  readonly engine: Engine
  readonly sounds: SoundPreviews
  private ctx: ModuleContext
  private sessionsRoot: string
  private watchers = new Map<string, ReturnType<typeof setInterval>>()
  /** The app token last handed to each Android app site (template → token), and renewals under way. */
  private appTokens = new Map<string, string>()
  private renewals = new Map<string, Promise<void>>()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    this.sessionsRoot = join(ctx.config.dataDir, 'sessions')
    this.pool = new ProfilePool({
      root: this.sessionsRoot,
      executablePath: ctx.config.chromium,
      log: ctx.log,
      timeZone: () => this.timeZone(),
      locale: () => this.locale(),
    })
    this.streams = new RemoteStreams(ctx.log, ctx.realtime)
    this.sounds = new SoundPreviews(join(ctx.config.dataDir, 'cache', 'sounds'))
    this.engine = new Engine({
      dataDir: ctx.config.dataDir,
      secret: ctx.config.secret,
      chromium: ctx.config.chromium,
      log: ctx.log.child({ part: 'api-anything' }),
    })
  }

  private get db() {
    return this.ctx.db
  }
  timeZone() {
    return this.ctx.services.platform?.timeZone() ?? this.ctx.config.systemTimeZone
  }
  locale() {
    const l = this.ctx.services.platform?.settings().defaultLocale ?? 'en'
    return l === 'it' ? 'it-IT' : 'en-US'
  }
  avatarDir() {
    return join(this.ctx.config.dataDir, 'connectors', 'avatars')
  }
  runsDir() {
    return join(this.ctx.config.dataDir, 'tmp', 'connectors')
  }

  // ── rows and views ──────────────────────────────────────────────────

  /**
   * The account as Greenlit shows it. `all` (every row) adds what comes from the other rows: the connectors merged
   * into it and what they can do.
   */
  toAccount(r: AccountRow, all: AccountRow[] = [r]): Account {
    const members = all.filter((x) => x.mergedInto === r.id)
    const caps = members.length
      ? (mergeCapabilities([r, ...members].filter(usable)) ?? r.capabilities)
      : r.capabilities
    return {
      id: r.id,
      platform: r.platform as Platform,
      driver: r.driver,
      name: r.name,
      handle: r.handle,
      avatarUrl: r.avatarVersion
        ? `/api/connectors/accounts/${r.id}/avatar?v=${r.avatarVersion}`
        : r.avatarUrl,
      profileUrl: r.profileUrl,
      state: r.state,
      stateMessage: r.stateMessage,
      capabilities: caps,
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      signIn: {
        id: createHash('sha256').update(r.sessionDir).digest('hex').slice(0, 16),
        name: r.signIn?.name ?? '',
        handle: r.signIn?.handle ?? '',
        avatarUrl: r.signIn?.avatarUrl ?? null,
      },
      mergedInto: r.mergedInto && all.some((x) => x.id === r.mergedInto) ? r.mergedInto : null,
      alsoThrough: members.map((m) => ({ id: m.id, driver: m.driver, state: m.state })),
    }
  }

  async rows(): Promise<AccountRow[]> {
    return this.db
      .select()
      .from(connectorAccounts)
      .orderBy(asc(connectorAccounts.platform), asc(connectorAccounts.createdAt))
  }

  async row(id: string): Promise<AccountRow> {
    const [r] = await this.db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id))
    if (!r) throw notFound('Account not found')
    return r
  }

  async accounts(): Promise<Account[]> {
    const all = await this.rows()
    return all.map((r) => this.toAccount(r, all))
  }

  async account(id: string): Promise<Account> {
    const all = await this.rows()
    const r = all.find((x) => x.id === id)
    if (!r) throw notFound('Account not found')
    return this.toAccount(r, all)
  }

  private announce(id: string, state: Account['state'] | 'removed') {
    this.ctx.realtime.publish('connectors', 'accounts.changed', { id, state })
    this.ctx.events.emit('connectors.accountChanged', { id, state })
  }

  private async patch(id: string, set: Partial<typeof connectorAccounts.$inferInsert>) {
    await this.db
      .update(connectorAccounts)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(connectorAccounts.id, id))
  }

  /** Moves an account to a new state; tells the admins when it needs a new sign-in. */
  private async setState(r: AccountRow, state: Account['state'], message: string | null) {
    await this.patch(r.id, { state, stateMessage: message, lastCheckedAt: new Date() })
    if (state !== r.state || message !== r.stateMessage) this.announce(r.id, state)
    if (state === 'needs_login' && r.state !== 'needs_login') await this.notifyAdmins(r, message)
  }

  private async notifyAdmins(r: AccountRow, message: string | null) {
    const notify = this.ctx.services.notifications?.notify
    if (!notify) return
    const admins = (await this.ctx.services.users.list())
      .filter((u) => u.role === 'admin' && !u.disabled)
      .map((u) => u.id)
    const name = r.handle ? `${r.name} (${r.handle})` : r.name
    await notify(admins, {
      kind: 'connectors.needs_login',
      title: `${platformName(r.platform as Platform)}: sign in to ${name} again`,
      body:
        message ??
        'The platform ended the session. Reconnect it in Settings → Connected accounts; scheduled posts already on the platform are not affected.',
      link: '/settings/accounts',
      entityType: 'connector_account',
      entityId: r.id,
    }).catch((err) => this.ctx.log.warn({ err }, 'could not notify about the account'))
  }

  // ── running a driver operation ──────────────────────────────────────

  private driverOf(r: AccountRow): Driver {
    const d = drivers.find((x) => x.id === r.driver) ?? driverFor(r.platform as Platform)
    if (!d) throw new HttpError('unavailable', `No connector for ${r.platform}`)
    return d
  }

  private asDriverAccount(r: AccountRow): DriverAccount {
    return {
      id: r.id,
      platform: r.platform as Platform,
      externalId: r.externalId,
      name: r.name,
      handle: r.handle,
      platformIds: r.platformIds,
    }
  }

  /**
   * Runs one driver operation in the account's browser profile. Tabs it opens are closed afterwards; when it
   * fails, a picture of each open tab and the steps so far are kept in DATA_DIR/tmp/connectors/<run>/ for diagnosis.
   */
  private async operate<T>(
    sessionDir: string,
    what: string,
    fn: (run: DriverRun & { runId: string; steps: string[]; warnings: string[] }) => Promise<T>,
    opts: { accountId?: string; keepPages?: boolean; driver?: Driver; account?: DriverAccount } = {},
  ): Promise<T> {
    if (opts.driver?.kind === 'api')
      return this.operateApi(sessionDir, what, fn, opts.driver, opts.account, opts.accountId)
    return this.pool.use(sessionDir, async (context: BrowserContext) => {
      const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const dir = join(this.runsDir(), runId)
      const pages: Page[] = []
      const steps: string[] = []
      const warnings: string[] = []
      const log = this.ctx.log.child({ connector: what, account: opts.accountId })
      const run = {
        runId,
        steps,
        warnings,
        context,
        log,
        timeZone: this.timeZone(),
        locale: this.locale(),
        dataDir: this.ctx.config.dataDir,
        page: async () => {
          const p = await context.newPage()
          pages.push(p)
          return p
        },
        step: (m: string) => {
          steps.push(m)
          log.info({ step: m }, 'connector step')
        },
        warn: (m: string) => {
          warnings.push(m)
          log.info({ warning: m }, 'connector warning')
        },
        snapshot: async (page: Page, name: string) => {
          try {
            await mkdir(dir, { recursive: true })
            const file = `${name.replace(/[^\w-]+/g, '-')}.jpg`
            await writeFile(
              join(dir, file),
              await page.screenshot({ type: 'jpeg', quality: 72, scale: 'css', timeout: 10_000 }),
            )
            return `/api/connectors/runs/${runId}/${file}`
          } catch {
            return null
          }
        },
      }
      try {
        return await fn(run)
      } catch (err) {
        for (const [i, p] of pages.entries()) if (!p.isClosed()) await run.snapshot(p, `failed-${i + 1}`)
        if (steps.length) {
          await mkdir(dir, { recursive: true }).catch(() => {})
          await writeFile(
            join(dir, 'steps.txt'),
            [...steps, `FAILED: ${(err as Error).message}`].join('\n'),
          ).catch(() => {})
        }
        log.warn({ err: (err as Error).message, steps, run: runId }, `connector ${what} failed`)
        throw err
      } finally {
        if (!opts.keepPages) for (const p of pages) await p.close().catch(() => {})
      }
    })
  }

  /** The API Anything site of a sign-in. */
  baseSite(sessionDir: string) {
    return `gl-${sessionDir}`
  }

  /**
   * An API Anything driver's operation: the platform's own requests sent with the sign-in's session, no
   * browser. Steps and warnings are recorded as for a browser run; a session the platform ended is NeedsLogin.
   */
  private async operateApi<T>(
    sessionDir: string,
    what: string,
    fn: (run: DriverRun & { runId: string; steps: string[]; warnings: string[] }) => Promise<T>,
    driver: Driver,
    account: DriverAccount | undefined,
    accountId: string | undefined,
  ): Promise<T> {
    const site = this.baseSite(sessionDir)
    // A device app's sign-in has no web session of its own: its requests are the app's (`app`).
    if (driver.template && !driver.device) await this.engine.ensureSite(site, driver.template)
    const actor = account ? driver.actorSite?.(account, site) : null
    let actorReady: Promise<string> | null = null
    // The actor's session is the sign-in's, plus what makes requests act as it (Facebook's i_user); made on
    // the first call that acts as the account.
    const actorSite = () =>
      (actorReady ??= (async () => {
        if (!actor) return site
        await this.engine.ensureSite(actor.site, driver.template!)
        const cookies = await this.engine.cookies(site)
        const extra = actor.cookies ?? []
        const domain = cookies.find((c) => c.name === 'c_user')?.domain ?? cookies[0]?.domain ?? ''
        await this.engine.setCookies(actor.site, [
          ...cookies.filter((c) => !extra.some((x) => x.name === c.name)),
          ...extra.map((x) => ({
            name: x.name,
            value: x.value,
            domain,
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
          })),
        ])
        return actor.site
      })())
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const dir = join(this.runsDir(), runId)
    const steps: string[] = []
    const warnings: string[] = []
    const planned: PlannedRequest[] = []
    const dryRun = what === 'dry-run'
    const log = this.ctx.log.child({ connector: what, account: accountId, engine: 'api-anything' })
    const noBrowser = () => {
      throw new Error(`${driver.id} works through API Anything and opens no browser`)
    }
    const run = {
      runId,
      steps,
      warnings,
      get context(): BrowserContext {
        return noBrowser()
      },
      log,
      timeZone: this.timeZone(),
      locale: this.locale(),
      dataDir: this.ctx.config.dataDir,
      page: async () => noBrowser(),
      step: (m: string) => {
        steps.push(m)
        log.info({ step: m }, 'connector step')
      },
      warn: (m: string) => {
        warnings.push(m)
        log.info({ warning: m }, 'connector warning')
      },
      snapshot: async () => null,
      api: {
        site,
        dryRun,
        planned,
        call: async <R>(
          op: string,
          args?: Record<string, unknown>,
          o?: Parameters<Engine['call']>[3] & { asActor?: boolean },
        ) => {
          const target = o?.asActor ? await actorSite() : site
          if (dryRun && o?.write) {
            const p = await this.engine.planned(target, op, args)
            planned.push(p)
            steps.push(`Would send ${op}: ${p.method} ${p.url.split('?')[0]}`)
            log.info({ planned: op }, 'connector dry run: write not sent')
            return {} as R
          }
          return this.engine.call<R>(target, op, args, o).catch((err) => {
            if (err instanceof EngineError && err.auth) throw new NeedsLogin(err.message)
            throw err
          })
        },
        app: async <R>(
          op: string,
          args?: Record<string, unknown>,
          o?: { write?: boolean; key?: string; timeoutMs?: number },
        ) => {
          const app = driver.app
          if (!app) throw new Error(`${driver.id} has no Android app operations`)
          await this.assertAppOn(app.package)
          const appSite = `gl-app-${app.template}`
          await this.engine.ensureSite(appSite, app.template)
          if (dryRun && o?.write) {
            const p = await this.engine.planned(appSite, op, args)
            planned.push(p)
            steps.push(`Would send ${op}: ${p.method} ${p.url.split('?')[0]}`)
            log.info({ planned: op }, 'connector dry run: write not sent')
            return {} as R
          }
          if (!this.appTokens.has(app.template)) await this.appToken(app, appSite, false)
          const send = () => this.engine.call<R>(appSite, op, args, { ...o, maxTier: 1 })
          try {
            return await send()
          } catch (err) {
            if (!(err instanceof EngineError && err.auth)) throw err
            await this.appToken(app, appSite, true)
            return send().catch((e) => {
              if (e instanceof EngineError && e.auth)
                throw new DeviceUnavailable(
                  `The ${app.name} app on Greenlit's Android device is signed out: sign in to it again there.`,
                )
              throw e
            })
          }
        },
        appFiles: {
          read: async (rel: string) => {
            if (!driver.app) throw new Error(`${driver.id} has no Android app`)
            return this.device().appRead(driver.app.package, rel)
          },
          list: async (rel: string) => {
            if (!driver.app) throw new Error(`${driver.id} has no Android app`)
            return this.device().appList(driver.app.package, rel)
          },
        },
        cookies: () => this.engine.cookies(site),
        // The page gets the session API Anything keeps up to date (a profile filled by a cookie import, or not
        // opened for a while, holds older cookies; Google would ask to sign in again).
        browser: <R>(fn: (r: DriverRun) => Promise<R>) =>
          this.operate(
            sessionDir,
            `${what}.page`,
            async (r) => {
              const fresh = await this.engine.cookies(site).catch(() => [])
              if (fresh.length)
                await r.context
                  .addCookies(
                    fresh.map((c) => ({
                      name: c.name,
                      value: c.value,
                      domain: c.domain,
                      path: c.path || '/',
                      expires: c.expires ?? -1,
                      httpOnly: !!c.httpOnly,
                      secure: !!c.secure,
                    })),
                  )
                  .catch((err) => log.warn({ err: (err as Error).message }, 'session not handed to the page'))
              // What the page's steps did and warned about is this run's too (a dry run reports it).
              try {
                return await fn(r)
              } finally {
                for (const m of r.steps) if (!steps.includes(m)) steps.push(m)
                for (const m of r.warnings) if (!warnings.includes(m)) warnings.push(m)
              }
            },
            { accountId },
          ),
      },
    }
    try {
      return await fn(run)
    } catch (err) {
      if (steps.length) {
        await mkdir(dir, { recursive: true }).catch(() => {})
        await writeFile(
          join(dir, 'steps.txt'),
          [...steps, `FAILED: ${(err as Error).message}`].join('\n'),
        ).catch(() => {})
      }
      log.warn({ err: (err as Error).message, steps, run: runId }, `connector ${what} failed`)
      throw err
    }
  }

  /**
   * Hands the token the platform's Android app holds on Greenlit's device to the app's API Anything site.
   * `renew`: the platform refused it (they last about an hour): the app is started, which has Google renew it,
   * and the new one is read once it is there.
   */
  /** Greenlit's Android device, or DeviceUnavailable when none is set up. */
  private device() {
    const device = this.ctx.services.android?.device
    if (!device?.configured)
      throw new DeviceUnavailable(
        "This needs Greenlit's Android device, and no device is set up (GREENLIT_ANDROID_ADB).",
      )
    return device
  }

  /** A device app switched off in Greenlit is not used, for any account. */
  private async assertAppOn(pkg: string) {
    const ids = drivers.filter((d) => d.device && d.app?.package === pkg).map((d) => d.id)
    const rows = (await this.rows()).filter((r) => ids.includes(r.driver))
    if (rows.length && rows.every((r) => r.state === 'disabled'))
      throw new DeviceUnavailable(
        `The ${drivers.find((d) => d.id === ids[0])?.app?.name ?? 'app'} app on Greenlit's Android device is switched off in Greenlit (Settings → Connected accounts).`,
      )
  }

  /**
   * Finds who is signed in to the platforms' apps on Greenlit's Android device. An app's account joins the account
   * already connected that it is (merged into it by real ids); one that matches none is left out (a sign-in on
   * the device never connects an account by itself, nor brings back one that was disconnected). An app signed out
   * there leaves its accounts needing a sign-in. `unmatched` names the apps' accounts that joined none, so the person
   * scanning sees why nothing happened (the app signed in to another account than the one connected here).
   */
  async scanDevice(): Promise<{ joined: Account[]; signedOut: string[]; unmatched: DeviceAppAccount[] }> {
    const device = this.ctx.services.android?.device
    const joined: Account[] = []
    const signedOut: string[] = []
    const unmatched: DeviceAppAccount[] = []
    if (!device?.configured) return { joined, signedOut, unmatched }
    for (const d of drivers.filter((x) => x.device && x.app)) {
      if (!(await device.hasApp(d.app!.package).catch(() => false))) continue
      const sessionDir = `device-${d.id}`
      let found: DiscoveredAccount[]
      try {
        found = await this.operateApi(
          sessionDir,
          'discover',
          (run) => d.discover(run),
          d,
          undefined,
          undefined,
        )
      } catch (err) {
        const rows = (await this.rows()).filter((r) => r.driver === d.id && r.state !== 'disabled')
        for (const r of rows) await this.setState(r, 'needs_login', (err as Error).message)
        if (rows.length) signedOut.push(d.name)
        this.ctx.log.info({ driver: d.id, err: (err as Error).message }, 'device app not read')
        continue
      }
      const rows = (await this.rows()).filter((r) => r.driver !== d.id && !(r.driver in DEVICE))
      const joining = found.filter((f) =>
        rows.some((r) => r.platform === f.platform && identities(r).some((x) => identities(f).includes(x))),
      )
      for (const f of found.filter((x) => !joining.includes(x)))
        unmatched.push({
          app: d.app!.name,
          platform: f.platform,
          name: f.name,
          handle: f.handle,
          id: f.externalId.replace(/^app:/, ''),
        })
      if (!joining.length) continue
      const saved = await this.saveDiscovered(joining, d, sessionDir, null, null)
      // Joining an account that is switched off: the app's part of it is off too.
      const now = await this.rows()
      for (const a of saved) {
        const r = now.find((x) => x.id === a.id)
        const main = r?.mergedInto ? now.find((x) => x.id === r.mergedInto) : null
        if (r && main?.state === 'disabled' && r.state !== 'disabled') await this.setOneEnabled(r.id, false)
      }
      for (const a of saved) joined.push(await this.account(a.id))
    }
    return { joined, signedOut, unmatched }
  }

  private appToken(app: NonNullable<Driver['app']>, site: string, renew: boolean) {
    const running = this.renewals.get(app.template)
    if (running) return running
    const work = (async () => {
      const device = this.device()
      if (!app.scope) throw new Error(`The ${app.name} app's requests need no token Greenlit reads`)
      const scope = app.scope
      const before = this.appTokens.get(app.template) ?? null
      let token = await device.appToken(app.package, scope)
      if (renew) {
        await device.launch(app.package)
        const until = Date.now() + 45_000
        while ((!token || token === before) && Date.now() < until) {
          await sleep(3000)
          token = await device.appToken(app.package, scope)
        }
        this.ctx.log.info({ app: app.package, renewed: !!token && token !== before }, 'android app token')
      }
      if (!token)
        throw new DeviceUnavailable(
          `Sign in to the ${app.name} app on Greenlit's Android device (Settings → Connected accounts → Android device).`,
        )
      await this.engine.setValue(site, 'androidToken', token)
      this.appTokens.set(app.template, token)
    })().finally(() => this.renewals.delete(app.template))
    this.renewals.set(app.template, work)
    return work
  }

  /** Gives an API Anything driver the cookies its sign-in left in the browser profile. */
  private async handOver(context: BrowserContext, driver: Driver, sessionDir: string) {
    if (driver.kind !== 'api') return
    const wanted = driver.signIn.cookieDomains
    const cookies = (await context.cookies()).filter((c) =>
      wanted.some((d) => c.domain.replace(/^\./, '') === d || c.domain.endsWith(`.${d}`)),
    )
    const site = this.baseSite(sessionDir)
    await this.engine.ensureSite(site, driver.template!)
    await this.engine.setCookies(
      site,
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      })),
    )
  }

  /** A driver call on an account: marks the account when the session turns out to be gone. */
  private async onAccount<T>(
    id: string,
    what: string,
    fn: (
      d: Driver,
      run: DriverRun & { runId: string; steps: string[]; warnings: string[] },
      a: DriverAccount,
    ) => Promise<T>,
  ): Promise<T> {
    const r = await this.row(id)
    if (r.state === 'disabled') throw conflict('This account is turned off')
    const d = this.driverOf(r)
    try {
      const a = this.asDriverAccount(r)
      return await this.operate(r.sessionDir, what, (run) => fn(d, run, a), {
        accountId: id,
        driver: d,
        account: a,
      })
    } catch (err) {
      if (err instanceof NeedsLogin) {
        await this.setState(r, 'needs_login', err.message || 'Signed out on the platform')
        throw new HttpError(
          'conflict',
          `${platformName(r.platform as Platform)} needs you to sign in again (Settings → Connected accounts)`,
        )
      }
      throw err
    }
  }

  // ── the service other modules use ───────────────────────────────────

  /** The connector of an account that publishes this post: the main one, or the one merged into it that can. */
  private async publisherFor(req: ScheduleQuestion) {
    const members = await this.group(req.accountId)
    const main = members[0]!
    return members.length > 1
      ? (pickConnector(members, {
          placement: req.placement,
          music: !!req.music,
          location: !!req.location,
          firstComment: !!req.firstComment.trim(),
          thumbnail: !!req.thumbnailPath,
          translations: Object.keys(req.translations).length > 0,
        }) ?? main)
      : main
  }

  /**
   * Whether the platform keeps this post's schedule for `at` itself (through the connector that would publish it).
   * When it does not, Greenlit holds the post and publishes it at its time.
   */
  async holdsSchedule(req: ScheduleQuestion, at: Date): Promise<boolean> {
    const chosen = await this.publisherFor(req)
    return platformKeepsSchedule(chosen.capabilities, req.placement, at)
  }

  async publish(req: PublishRequest): Promise<PublishOutcome> {
    // An account other connectors are merged into: the one that can do what the post asks publishes it.
    const members = await this.group(req.accountId)
    const main = members[0]!
    const chosen = await this.publisherFor(req)
    if (chosen.id !== main.id) {
      const out = await this.publish({ ...req, accountId: chosen.id })
      return { ...out, viaAccountId: chosen.id }
    }
    const r = main
    // A dry run sends nothing, so it may rehearse a connector whose publishing is not switched on yet.
    if (r.capabilities.publish === false && !req.dryRun)
      throw badRequest(`Greenlit cannot publish to ${r.name} on ${platformName(r.platform as Platform)} yet`)
    if (!r.capabilities.placements.includes(req.placement))
      throw badRequest(
        `${platformName(r.platform as Platform)} cannot publish a ${req.placement} from Greenlit`,
      )
    if (!req.files.length && req.placement !== 'post') throw badRequest('Nothing to publish')
    for (const f of req.files) if (!existsSync(f.path)) throw badRequest(`File not found: ${f.path}`)
    const staged = await this.stage(req)
    try {
      return await this.onAccount(req.accountId, req.dryRun ? 'dry-run' : 'publish', async (d, run, a) => {
        const out = await d.publish(run, a, staged.req)
        if (run.warnings.length) out.warnings = [...run.warnings]
        if (req.dryRun)
          out.dryRun = {
            ...(out.dryRun ?? { screenshot: null, wouldPress: null }),
            steps: run.steps,
            warnings: run.warnings,
            ...(run.api?.planned.length ? { requests: run.api.planned } : {}),
          }
        return out
      })
    } finally {
      await rm(staged.dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Stored files have no extension, and the platforms' file pickers go by the name: each file is handed over as
   * a link named like a normal export (greenlit-1.mp4), removed again when the operation ends.
   */
  private async stage(req: PublishRequest): Promise<{ dir: string; req: PublishRequest }> {
    const dir = join(this.runsDir(), 'staged', randomUUID())
    const named = async (path: string, mime: string | null, name: string) => {
      const ext = EXT_BY_MIME[mime ?? ''] ?? (await sniffExt(path))
      if (!ext || extname(path).toLowerCase() === ext) return path
      await mkdir(dir, { recursive: true })
      const dest = join(dir, `${name}${ext}`)
      await link(path, dest).catch(() => copyFile(path, dest))
      return dest
    }
    const files = []
    for (const [i, f] of req.files.entries())
      files.push({ ...f, path: await named(f.path, f.mime, `greenlit-${i + 1}`) })
    const thumbnailPath = req.thumbnailPath ? await named(req.thumbnailPath, null, 'greenlit-cover') : null
    return { dir, req: { ...req, files, thumbnailPath } }
  }

  /** Writes (publish, update, remove) refuse on an account whose publishing is not switched on yet. */
  private async writable(accountId: string) {
    const r = await this.row(accountId)
    if (r.capabilities.publish === false)
      throw badRequest(
        `Greenlit cannot change posts of ${r.name} on ${platformName(r.platform as Platform)} yet`,
      )
  }

  async update(accountId: string, remoteId: string, patch: Partial<PublishRequest>): Promise<void> {
    await this.writable(accountId)
    await this.onAccount(accountId, 'update', (d, run, a) => d.update(run, a, remoteId, patch))
  }

  async remove(accountId: string, remoteId: string): Promise<void> {
    await this.writable(accountId)
    await this.onAccount(accountId, 'remove', (d, run, a) => d.remove(run, a, remoteId))
  }

  async list(accountId: string, opts: { since?: Date } = {}): Promise<RemotePost[]> {
    return this.onAccount(accountId, 'list', (d, run, a) => d.list(run, a, opts))
  }

  private musicCache = new Map<string, { at: number; tracks: MusicTrack[] }>()
  /**
   * The connector of an account that has sounds (for a placement): the account's own, else one merged into it
   * (Business Suite for a Facebook Page).
   */
  private async musicFrom(accountId: string, placement?: Placement): Promise<AccountRow | null> {
    const members = await this.group(accountId)
    return (
      members.find(
        (m) =>
          usable(m) &&
          m.state !== 'needs_login' &&
          m.capabilities.music &&
          (!placement || m.capabilities.placements.includes(placement as never)),
      ) ?? null
    )
  }

  async searchMusic(accountId: string, query: string, placement: Placement): Promise<MusicTrack[]> {
    const from = await this.musicFrom(accountId, placement)
    if (!from) return []
    const key = `${from.id}|${placement}|${query.trim().toLowerCase()}`
    const hit = this.musicCache.get(key)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.tracks
    const tracks = await this.onAccount(from.id, 'music', (d, run, a) =>
      d.searchMusic(run, a, query.trim(), placement),
    )
    this.musicCache.set(key, { at: Date.now(), tracks })
    if (this.musicCache.size > 200) this.musicCache.delete(this.musicCache.keys().next().value!)
    return tracks
  }

  async soundPreview(accountId: string, trackId: string, previewUrl?: string | null): Promise<SoundPreview> {
    const from = await this.musicFrom(accountId)
    if (!from) throw badRequest('This account has no sounds')
    if (previewUrl && !previewHostOk(previewUrl)) throw badRequest('Not a platform media link')
    const d = this.driverOf(from)
    return this.sounds.get(from.platform, trackId, async () => {
      if (d.soundAudio) {
        const src = await this.onAccount(from.id, 'sound', (dr, run, a) => dr.soundAudio!(run, a, trackId))
        if (src) return src
      }
      return previewUrl ? { url: previewUrl } : null
    })
  }

  // ── health and sync ─────────────────────────────────────────────────

  async check(id: string): Promise<Account> {
    const r = await this.row(id)
    if (r.state === 'disabled') return this.account(id)
    const d = this.driverOf(r)
    try {
      const a = this.asDriverAccount(r)
      const res = await this.operate(r.sessionDir, 'check', (run) => d.check(run, a), {
        accountId: id,
        driver: d,
        account: a,
      })
      if (res.ok) await this.setState(r, 'connected', null)
      else await this.setState(r, 'needs_login', res.reason)
      await this.patch(id, { capabilities: d.capabilities(r.platform as Platform, a) })
    } catch (err) {
      if (err instanceof NeedsLogin) await this.setState(r, 'needs_login', err.message)
      else if (/in use by another Greenlit process/.test((err as Error).message))
        this.ctx.log.info({ id }, 'account busy, check skipped')
      else
        await this.setState(
          r,
          'error',
          `Could not check the account: ${(err as Error).message.slice(0, 300)}`,
        )
    }
    return this.account(id)
  }

  async checkAll() {
    const out: Account[] = []
    for (const r of await this.rows())
      if (r.state !== 'disabled' && r.state !== 'connecting') out.push(await this.check(r.id))
    return out
  }

  async sync(id: string): Promise<{ posts: number }> {
    const r = await this.row(id)
    if (r.state !== 'connected' || !r.capabilities.sync) return { posts: 0 }
    const since = r.lastSyncedAt ? new Date(r.lastSyncedAt.getTime() - 14 * 86_400_000) : undefined
    const posts = await this.list(id, { since })
    await this.patch(id, { lastSyncedAt: new Date() })
    this.ctx.events.emit('connectors.remotePosts', { accountId: id, posts })
    this.ctx.realtime.publish('connectors', 'accounts.synced', { id, posts: posts.length })
    return { posts: posts.length }
  }

  async syncAll() {
    let total = 0
    for (const r of await this.rows()) {
      if (r.state !== 'connected' || !r.capabilities.sync) continue
      try {
        total += (await this.sync(r.id)).posts
      } catch (err) {
        this.ctx.log.warn({ err: (err as Error).message, account: r.id }, 'sync failed')
      }
    }
    return { posts: total }
  }

  // ── connecting ──────────────────────────────────────────────────────

  /** Starts a remote sign-in for a platform (or reconnects an account in its own profile). */
  async startSession(
    input: {
      platform: Platform
      /** The connector to sign in for, when the platform has several (Facebook: facebook.com or Business Suite). */
      driver?: string | null
      accountId?: string | null
      width?: number
      height?: number
      dpr?: number
      startUrl?: string
    },
    actor: Actor,
  ): Promise<RemoteSession> {
    let sessionDir: string
    let accountId: string | null = null
    let driverId = input.driver ?? null
    if (input.accountId) {
      const r = await this.row(input.accountId)
      if (r.platform !== input.platform) throw badRequest('That account is on another platform')
      sessionDir = r.sessionDir
      accountId = r.id
      driverId = r.driver
    } else sessionDir = randomUUID()
    const driver = driverFor(input.platform, driverId)
    if (!driver) throw badRequest(`No connector for ${input.platform}`)
    // One sign-in per profile at a time.
    for (const s of this.streams.all())
      if (s.sessionDir === sessionDir) await this.closeSession(s.id, 'Replaced by a new sign-in')

    const { context, release } = await this.pool.hold(sessionDir)
    const s = await this.streams.open({
      id: randomUUID(),
      platform: input.platform,
      driverId: driver.id,
      accountId,
      sessionDir,
      userId: actorUserId(actor),
      context,
      release,
      // Development only: open another page (to try the remote browser on harmless sites).
      url:
        input.startUrl && !this.ctx.config.isProd && /^https:\/\//.test(input.startUrl)
          ? input.startUrl
          : driver.signIn.url,
      width: clampInt(input.width ?? 1180, 360, 2560),
      height: clampInt(input.height ?? 760, 320, 1600),
      dpr: Math.max(1, Math.min(2, input.dpr ?? 1)),
    })
    this.watch(s, driver)
    return this.streams.view(s)
  }

  session(id: string): RemoteSession {
    const s = this.streams.get(id)
    if (!s) throw notFound('This sign-in window is closed')
    return this.streams.view(s)
  }

  async input(id: string, msg: InputMessage) {
    const s = this.streams.get(id)
    if (!s) return
    await this.streams.input(s, msg, () => {})
  }

  /** The last frame, for a viewer that just subscribed. */
  lastFrame(id: string) {
    const s = this.streams.get(id)
    return s
      ? {
          frame: s.lastFrame,
          state: {
            ...this.streams.view(s),
            title: s.title,
            loading: s.loading,
            canGoBack: s.canGoBack,
            canGoForward: s.canGoForward,
            dpr: s.dpr,
          },
        }
      : null
  }

  async closeSession(id: string, reason: string | null = null) {
    const s = this.streams.get(id)
    if (!s) return
    clearInterval(this.watchers.get(id))
    this.watchers.delete(id)
    if (s.state === 'ready' || s.state === 'starting') await this.logUnfinished(s)
    await this.streams.close(s, reason)
    // A fresh profile nobody signed in with is thrown away.
    if (!s.accountId && !(await this.referenced(s.sessionDir))) {
      this.discovered.delete(s.sessionDir)
      await this.pool.destroy(s.sessionDir).catch(() => {})
    }
  }

  /**
   * A sign-in window closed before Greenlit saw a session: which cookies the platform had set by then (names
   * only, never values) and where the page was, so a sign-in that never registers can be told apart.
   */
  private async logUnfinished(s: LiveSession) {
    const d = driverFor(s.platform, s.driverId)
    const urls = (d?.signIn.cookieDomains ?? []).map((x) => `https://www.${x}`)
    const names = await s.context
      .cookies(urls)
      .then((cs) => [...new Set(cs.map((c) => c.name))].sort())
      .catch(() => [] as string[])
    this.ctx.log.info(
      { platform: s.platform, driver: s.driverId, page: s.page.url().split('?')[0], cookieNames: names },
      'sign-in closed before Greenlit saw a session',
    )
  }

  private async referenced(sessionDir: string) {
    const rows = await this.db
      .select({ id: connectorAccounts.id })
      .from(connectorAccounts)
      .where(eq(connectorAccounts.sessionDir, sessionDir))
      .limit(1)
    return rows.length > 0
  }

  /** Polls the profile while the sign-in window is open; reads the account as soon as it is signed in. */
  private watch(s: LiveSession, driver: Driver) {
    let busy = false
    let lastAttemptUrl = ''
    let lastAttemptAt = 0
    const tick = async () => {
      if (busy || s.closing) return
      busy = true
      try {
        const now = Date.now()
        if (this.ctx.realtime.subscribers(this.streams.topic(s.id)).length) s.lastSeenViewer = now
        if (now - s.lastInput > SESSION_IDLE_MS)
          return void (await this.closeSession(s.id, 'Closed after 15 minutes without activity'))
        if (now - s.lastSeenViewer > SESSION_UNWATCHED_MS)
          return void (await this.closeSession(s.id, 'The sign-in window was closed'))
        if (s.state === 'signed_in' || s.state === 'choosing') return
        if (!(await driver.looksSignedIn(s.context))) return
        // Signed in: read the profile (again only when the page moved on or after a while).
        if (s.state === 'failed' && s.url === lastAttemptUrl && now - lastAttemptAt < 20_000) return
        lastAttemptUrl = s.url
        lastAttemptAt = now
        this.streams.setState(s, 'signed_in', 'Signed in — reading your account…')
        try {
          await this.handOver(s.context, driver, s.sessionDir)
          const found = await this.discover(s.sessionDir, driver, true)
          if (!found.length) {
            this.streams.setState(s, 'failed', noAccountsMessage(s.platform))
            return
          }
          // Everything the sign-in reaches is connected (every YouTube channel, every Page and its Instagram):
          // where a post goes is chosen when publishing, not here.
          await this.finishSession(s, found, driver)
        } catch (err) {
          this.ctx.log.warn(
            { err: (err as Error).message, platform: s.platform },
            'reading the signed-in account failed',
          )
          this.streams.setState(
            s,
            'failed',
            `Signed in, but Greenlit could not read the account yet (${(err as Error).message.slice(0, 160)}). Finish any step on the page; Greenlit tries again.`,
          )
        }
      } catch (err) {
        this.ctx.log.debug({ err }, 'sign-in watcher')
      } finally {
        busy = false
      }
    }
    this.watchers.set(
      s.id,
      setInterval(() => void tick(), 1500),
    )
  }

  private async finishSession(s: LiveSession, chosen: DiscoveredAccount[], driver: Driver) {
    const accounts = await this.saveDiscovered(chosen, driver, s.sessionDir, s.userId, s.accountId)
    s.choices = null
    s.found = null
    this.streams.setState(s, 'signed_in', 'Connected', { kind: 'connected', accounts })
    setTimeout(() => void this.closeSession(s.id, 'Connected'), 1200)
    return accounts
  }

  /** Connects the accounts the owner picked after signing in (`keys` are `platform:externalId`). */
  async choose(sessionId: string, keys: string[]): Promise<Account[]> {
    const s = this.streams.get(sessionId)
    if (!s) throw notFound('This sign-in window is closed')
    if (s.state !== 'choosing' || !s.found) throw conflict('This sign-in has nothing to choose from')
    const chosen = s.found.filter((f) => keys.includes(accountKey(f.platform, f.externalId)))
    if (!chosen.length) throw badRequest('Choose at least one account')
    const driver = driverFor(s.platform, s.driverId)
    if (!driver) throw badRequest(`No connector for ${s.platform}`)
    return this.finishSession(s, chosen, driver)
  }

  /** What a discovery found, as choices (with the Greenlit account each already is, if any). */
  private connectables(found: DiscoveredAccount[], rows: AccountRow[]): Connectable[] {
    return found.map((f) => ({
      key: accountKey(f.platform, f.externalId),
      platform: f.platform,
      externalId: f.externalId,
      name: f.name,
      handle: f.handle,
      avatarUrl: f.avatarUrl,
      profileUrl: f.profileUrl,
      via: f.via ?? null,
      linkedTo: f.linkedTo ?? null,
      accountId: rows.find((r) => r.platform === f.platform && r.externalId === f.externalId)?.id ?? null,
    }))
  }

  /** Discovery is slow (it opens Business Suite / Studio): its answer is reused for a few minutes. */
  private discovered = new Map<string, { at: number; found: DiscoveredAccount[] }>()
  private async discover(sessionDir: string, driver: Driver, fresh = false) {
    const hit = this.discovered.get(sessionDir)
    if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.found
    const found = await this.operate(sessionDir, 'discover', (run) => driver.discover(run), { driver })
    this.discovered.set(sessionDir, { at: Date.now(), found })
    return found
  }

  /**
   * Everything the account's sign-in can reach (Meta: each Page the login manages and its Instagram), so more
   * can be connected without signing in again.
   */
  async available(id: string, fresh = false): Promise<Connectable[]> {
    const r = await this.row(id)
    const found = await this.discoverFor(r, fresh)
    await this.refreshKnown(found, r.sessionDir)
    return this.connectables(found, await this.rows())
  }

  /** Brings the names, pictures and ids of accounts already connected through this sign-in up to date. */
  private async refreshKnown(found: DiscoveredAccount[], sessionDir: string) {
    const login = found.find((f) => f.login)?.login ?? null
    for (const r of await this.rows()) {
      if (r.sessionDir !== sessionDir) continue
      const f = found.find((x) => x.platform === r.platform && x.externalId === r.externalId)
      if (!f) continue
      const name = f.name.slice(0, 200)
      const handle = f.handle.slice(0, 200)
      const same =
        r.name === name &&
        r.handle === handle &&
        r.profileUrl === f.profileUrl &&
        sameJson(r.platformIds, f.platformIds) &&
        sameJson(r.capabilities, f.capabilities) &&
        (!login || sameJson(r.signIn, login))
      if (same && (r.avatarVersion || !f.avatarUrl)) continue
      await this.patch(r.id, {
        name,
        handle,
        profileUrl: f.profileUrl,
        avatarUrl: f.avatarUrl,
        platformIds: f.platformIds,
        capabilities: f.capabilities,
        ...(login ? { signIn: login } : {}),
      })
      await this.saveAvatar(r.id, sessionDir, f.avatarUrl).catch(() => {})
      this.announce(r.id, r.state)
    }
    await this.mergeDuplicates()
  }

  /**
   * The same account reached through two connectors becomes one: the platform's own connector leads and the
   * other is merged into it (merge.ts). Runs after every sign-in and refresh, and when the server starts.
   */
  async mergeDuplicates() {
    const rows = await this.rows()
    for (const [id, into] of planMerges(rows)) {
      await this.patch(id, { mergedInto: into })
      const r = rows.find((x) => x.id === id)!
      this.ctx.log.info(
        { id, driver: r.driver, into },
        into ? 'account merged into its main connector' : 'account unmerged',
      )
      this.announce(id, r.state)
      if (into) this.announce(into, rows.find((x) => x.id === into)?.state ?? 'connected')
    }
  }

  /**
   * What each account can do, as its connector does it now: saved by the last check, so a new version's connectors
   * apply at once rather than at the next health check. Makes no request to the platforms.
   */
  async refreshCapabilities() {
    for (const r of await this.rows()) {
      let caps: Capabilities
      try {
        caps = this.driverOf(r).capabilities(r.platform as Platform, this.asDriverAccount(r))
      } catch {
        continue
      }
      if (sameJson(caps, r.capabilities)) continue
      await this.patch(r.id, { capabilities: caps })
      this.announce(r.id, r.state)
    }
  }

  /** An account and the rows merged into it, the main one first. */
  private async group(id: string): Promise<AccountRow[]> {
    const all = await this.rows()
    const r = all.find((x) => x.id === id)
    if (!r) throw notFound('Account not found')
    return [r, ...all.filter((x) => x.mergedInto === r.id)]
  }

  /** Connects more of what the account's sign-in reaches (`keys` from `available`). */
  async connectAvailable(id: string, keys: string[], actor: Actor): Promise<Account[]> {
    const r = await this.row(id)
    const chosen = (await this.discoverFor(r, false)).filter((f) =>
      keys.includes(accountKey(f.platform, f.externalId)),
    )
    if (!chosen.length) throw badRequest('None of these accounts is reachable with this sign-in any more')
    return this.saveDiscovered(chosen, this.driverOf(r), r.sessionDir, actorUserId(actor), null)
  }

  private async discoverFor(r: AccountRow, fresh: boolean) {
    try {
      return await this.discover(r.sessionDir, this.driverOf(r), fresh)
    } catch (err) {
      if (err instanceof NeedsLogin) {
        await this.setState(r, 'needs_login', err.message || 'Signed out on the platform')
        throw new HttpError(
          'conflict',
          `${platformName(r.platform as Platform)} needs you to sign in again (Settings → Connected accounts)`,
        )
      }
      throw err
    }
  }

  /** Creates or refreshes the accounts found behind a profile. */
  private async saveDiscovered(
    found: DiscoveredAccount[],
    driver: Driver,
    sessionDir: string,
    userId: string | null,
    expected: string | null,
  ): Promise<Account[]> {
    const out: Account[] = []
    const before = await this.rows()
    const login = found.find((f) => f.login)?.login ?? null
    for (const f of found) {
      const existing = before.find((r) => r.platform === f.platform && r.externalId === f.externalId)
      const off = existing?.state === 'disabled'
      const values = {
        platform: f.platform,
        driver: driver.id,
        externalId: f.externalId,
        name: f.name.slice(0, 200),
        handle: f.handle.slice(0, 200),
        avatarUrl: f.avatarUrl,
        profileUrl: f.profileUrl,
        state: off ? ('disabled' as const) : ('connected' as const),
        stateMessage: null,
        capabilities: f.capabilities,
        platformIds: f.platformIds,
        sessionDir,
        ...(login ? { signIn: login } : {}),
        lastCheckedAt: new Date(),
      }
      let id: string
      if (existing) {
        await this.patch(existing.id, values)
        id = existing.id
        if (existing.sessionDir !== sessionDir && !(await this.referenced(existing.sessionDir)))
          await this.pool.destroy(existing.sessionDir).catch(() => {})
      } else {
        const [row] = await this.db
          .insert(connectorAccounts)
          .values({ ...values, createdBy: userId })
          .returning()
        id = row!.id
      }
      await this.saveAvatar(id, sessionDir, f.avatarUrl).catch((err) =>
        this.ctx.log.debug({ err }, 'avatar not saved'),
      )
      this.announce(id, off ? 'disabled' : 'connected')
      out.push(await this.account(id))
    }
    await this.mergeDuplicates()
    // Reconnecting an account but signing in as someone else leaves that account signed out.
    if (expected && !out.some((a) => a.id === expected)) {
      const r = await this.row(expected).catch(() => null)
      if (r)
        await this.setState(
          r,
          'needs_login',
          'You signed in with a different account. Reconnect with the right one.',
        )
    }
    return out
  }

  /** Keeps a small copy of the profile picture (platform picture links expire and refuse other sites). */
  private async saveAvatar(id: string, sessionDir: string, url: string | null) {
    if (!url) return
    const buf = sessionDir.startsWith('device-')
      ? await fetch(url, { signal: AbortSignal.timeout(20_000), referrerPolicy: 'no-referrer' }).then(
          async (r) => {
            if (!r.ok) throw new Error(`avatar ${r.status}`)
            return Buffer.from(new Uint8Array(await r.arrayBuffer()))
          },
        )
      : await this.pool.use(sessionDir, async (context) => {
          const res = await context.request.get(url, { timeout: 20_000, headers: { referer: '' } })
          if (!res.ok()) throw new Error(`avatar ${res.status()}`)
          return res.body()
        })
    const out = await sharp(buf).resize(256, 256, { fit: 'cover' }).webp({ quality: 86 }).toBuffer()
    await mkdir(this.avatarDir(), { recursive: true })
    await writeFile(join(this.avatarDir(), `${id}.webp`), out)
    await this.patch(id, { avatarVersion: createHash('sha1').update(out).digest('hex').slice(0, 10) })
  }

  avatarPath(id: string) {
    return join(this.avatarDir(), `${id}.webp`)
  }

  /** Signs in by pasting exported cookies (when the remote sign-in is refused). */
  async importCookies(
    input: { platform: Platform; driver?: string | null; accountId?: string | null; cookies: string },
    actor: Actor,
  ): Promise<Account[]> {
    const known = input.accountId ? await this.row(input.accountId) : null
    const driver = driverFor(input.platform, known?.driver ?? input.driver)
    if (!driver) throw badRequest(`No connector for ${input.platform}`)
    let cookies: ReturnType<typeof parseCookies>
    try {
      cookies = parseCookies(input.cookies, driver.signIn.cookieDomains)
    } catch (err) {
      throw badRequest((err as Error).message)
    }
    const sessionDir = input.accountId ? (await this.row(input.accountId)).sessionDir : randomUUID()
    try {
      await this.pool.use(sessionDir, (context) => context.addCookies(cookies))
      const signedIn = await this.pool.use(sessionDir, (context) => driver.looksSignedIn(context))
      if (signedIn) await this.pool.use(sessionDir, (context) => this.handOver(context, driver, sessionDir))
      if (!signedIn)
        throw badRequest(
          'Those cookies do not hold a signed-in session. Export them while signed in on the platform.',
        )
      const refused = `${platformName(input.platform)} did not accept these cookies as a signed-in session. Export them again from a browser where you are signed in.`
      const found = await this.discover(sessionDir, driver, true).catch((err) => {
        if (err instanceof NeedsLogin) throw badRequest(refused)
        throw err
      })
      if (!found.length)
        throw badRequest(input.platform === 'tiktok' ? refused : noAccountsMessage(input.platform))
      return await this.saveDiscovered(found, driver, sessionDir, actorUserId(actor), input.accountId ?? null)
    } catch (err) {
      if (!input.accountId && !(await this.referenced(sessionDir)))
        await this.pool.destroy(sessionDir).catch(() => {})
      throw err
    }
  }

  /**
   * Turns an account off — it stays connected, with its sign-in, but is left out of publishing, checks and the
   * sync — or back on (checked again at once). A later sign-in keeps it off.
   */
  async setEnabled(id: string, enabled: boolean): Promise<Account> {
    // Turning a merged account off or on turns all its connectors off or on.
    const [r, ...members] = await this.group(id)
    for (const m of members) await this.setOneEnabled(m.id, enabled).catch(() => {})
    return this.setOneEnabled(r!.id, enabled)
  }

  private async setOneEnabled(id: string, enabled: boolean): Promise<Account> {
    const r = await this.row(id)
    if (!enabled) {
      if (r.state !== 'disabled') {
        await this.patch(id, { state: 'disabled', stateMessage: null })
        this.announce(id, 'disabled')
      }
      return this.account(id)
    }
    if (r.state === 'disabled') {
      await this.patch(id, { state: 'connected', stateMessage: null })
      this.announce(id, 'connected')
    }
    return this.check(id)
  }

  /** Forgets an account. Its browser profile (cookies) is deleted when no other account uses it. */
  /** Disconnects the account, and the connectors merged into it (it is one account to the owner). */
  async disconnect(id: string) {
    const [, ...members] = await this.group(id)
    for (const m of members) await this.disconnectOne(m.id)
    await this.disconnectOne(id)
  }

  private async disconnectOne(id: string) {
    const r = await this.row(id)
    await this.db.delete(connectorAccounts).where(eq(connectorAccounts.id, id))
    for (const s of this.streams.all())
      if (s.accountId === id) await this.closeSession(s.id, 'Account disconnected')
    if (!(await this.referenced(r.sessionDir))) {
      await this.pool.destroy(r.sessionDir).catch(() => {})
      await this.engine.dropAll(this.baseSite(r.sessionDir)).catch(() => {})
    }
    await rm(this.avatarPath(id), { force: true }).catch(() => {})
    this.announce(id, 'removed')
  }

  /** Old run reports (screenshots of dry runs and failures) are kept for a week; staged uploads an hour. */
  async pruneRuns(stagedMaxAgeMs = 60 * 60_000) {
    const dir = this.runsDir()
    if (!existsSync(dir)) return
    const staged = join(dir, 'staged')
    if (existsSync(staged))
      for (const name of await readdir(staged)) {
        const s = await stat(join(staged, name)).catch(() => null)
        if (s && Date.now() - s.mtimeMs >= stagedMaxAgeMs)
          await rm(join(staged, name), { recursive: true, force: true })
      }
    for (const name of await readdir(dir)) {
      if (name === 'staged') continue
      const s = await stat(join(dir, name)).catch(() => null)
      if (s && Date.now() - s.mtimeMs > 7 * 86_400_000)
        await rm(join(dir, name), { recursive: true, force: true })
    }
  }

  async shutdown() {
    for (const s of this.streams.all()) await this.closeSession(s.id, 'Greenlit is restarting')
    await this.pool.closeAll()
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
}

/** The extension a file's first bytes say it has (JPEG, PNG, WebP, MP4/MOV). */
async function sniffExt(path: string): Promise<string | null> {
  const fh = await open(path, 'r').catch(() => null)
  if (!fh) return null
  try {
    const { buffer } = await fh.read(Buffer.alloc(16), 0, 16, 0)
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
    if (buffer.subarray(0, 4).toString('hex') === '89504e47') return '.png'
    if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
      return '.webp'
    if (buffer.subarray(4, 8).toString() === 'ftyp')
      return buffer.subarray(8, 10).toString() === 'qt' ? '.mov' : '.mp4'
    return null
  } finally {
    await fh.close()
  }
}

const clampInt = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, v)))

export function platformName(p: Platform) {
  return { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' }[p]
}

function noAccountsMessage(p: Platform) {
  if (p === 'facebook' || p === 'instagram')
    return 'Signed in, but this login manages no Facebook Page in Meta Business Suite — neither its own nor through a business portfolio. Sign in with a login that manages the Page (Instagram comes through the Page it is linked to).'
  if (p === 'youtube') return 'Signed in, but this Google account has no YouTube channel yet.'
  return 'TikTok has not confirmed the sign-in yet. Finish it in the TikTok app; Greenlit keeps checking.'
}
