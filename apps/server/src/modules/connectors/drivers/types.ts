import type { Account, Capabilities, MusicTrack } from '@greenlit/shared/areas/connectors'
import type { AudioMix, MusicChoice, Placement, Platform } from '@greenlit/shared/areas/posts'
import type { BrowserContext, Page } from 'playwright-core'
import type { Logger } from '../../../core/logger.ts'
import type { SoundPreview, SoundSource } from '../sounds.ts'

// ── what the posts module (and anything else) calls ──────────────────────

export interface PublishFile {
  /** Absolute path of a file Greenlit already prepared for this placement. */
  path: string
  mime: string
  kind: 'video' | 'image'
}

export interface PublishRequest {
  accountId: string
  placement: Placement
  files: PublishFile[]
  thumbnailPath: string | null
  /** The cover's frame when the cover is a frame of the video (seconds), for a platform that takes a time. */
  thumbnailAt?: number | null
  /** Which of the files is the cover (zero-based), when the cover is one of the post's own pictures. */
  coverIndex?: number | null
  title: string
  caption: string
  /** YouTube tags (hashtags belong in the caption). */
  tags: string[]
  firstComment: string
  location: { name: string; platformId: string | null } | null
  /** language → title/caption (YouTube title & description translations). */
  translations: Record<string, { title: string; caption: string }>
  music: MusicChoice | null
  audio: AudioMix
  /** Platform switches: privacy, made for kids, category, allow comments/duet/stitch, AI label… */
  options: Record<string, unknown>
  /** null = publish now. */
  scheduleAt: Date | null
  /** Time zone the schedule is shown in on the platform (the platform settings' time zone). */
  timeZone: string
  /** Go through the composer and stop right before the final Publish / Schedule click. */
  dryRun?: boolean
}

export interface PublishResult {
  remoteId: string
  url: string | null
  state: 'scheduled' | 'published'
}

/**
 * A write an API connector would have sent in a dry run: built like the real one, with the sign-in's values
 * masked (`<name>`), never sent.
 */
export interface PlannedRequest {
  op: string
  method: string
  url: string
  headers: Record<string, string>
  /** A text body (cut to a few thousand characters), or the fields of a multipart one. */
  body: string | null
  /** Files the request would read from disk and send. */
  files: { path: string; bytes: number; filename: string | null }[]
}

/** What a dry run did, step by step, and a picture of the composer right before the final click. */
export interface DryRunReport {
  steps: string[]
  /** API connectors: the writes they would have sent, in order. */
  requests?: PlannedRequest[]
  /** Path of a screenshot under DATA_DIR/tmp/connectors (served by /api/connectors/runs/...). */
  screenshot: string | null
  /** The button the driver would have pressed. */
  wouldPress: string | null
  warnings: string[]
}

export type PublishOutcome = PublishResult & {
  /** The connector account that published it, when another one merged into the account asked for did. */
  viaAccountId?: string
  dryRun?: DryRunReport
  /** Things the platform did not take (a cover, a place, a switch it does not offer) — the post went out without them. */
  warnings?: string[]
}

export interface RemotePost {
  remoteId: string
  url: string | null
  placement: Placement
  title: string
  caption: string
  thumbnailUrl: string | null
  mediaUrl: string | null
  state: 'scheduled' | 'published' | 'removed'
  scheduledAt: string | null
  publishedAt: string | null
  stats: Record<string, number> | null
}

/** What choosing a post's connector looks at (`ConnectorsService.holdsSchedule`). */
export type ScheduleQuestion = Pick<
  PublishRequest,
  'accountId' | 'placement' | 'music' | 'location' | 'firstComment' | 'thumbnailPath' | 'translations'
>

export interface ConnectorsService {
  accounts(): Promise<Account[]>
  account(id: string): Promise<Account>
  publish(req: PublishRequest): Promise<PublishOutcome>
  /** Whether the platform keeps this post's schedule itself; else Greenlit holds the post until its time. */
  holdsSchedule(req: ScheduleQuestion, at: Date): Promise<boolean>
  /** Throws `ConnectorUnsupported` when the platform cannot change that field after publishing. */
  update(accountId: string, remoteId: string, patch: Partial<PublishRequest>): Promise<void>
  remove(accountId: string, remoteId: string): Promise<void>
  list(accountId: string, opts?: { since?: Date }): Promise<RemotePost[]>
  searchMusic(accountId: string, query: string, placement: Placement): Promise<MusicTrack[]>
  /** A sound's audio and waveform for listening in the composer (`previewUrl`: the track's own, when it has one). */
  soundPreview(accountId: string, trackId: string, previewUrl?: string | null): Promise<SoundPreview>
}

