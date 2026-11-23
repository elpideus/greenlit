import type { Capabilities } from '@greenlit/shared/areas/connectors'
import {
  ConnectorUnsupported,
  DeviceUnavailable,
  type DiscoveredAccount,
  type Driver,
  type DriverRun,
  noCapabilities,
} from './types.ts'
import { APP as YOUTUBE_APP, youtubeApi } from './youtube-api.ts'

/**
 * The platforms' Android apps on Greenlit's own device, as sign-ins of their own: what is signed in there is listed
 * with the accounts (Settings → Connected accounts) and joins the accounts already connected that it is (merged
 * into them by their real ids), to help them with what only the app does. A device sign-in never connects an
 * account on its own: one you disconnected stays disconnected. Each can be switched off like any account.
 *
 * - YouTube app: its account switcher (accounts_list) names the Google account and every channel; the app's
 *   requests make Shorts with a sound (youtube-api.ts).
 * - Instagram and Facebook apps: who is signed in is read from the app's own files; their requests come next.
 */

const unsupported = (name: string) => () => {
  throw new ConnectorUnsupported(
    'publish',
    `The ${name} app helps the account it belongs to; it does not post itself`,
  )
}

const helper = (caps: Partial<Capabilities>): Capabilities => ({ ...noCapabilities, ...caps, publish: false })

const api = (run: DriverRun) => {
  if (!run.api) throw new Error('device apps run through API Anything')
  return run.api
}

const signInStub = { url: 'https://www.android.com/', method: 'device' as const, cookieDomains: [] }

// ── YouTube ───────────────────────────────────────────────────────────────

interface SwitcherItem {
  name?: string
  handle?: string
  hasChannel?: boolean
  pageId?: string
  ownerId?: string
  channel?: string
  photo?: string
}

const youtubeCaps = helper({ placements: ['short'], music: true, audioMix: true })

async function youtubeChannels(run: DriverRun) {
  const items = (await api(run).app<SwitcherItem[]>('accountsList', {})) ?? []
  const me = items.find((i) => !i.hasChannel) ?? items[0]
  const channels = items.filter((i) => i.hasChannel && i.handle && i.pageId && i.channel)
  return { me, channels }
}

export const youtubeApp: Driver = {
  id: 'youtube-app',
  kind: 'api',
  device: true,
  app: YOUTUBE_APP,
  name: 'YouTube app',
  platforms: ['youtube'],
  signIn: signInStub,
  capabilities: () => youtubeCaps,
  looksSignedIn: async () => false,
  async discover(run) {
    const { me, channels } = await youtubeChannels(run)
    const login = me?.name ? { name: me.name, avatarUrl: me.photo ?? null } : null
    return channels.map(
      (c): DiscoveredAccount => ({
        platform: 'youtube',
        externalId: `app:UC${c.channel}`,
        name: c.name || c.handle!,
        handle: c.handle!,
        avatarUrl: c.photo ?? null,
        profileUrl: `https://www.youtube.com/${c.handle}`,
        platformIds: { channelId: `UC${c.channel}`, pageId: c.pageId! },
        capabilities: youtubeCaps,
        login,
      }),
    )
  },
  async check(run, account) {
    try {
      const { channels } = await youtubeChannels(run)
      return channels.some((c) => c.pageId === account.platformIds.pageId)
        ? { ok: true }
        : { ok: false, reason: 'The YouTube app on the device is no longer signed in to this channel.' }
    } catch (err) {
      if (err instanceof DeviceUnavailable) return { ok: false, reason: err.message }
      throw err
    }
  },
  publish: unsupported('YouTube'),
  update: unsupported('YouTube'),
  remove: unsupported('YouTube'),
  list: async () => [],
  searchMusic: (run, account, query, placement) => youtubeApi.searchMusic(run, account, query, placement),
  soundAudio: (run, account, trackId) => youtubeApi.soundAudio!(run, account, trackId),
}

// ── Instagram ─────────────────────────────────────────────────────────────

const unescapeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** A `<string name="…">` of an Android preferences file. */
export function prefString(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<string name="${name.replace(/[^\w.-]/g, '')}">([\\s\\S]*?)</string>`))
  return m ? unescapeXml(m[1]!) : null
}

interface IgUser {
  id?: string
  username?: string
  full_name?: string
  fbid_v2?: string | number
  profile_pic_url?: string
}

/** The account the Instagram app is signed in as (its `current` user), or null. */
export function instagramUser(xml: string): IgUser | null {
  const raw = prefString(xml, 'current')
  if (!raw) return null
  try {
    const u = JSON.parse(raw) as IgUser
    return u.id && u.username ? u : null
  } catch {
    return null
  }
}

const instagramCaps = helper({ placements: ['reel', 'story', 'feed'] })
const INSTAGRAM_APP = { template: 'instagram-android', package: 'com.instagram.android', name: 'Instagram' }

async function readInstagram(run: DriverRun) {
  const xml = await api(run).appFiles.read('shared_prefs/com.instagram.android_preferences.xml')
  return xml ? instagramUser(xml.toString('utf8')) : null
}

export const instagramApp: Driver = {
  id: 'instagram-app',
  kind: 'api',
  device: true,
  app: INSTAGRAM_APP,
  name: 'Instagram app',
  platforms: ['instagram'],
  signIn: signInStub,
  capabilities: () => instagramCaps,
  looksSignedIn: async () => false,
  async discover(run) {
    const u = await readInstagram(run)
    if (!u) throw new DeviceUnavailable('The Instagram app on the device is not signed in.')
    return [
      {
        platform: 'instagram',
        externalId: `app:${u.id}`,
        name: u.full_name || u.username!,
        handle: u.username!,
        avatarUrl: u.profile_pic_url ?? null,
        profileUrl: `https://www.instagram.com/${u.username}/`,
        platformIds: {
          userId: u.id!,
          username: u.username!,
          ...(u.fbid_v2 ? { igUserId: String(u.fbid_v2) } : {}),
        },
        capabilities: instagramCaps,
        login: { name: `@${u.username}`, handle: u.username!, avatarUrl: u.profile_pic_url ?? null },
      },
    ]
  },
  async check(run, account) {
    const u = await readInstagram(run).catch(() => null)
    return u?.id === account.platformIds.userId
      ? { ok: true }
      : { ok: false, reason: 'The Instagram app on the device is signed in as someone else, or signed out.' }
  },
  publish: unsupported('Instagram'),
  update: unsupported('Instagram'),
  remove: unsupported('Instagram'),
  list: async () => [],
  searchMusic: async () => [],
}

// ── Facebook ──────────────────────────────────────────────────────────────

/**
 * A string of a Facebook "light preferences" file: entries are written as Java's DataOutputStream does, a key in
 * modified UTF-8 (two bytes of length, then the bytes) followed by its value, a string the same way.
 */
export function lightPrefString(buf: Buffer, key: string): string | null {
  const k = Buffer.from(key, 'utf8')
  const head = Buffer.alloc(2)
  head.writeUInt16BE(k.length)
  const needle = Buffer.concat([head, k])
  let at = buf.indexOf(needle)
  while (at >= 0) {
    const p = at + needle.length
    if (p + 2 <= buf.length) {
      const n = buf.readUInt16BE(p)
      if (n > 0 && p + 2 + n <= buf.length) {
        const v = buf.subarray(p + 2, p + 2 + n).toString('utf8')
        if (![...v].some((c) => c.charCodeAt(0) < 0x20)) return v
      }
    }
    at = buf.indexOf(needle, at + 1)
  }
  return null
}

const facebookCaps = helper({ placements: ['feed', 'reel', 'story'] })
const FACEBOOK_APP = { template: 'facebook-android', package: 'com.facebook.katana', name: 'Facebook' }

async function readFacebook(run: DriverRun) {
  const buf = await api(run).appFiles.read('app_light_prefs/com.facebook.katana/authentication')
  if (!buf) return null
  const uid = lightPrefString(buf, 'uid')
  // The app keeps the display name of who it acts as under "username".
  const name = lightPrefString(buf, 'username')
  return uid && /^\d{5,20}$/.test(uid) ? { uid, name: name ?? '' } : null
}

export const facebookApp: Driver = {
  id: 'facebook-app',
  kind: 'api',
  device: true,
  app: FACEBOOK_APP,
  name: 'Facebook app',
  platforms: ['facebook'],
  signIn: signInStub,
  capabilities: () => facebookCaps,
  looksSignedIn: async () => false,
  async discover(run) {
    const me = await readFacebook(run)
    if (!me) throw new DeviceUnavailable('The Facebook app on the device is not signed in.')
    return [
      {
        platform: 'facebook',
        externalId: `app:${me.uid}`,
        name: me.name || 'Facebook',
        handle: '',
        avatarUrl: null,
        profileUrl: `https://www.facebook.com/profile.php?id=${me.uid}`,
        platformIds: { actorId: me.uid },
        capabilities: facebookCaps,
        login: { name: me.name || 'Facebook', avatarUrl: null },
      },
    ]
  },
  async check(run, account) {
    const me = await readFacebook(run).catch(() => null)
    return me?.uid === account.platformIds.actorId
      ? { ok: true }
      : { ok: false, reason: 'The Facebook app on the device acts as someone else now, or is signed out.' }
  },
  publish: unsupported('Facebook'),
  update: unsupported('Facebook'),
  remove: unsupported('Facebook'),
  list: async () => [],
  searchMusic: async () => [],
}

export const deviceDrivers = [youtubeApp, instagramApp, facebookApp]
