import type { Capabilities } from '@greenlit/shared/areas/connectors'
import type { AccountRow } from './schema.ts'

/**
 * One account reached through two connectors (the GEM Page through facebook.com and through Meta Business Suite;
 * an Instagram account through instagram.com and Business Suite) is one account in Greenlit: the platform's own
 * connector is the main one, the other is merged into it and fills in what the main one cannot do (Business Suite
 * posts reels, stories and music to a Page that facebook.com cannot yet).
 */

type Row = Pick<
  AccountRow,
  | 'id'
  | 'platform'
  | 'driver'
  | 'externalId'
  | 'handle'
  | 'platformIds'
  | 'state'
  | 'capabilities'
  | 'createdAt'
>

/** Which connector leads, best first: the platform's own (API Anything) connectors, then the page-driving ones. */
const LEAD_ORDER = [
  'youtube',
  'facebook',
  'instagram',
  'tiktok',
  'meta-business-suite',
  'tiktok-studio',
  'youtube-studio',
  // the apps on Greenlit's Android device help the account; they never lead it
  'youtube-app',
  'instagram-app',
  'facebook-app',
]
const rank = (driver: string) => {
  const i = LEAD_ORDER.indexOf(driver)
  return i === -1 ? LEAD_ORDER.length : i
}

const norm = (s: string | undefined) => (s ?? '').replace(/^@/, '').trim().toLowerCase()

/** Ids an account is known by across connectors (`<kind>:<id>`), from what each connector reads. */
export function identities(r: Pick<Row, 'platform' | 'externalId' | 'handle' | 'platformIds'>): string[] {
  const ids = new Set<string>([`external:${r.externalId}`])
  const p = r.platformIds ?? {}
  if (r.platform === 'facebook') {
    // facebook.com keeps a Page's classic id as pageId (its delegate_page_id); Business Suite reads that id.
    if (p.pageId) ids.add(`page:${p.pageId}`)
    // the profile id a Page (or a person) acts with: facebook.com's actorId, what the Facebook app is signed in as
    if (p.actorId) ids.add(`actor:${p.actorId}`)
  }
  if (r.platform === 'instagram') {
    // instagram.com's fbid_v2 is the id Business Suite knows the account by; the username is the same on both.
    if (p.igUserId) ids.add(`ig:${p.igUserId}`)
    if (p.username || r.handle) ids.add(`username:${norm(p.username || r.handle)}`)
  }
  if (r.platform === 'youtube' && p.channelId) ids.add(`channel:${p.channelId}`)
  if (r.platform === 'tiktok' && (p.username || r.handle)) ids.add(`username:${norm(p.username || r.handle)}`)
  return [...ids]
}

export const sameAccount = (a: Row, b: Row) =>
  a.id !== b.id &&
  a.platform === b.platform &&
  a.driver !== b.driver &&
  identities(a).some((x) => identities(b).includes(x))

/** Which row leads a set of rows that are one account: the platform's own connector, then the oldest. */
export function lead<T extends Pick<Row, 'driver' | 'createdAt'>>(rows: T[]): T {
  return [...rows].sort((a, b) => rank(a.driver) - rank(b.driver) || +a.createdAt - +b.createdAt)[0]!
}

/** For every row that is another row's account: the row it merges into (rows already right are left out). */
export function planMerges(rows: (Row & { mergedInto: string | null })[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.id)) continue
    // Everything that is this account, transitively (a third connector matching either of two).
    const group = [r]
    for (let i = 0; i < group.length; i++)
      for (const x of rows) if (!group.includes(x) && sameAccount(group[i]!, x)) group.push(x)
    for (const g of group) seen.add(g.id)
    const main = lead(group)
    for (const g of group) {
      const want = g.id === main.id ? null : main.id
      if (g.mergedInto !== want) out.set(g.id, want)
    }
  }
  return out
}

/** An account a connector can use now (a turned-off one is left out; one that needs a sign-in still counts). */
export const usable = (r: Pick<Row, 'state'>) => r.state !== 'disabled'

/** Whether two JSON values are the same whatever their keys' order (Postgres jsonb keeps its own). */
export function sameJson(a: unknown, b: unknown): boolean {
  const sorted = (_k: string, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted)
}

/** What any of the connectors of one account can do. */
export function mergeCapabilities(rows: Pick<Row, 'capabilities'>[]): Capabilities | null {
  if (!rows.length) return null
  const caps = rows.map((r) => r.capabilities)
  const writable = caps.filter((c) => c.publish !== false)
  const any = (k: keyof Capabilities) => caps.some((c) => c[k] === true)
  const anyWritable = (k: keyof Capabilities) => writable.some((c) => c[k] === true)
  const placements = [...new Set((writable.length ? writable : caps).flatMap((c) => c.placements))]
  // A schedule is kept by the connector that publishes the post: for a plain post of each placement, the first
  // connector (main first) that publishes it, as pickConnector chooses.
  const publisherOf = (p: Capabilities['placements'][number]) =>
    writable.find((c) => c.placements.includes(p))
  const kept = placements.filter((p) => {
    const c = publisherOf(p)
    return !!c?.nativeSchedule && (!c.scheduleOn || c.scheduleOn.includes(p))
  })
  const window = kept.length ? publisherOf(kept[0]!)?.scheduleWindow : undefined
  return {
    // Placements and publishing features count only from connectors that publish.
    publish: writable.length > 0,
    placements,
    nativeSchedule: kept.length > 0,
    ...(kept.length && kept.length < placements.length ? { scheduleOn: kept } : {}),
    ...(window ? { scheduleWindow: window } : {}),
    editAfterPublish: anyWritable('editAfterPublish'),
    delete: anyWritable('delete'),
    music: anyWritable('music'),
    audioMix: anyWritable('audioMix'),
    translations: anyWritable('translations'),
    thumbnail: anyWritable('thumbnail'),
    location: anyWritable('location'),
    firstComment: anyWritable('firstComment'),
    sync: any('sync'),
    stats: any('stats'),
  }
}

/** What a post asks of a connector beyond its placement. */
export interface Needs {
  placement: string
  music: boolean
  location: boolean
  firstComment: boolean
  thumbnail: boolean
  translations: boolean
}

const missing = (c: Capabilities, n: Needs) =>
  [
    n.music && !c.music && 'music',
    n.location && !c.location && 'location',
    n.firstComment && !c.firstComment && 'firstComment',
    n.thumbnail && !c.thumbnail && 'thumbnail',
    n.translations && !c.translations && 'translations',
  ].filter(Boolean).length

/**
 * The connector a post goes through: the main one when it can publish the placement with everything asked, else
 * the first other one that can, else whichever can publish the placement with the fewest things left out.
 * `rows` are the main row first, then the ones merged into it.
 */
export function pickConnector<T extends Pick<Row, 'state' | 'capabilities'>>(rows: T[], n: Needs): T | null {
  const able = rows.filter(
    (r) =>
      usable(r) &&
      r.state !== 'needs_login' &&
      r.capabilities.publish !== false &&
      r.capabilities.placements.includes(n.placement as never),
  )
  if (!able.length) return null
  return (
    able.find((r) => missing(r.capabilities, n) === 0) ??
    [...able].sort((a, b) => missing(a.capabilities, n) - missing(b.capabilities, n))[0]!
  )
}