/** Raised when the platform's own web tools cannot do something (callers may fall back, e.g. remove + publish again). */
export class ConnectorUnsupported extends Error {
  readonly what: string
  /** Trying again will not help (job queues can skip their retries). */
  readonly retriable = false
  constructor(what: string, message?: string) {
    super(message ?? `${what} is not possible on this platform`)
    this.name = 'ConnectorUnsupported'
    this.what = what
  }
}

/** The account's session is gone: the owner has to sign in again. */
export class NeedsLogin extends Error {
  readonly retriable = false
  constructor(message?: string) {
    super(message)
    this.name = 'NeedsLogin'
  }
}

/**
 * Greenlit's Android device cannot do what was asked: there is none, or the platform's app is not signed in on it.
 * The account's own sign-in is fine (unlike NeedsLogin).
 */
export class DeviceUnavailable extends Error {
  readonly retriable = false
  constructor(message: string) {
    super(message)
    this.name = 'DeviceUnavailable'
  }
}

// ── what a driver implements ─────────────────────────────────────────────

/** The account as a driver sees it. */
export interface DriverAccount {
  id: string
  platform: Platform
  externalId: string
  name: string
  handle: string
  platformIds: Record<string, string>
}

/** An account found behind a signed-in profile. */
export interface DiscoveredAccount {
  platform: Platform
  externalId: string
  name: string
  handle: string
  avatarUrl: string | null
  profileUrl: string | null
  platformIds: Record<string, string>
  capabilities: Capabilities
  /** The business portfolio (or similar) it is reached through; omitted for the login's own accounts. */
  via?: string | null
  /** `accountKey()` of the account it belongs to (an Instagram account's Page). */
  linkedTo?: string | null
  /** Who signed in, when the driver can tell (the Google account, the Facebook login): the same on every account. */
  login?: SignInIdentity | null
}

/** The person (or account) a sign-in is, as the platform shows them. */
export interface SignInIdentity {
  name: string
  handle?: string
  avatarUrl?: string | null
}

export const accountKey = (platform: Platform, externalId: string) => `${platform}:${externalId}`

/** An API Anything driver's handle on the account's session (aa/engine.ts). */
export interface ApiRun {
  /** The API Anything site holding this sign-in's session. */
  site: string
  /** Calls one of the template's operations; throws EngineError (cls `auth` when the session is gone). */
  call<T = unknown>(
    op: string,
    args?: Record<string, unknown>,
    opts?: {
      write?: boolean
      key?: string
      timeoutMs?: number
      maxTier?: 1 | 2 | 3
      /** Act as the account (`Driver.actorSite`: a Facebook Page), not as the sign-in itself. */
      asActor?: boolean
    },
  ): Promise<T>
  /** The session's cookies (values some requests repeat in their body, e.g. a CSRF token). */
  cookies(): Promise<{ name: string; value: string; domain: string }[]>
  /**
   * The account's own signed-in browser profile, for the few steps that must happen in a real page (a platform
   * that checks the browser itself before a write, like YouTube Studio's BotGuard attestation).
   */
  browser<T>(fn: (run: DriverRun) => Promise<T>): Promise<T>
  /**
   * Calls an operation of the platform's Android app (`Driver.app`): its own requests, sent over plain HTTP with
   * the token the app holds on Greenlit's Android device. Throws NeedsLogin when there is no device or the app is
   * not signed in on it. Dry runs record writes as `call` does.
   */
  app<T = unknown>(
    op: string,
    args?: Record<string, unknown>,
    opts?: { write?: boolean; key?: string; timeoutMs?: number },
  ): Promise<T>
  /**
   * The app's own files on Greenlit's Android device (`Driver.app`'s package only): what it keeps about who is
   * signed in. Throws DeviceUnavailable when there is no device.
   */
  appFiles: {
    read(rel: string): Promise<Buffer | null>
    list(rel: string): Promise<string[]>
  }
  /**
   * A dry run: every `write` call is built and recorded (`planned`), not sent, and answers `{}` — a driver fills
   * in what a real answer would have given (an upload's id) so the next steps can be planned too.
   */
  dryRun: boolean
  planned: PlannedRequest[]
}

