import type { MusicTrack } from '@greenlit/shared/areas/connectors'
import type { Placement } from '@greenlit/shared/areas/posts'
import { previewHostOk } from '../sounds.ts'
import { tiktok as studio, TIKTOK_SCHEDULE } from './tiktok.ts'
import {
  ConnectorUnsupported,
  type DiscoveredAccount,
  type Driver,
  type DriverRun,
  NeedsLogin,
  noCapabilities,
} from './types.ts'
import { cookie } from './util.ts'

/**
 * TikTok through API Anything (aa/sites/tiktok.json): tiktok.com's own requests with the cookies of the QR sign-in.
 * Reads are plain requests: the account, and TikTok Studio's sound search (`musicSearch`). Should the account read
 * fail at sign-in, the account still connects by the session's user cookie, so the session is kept.
 *
 * TikTok Studio's writes carry the page's own signatures (msToken, X-Bogus, X-Gnarly and tt-ticket-guard keys), which
 * only TikTok's page makes. So posts are made in TikTok Studio itself, in the account's own signed-in browser
 * profile, with the TikTok Studio steps (drivers/tiktok.ts): the upload, the details, the sound from TikTok's library
 * with both volumes in its video editor, then Post. The page signs its own requests, as it does for a person.
 */

const capabilities = {
  ...noCapabilities,
  // Tested for real (Nov 2026): an "Only you" video with a sound from the library, then deleted.
  publish: true,
  placements: ['video', 'photo'] as Placement[],
  // TikTok Studio books posts from 15 minutes up to 10 days ahead; later ones wait in Greenlit.
  nativeSchedule: true,
  scheduleWindow: { minMinutes: TIKTOK_SCHEDULE.minLeadMinutes, maxDays: TIKTOK_SCHEDULE.maxLeadDays },
  delete: true,
  thumbnail: true,
  location: true,
  // A sound from TikTok's library, added in TikTok Studio's video editor at both volumes; TikTok renders the edit.
  music: true,
  audioMix: true,
}

/** A sound as TikTok Studio's sound search answers (musicSearch). */
interface TtSound {
  trackId?: string
  title?: string
  author?: string
  cover?: string
  preview?: string
  duration?: number | string
  usage?: number | string
}

export function ttSoundToTrack(s: TtSound | null | undefined): MusicTrack | null {
  if (!s?.trackId || !/^\d{5,30}$/.test(String(s.trackId))) return null
  const duration = Number(s.duration)
  const usage = Number(s.usage)
  return {
    trackId: String(s.trackId),
    title: s.title ?? '',
    artist: s.author ?? '',
    coverUrl: s.cover && previewHostOk(s.cover) ? s.cover : null,
    previewUrl: s.preview && previewHostOk(s.preview) ? s.preview : null,
    duration: duration > 0 ? duration : null,
    usage: Number.isFinite(usage) && usage >= 0 ? usage : null,
  }
}

interface Account {
  id?: string
  handle?: string
  name?: string
  picture?: string
  secUid?: string
}

const api = (run: DriverRun) => {
  if (!run.api) throw new Error('the TikTok connector runs through API Anything')
  return run.api
}

const notYet = (what: string) =>
  new ConnectorUnsupported(what, 'Posting through tiktok.com is not offered yet; it is tested with you first')

export const tiktokApi: Driver = {
  id: 'tiktok',
  kind: 'api',
  template: 'tiktok',
  name: 'TikTok',
  platforms: ['tiktok'],
  signIn: { url: 'https://www.tiktok.com/login/qrcode', method: 'qr', cookieDomains: ['tiktok.com'] },
  capabilities: () => capabilities,

  async looksSignedIn(context) {
    return !!(
      (await cookie(context, 'https://www.tiktok.com', 'sessionid')) ??
      (await cookie(context, 'https://www.tiktok.com', 'sid_tt'))
    )
  },

  async discover(run) {
    let a: Account | null = null
    try {
      a = await api(run).call<Account>('account', {}, { maxTier: 1 })
    } catch (err) {
      if (err instanceof NeedsLogin) throw err
      run.warn(`The TikTok account could not be read yet (${(err as Error).message.slice(0, 160)})`)
    }
    const fallback = (await api(run).cookies()).find((c) => c.name === 'uid_tt')?.value
    const id = a?.id || (fallback ? `uid:${fallback}` : null)
    if (!id) return []
    const account: DiscoveredAccount = {
      platform: 'tiktok',
      externalId: id,
      name: a?.name || a?.handle || 'TikTok account',
      handle: a?.handle ? `@${a.handle}` : '',
      avatarUrl: a?.picture ?? null,
      profileUrl: a?.handle ? `https://www.tiktok.com/@${a.handle}` : null,
      platformIds: { ...(a?.id ? { userId: a.id } : {}), ...(a?.secUid ? { secUid: a.secUid } : {}) },
      capabilities,
      login: a?.handle ? { name: `@${a.handle}`, avatarUrl: a.picture ?? null } : null,
    }
    return [account]
  },

  async check(run, account) {
    try {
      const a = await api(run).call<Account>('account', {}, { maxTier: 1 })
      if (!a?.id) return { ok: false, reason: 'TikTok signed Greenlit out. Reconnect to sign in again.' }
      return a.id === account.externalId || account.externalId.startsWith('uid:')
        ? { ok: true }
        : { ok: false, reason: 'This sign-in is now another TikTok account.' }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  async list() {
    return []
  },
  /** A video, posted in TikTok Studio itself (see above). Reachable for real once `publish` is switched on. */
  async publish(run, account, req) {
    if (req.placement !== 'video' && req.placement !== 'photo')
      throw new ConnectorUnsupported('placement', 'TikTok Studio on the web posts videos and photos')
    return api(run).browser((page) => studio.publish(page, account, req))
  },
  async update() {
    throw notYet('update')
  },
  /** Deletes a post in TikTok Studio's content list, as a person does. */
  async remove(run, account, remoteId) {
    await api(run).browser((page) => studio.remove(page, account, remoteId))
  },
  /** Sounds for a video or a photo post, as TikTok Studio's video editor and photo form find them. */
  async searchMusic(run, _account, query, placement) {
    if ((placement !== 'video' && placement !== 'photo') || !query.trim()) return []
    const sounds = await api(run).call<TtSound[]>('musicSearch', { query: query.trim() }, { maxTier: 1 })
    return (sounds ?? []).flatMap((s) => ttSoundToTrack(s) ?? [])
  },
}
