import { z } from 'zod'
import { Id, IsoDate } from '../common.ts'
import { Placement, Platform } from './posts.ts'

export const AccountState = z.enum(['connecting', 'connected', 'needs_login', 'error', 'disabled'])
export type AccountState = z.infer<typeof AccountState>

/** What a connected account can do through Greenlit (depends on the driver and the account type). */
export const Capabilities = z.object({
  /** Greenlit can publish to the account (false while a connector only reads); missing means yes. */
  publish: z.boolean().optional(),
  placements: z.array(Placement),
  /** The platform keeps the schedule itself (Greenlit downtime does not matter). */
  nativeSchedule: z.boolean(),
  /** The placements whose schedule the platform keeps (absent: every placement, when nativeSchedule is on). */
  scheduleOn: z.array(Placement).optional(),
  /**
   * How far ahead the platform takes a schedule (minutes at least, days at most). A post outside it, or on a
   * placement the platform does not schedule, waits in Greenlit and is published at its time.
   */
  scheduleWindow: z.object({ minMinutes: z.number().optional(), maxDays: z.number().optional() }).optional(),
  editAfterPublish: z.boolean(),
  delete: z.boolean(),
  music: z.boolean(),
  /** Can set the volume of the original sound vs the music (otherwise only mute/unmute). */
  audioMix: z.boolean(),
  translations: z.boolean(),
  thumbnail: z.boolean(),
  location: z.boolean(),
  firstComment: z.boolean(),
  /** Reads posts made directly on the platform back into Greenlit. */
  sync: z.boolean(),
  stats: z.boolean(),
})
export type Capabilities = z.infer<typeof Capabilities>

/** Whether the platform keeps a post's schedule itself (else Greenlit holds the post and publishes it at `at`). */
export function platformKeepsSchedule(
  c: Pick<Capabilities, 'nativeSchedule' | 'scheduleOn' | 'scheduleWindow'>,
  placement: string,
  at: Date,
  now = Date.now(),
): boolean {
  if (!c.nativeSchedule) return false
  if (c.scheduleOn && !c.scheduleOn.includes(placement as never)) return false
  const lead = at.getTime() - now
  const w = c.scheduleWindow
  if (w?.minMinutes !== undefined && lead < w.minMinutes * 60_000) return false
  if (w?.maxDays !== undefined && lead > w.maxDays * 86_400_000) return false
  return true
}

export const Account = z.object({
  id: Id,
  platform: Platform,
  /** Driver used (browser session, official API...). */
  driver: z.string(),
  name: z.string(),
  handle: z.string(),
  avatarUrl: z.string().nullable(),
  profileUrl: z.string().nullable(),
  state: AccountState,
  stateMessage: z.string().nullable(),
  /**
   * What Greenlit can do with the account. For an account other connectors reach too (`alsoThrough`), what
   * any of them can do: publishing picks the one that can.
   */
  capabilities: Capabilities,
  lastCheckedAt: IsoDate.nullable(),
  lastSyncedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  /** The sign-in the account was reached through (a Google account's channels, a Facebook login's Pages). */
  signIn: z.object({
    /** Same for every account of one sign-in. */
    id: z.string(),
    /** Who signed in ("Alex", "Acme Studio", "@acme_studio"); empty when the connector cannot tell. */
    name: z.string(),
    handle: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  /**
   * The same account reached through another connector, merged into that one (the platform's own): it is not
   * listed on its own, and fills in what the main connector cannot do.
   */
  mergedInto: Id.nullable(),
  /** The other connectors merged into this account. */
  alsoThrough: z.array(z.object({ id: Id, driver: z.string(), state: AccountState })),
})
export type Account = z.infer<typeof Account>

/**
 * An account a sign-in can reach, offered to choose from: with Meta Business Suite, every Facebook Page the login
 * manages (its own and those of its business portfolios) and the Instagram account linked to each.
 */
export const Connectable = z.object({
  /** `platform:externalId` */
  key: z.string(),
  platform: Platform,
  externalId: z.string(),
  name: z.string(),
  handle: z.string(),
  avatarUrl: z.string().nullable(),
  profileUrl: z.string().nullable(),
  /** The business portfolio it comes through; null for the login's own Pages. */
  via: z.string().nullable(),
  /** Key of the Page an Instagram account is linked to. */
  linkedTo: z.string().nullable(),
  /** Already connected in Greenlit as this account. */
  accountId: Id.nullable(),
})
export type Connectable = z.infer<typeof Connectable>

export const RemoteSession = z.object({
  id: z.string(),
  accountId: Id.nullable(),
  platform: Platform,
  width: z.number(),
  height: z.number(),
  url: z.string(),
  /** `choosing`: signed in, waiting for the owner to pick which of `choices` to connect. */
  state: z.enum(['starting', 'ready', 'signed_in', 'choosing', 'closed', 'failed']),
  message: z.string().nullable(),
  choices: z.array(Connectable).optional(),
})
export type RemoteSession = z.infer<typeof RemoteSession>

export const MusicTrack = z.object({
  trackId: z.string(),
  title: z.string(),
  artist: z.string(),
  coverUrl: z.string().nullable(),
  previewUrl: z.string().nullable(),
  duration: z.number().nullable(),
  usage: z.number().nullable(),
})
export type MusicTrack = z.infer<typeof MusicTrack>

/** A sound's preview as the composer draws it: the audio Greenlit holds (`/sounds/{trackId}/audio`) and its peaks. */
export const SoundWaveform = z.object({
  /** Seconds of audio in the preview. */
  duration: z.number(),
  /** Where in the track the preview starts, seconds. */
  offset: z.number(),
  /** The whole track's length when the platform says. */
  length: z.number().nullable(),
  /** 0..100, `peaksPerSecond` of them per second of the preview. */
  peaks: z.array(z.number()),
  peaksPerSecond: z.number(),
})
export type SoundWaveform = z.infer<typeof SoundWaveform>