/** Everything a driver gets for one operation. */
export interface DriverRun {
  /** The account's browser profile. API Anything drivers have none: using it throws. */
  context: BrowserContext
  log: Logger
  timeZone: string
  /** BCP 47 locale of the browser (it-IT, en-US). */
  locale: string
  /** Greenlit's data folder (drivers keep small helper files under connectors/). */
  dataDir: string
  /** A fresh tab; closed automatically when the operation ends. */
  page: () => Promise<Page>
  /** Records a step (dry runs return them; failures log them). */
  step: (message: string) => void
  warn: (message: string) => void
  /** Saves a JPEG of the page for the run report; returns its path. */
  snapshot: (page: Page, name: string) => Promise<string | null>
  signal?: AbortSignal
  /** API Anything drivers only. */
  api?: ApiRun
}

export interface SignIn {
  /** Where the remote browser opens. */
  url: string
  /** How people normally sign in there. */
  method: 'password' | 'qr' | 'device'
  /** Domains whose cookies hold the session (for cookie import). */
  cookieDomains: string[]
}

export interface Driver {
  /** Stable id stored on the account. */
  id: string
  /**
   * `api`: every operation is a request API Anything sends with the account's session (run.api), learned from
   * the platform's own traffic; the browser is used only to sign in. `browser` (default): drives the web UI.
   */
  kind?: 'browser' | 'api'
  /** api drivers: the site spec template, ./aa/sites/<template>.json. */
  template?: string
  /**
   * api drivers: the session a call made `asActor` goes through — the sign-in's own plus cookies that make
   * requests act as the account (Facebook's i_user for a Page). Other calls go as the sign-in.
   */
  actorSite?(
    account: DriverAccount,
    base: string,
  ): { site: string; cookies?: { name: string; value: string }[] } | null
  /**
   * api drivers: what only the platform's Android app does (a Short with a sound), through Greenlit's Android
   * device: the app's spec (./aa/sites/<template>.json), its package, and the scope of the token it holds there
   * (`oauth2:<scopes>`), which the spec's `session:androidToken` carries.
   */
  app?: { template: string; package: string; name: string; scope?: string }
  /**
   * The sign-in is the platform's app on Greenlit's Android device (signed in there, not in a browser): its
   * accounts are found by scanning the device, join the accounts already connected that they are (merged into
   * them), and help them with what only the app does.
   */
  device?: boolean
  /** What people know it as (the tool Greenlit drives: Meta Business Suite, YouTube Studio…). */
  name: string
  /** Platforms this driver serves; one login may give several accounts (Meta: Page + Instagram). */
  platforms: Platform[]
  signIn: SignIn
  /** What accounts of this platform can do through this driver. */
  /** What the driver can do for the platform; `account` when it differs per account (a Facebook Page). */
  capabilities(platform: Platform, account?: DriverAccount): Capabilities
  /** Quick look at the cookies: does the profile look signed in? (polled while the remote sign-in is open) */
  looksSignedIn(context: BrowserContext): Promise<boolean>
  /** The accounts this profile can publish to (opens pages as needed). */
  discover(run: DriverRun): Promise<DiscoveredAccount[]>
  /** Is the session still good for this account? Returns a reason when not. */
  check(run: DriverRun, account: DriverAccount): Promise<{ ok: true } | { ok: false; reason: string }>
  publish(run: DriverRun, account: DriverAccount, req: PublishRequest): Promise<PublishOutcome>
  update(
    run: DriverRun,
    account: DriverAccount,
    remoteId: string,
    patch: Partial<PublishRequest>,
  ): Promise<void>
  remove(run: DriverRun, account: DriverAccount, remoteId: string): Promise<void>
  list(run: DriverRun, account: DriverAccount, opts: { since?: Date }): Promise<RemotePost[]>
  searchMusic(
    run: DriverRun,
    account: DriverAccount,
    query: string,
    placement: Placement,
  ): Promise<MusicTrack[]>
  /**
   * Where a sound's audio can be listened to (the composer's previews and waveforms). Without it the track's own
   * `previewUrl` is used.
   */
  soundAudio?(run: DriverRun, account: DriverAccount, trackId: string): Promise<SoundSource | null>
}

/** Capabilities with every switch off (drivers spread their own on top). */
export const noCapabilities: Capabilities = {
  placements: [],
  nativeSchedule: false,
  editAfterPublish: false,
  delete: false,
  music: false,
  audioMix: false,
  translations: false,
  thumbnail: false,
  location: false,
  firstComment: false,
  sync: false,
  stats: false,
}
