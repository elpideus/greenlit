import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import type { MusicTrack } from '@greenlit/shared/areas/connectors'
import type { AudioMix, MusicChoice, Placement } from '@greenlit/shared/areas/posts'
import { probe } from '../../../lib/ffmpeg.ts'
import { mixSound } from './sound-mix.ts'
import {
  ConnectorUnsupported,
  type DiscoveredAccount,
  type Driver,
  type DriverAccount,
  type DriverRun,
  NeedsLogin,
  noCapabilities,
  type PublishOutcome,
  type PublishRequest,
  type RemotePost,
} from './types.ts'
import { cookie } from './util.ts'
import { youtube as studio } from './youtube.ts'

/**
 * YouTube through API Anything (aa/sites/youtube.json): YouTube and Studio's own requests, sent over plain HTTP with
 * the cookies of one Google sign-in. That sign-in reaches every channel it manages (brand channels included);
 * each becomes an account, and a request acts as a channel by its pageId and channel id.
 *
 * Reading — channels, uploads, details, stats — is plain requests. Studio's writes (upload, details, delete) are
 * refused over plain HTTP until Google's BotGuard attestation has run in a real page ("verify it's you"), so they
 * happen in Studio itself, in the account's own signed-in browser profile: the active channel is switched to the
 * account's (by its pageId, as YouTube's account menu does), then Studio's own upload, details and delete steps run
 * (drivers/youtube.ts). Google's check runs in the page as it does for a person.
 *
 * A Short with a sound from YouTube's library is what only the YouTube app makes: those go through the app's own
 * requests (aa/sites/youtube-android.json) with the token the app holds on Greenlit's Android device
 * (`run.api.app`), see `shortWithSound`.
 */

const capabilities = {
  ...noCapabilities,
  placements: ['video', 'short'] as Placement[],
  nativeSchedule: true,
  editAfterPublish: true,
  delete: true,
  translations: true,
  thumbnail: true,
  sync: true,
  stats: true,
  // Shorts only: a sound from YouTube's library, through the YouTube app on Greenlit's Android device, at the
  // volumes chosen (mixed into the upload as the app does).
  music: true,
  audioMix: true,
}

/** The YouTube Android app, on Greenlit's device: its spec and the token its own requests carry. */
export const APP = {
  template: 'youtube-android',
  package: 'com.google.android.youtube',
  name: 'YouTube',
  scope:
    'oauth2:https://www.googleapis.com/auth/accounts.reauth https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/identity.lateimpersonation',
}

/** The longest Short YouTube takes. */
const SHORT_MAX_SECONDS = 180

interface Channel {
  name?: string
  handle?: string
  hasChannel?: boolean
  photo?: string
  pageId?: string
}

interface Video {
  videoId: string
  title?: string
  description?: string
  privacy?: string
  status?: string
  draft?: string
  contentType?: string
  published?: string
  watchUrl?: string
  thumbnail?: string
  scheduledAt?: string
  views?: string
  likes?: string
  comments?: string
}

interface Sound {
  trackId?: string
  title?: string
  artist?: string
  duration?: string
  cover?: string
  remixable?: boolean
  /** How many Shorts use it, as the picker shows it ("27K"). */
  usage?: string
}

/** "27K", "1.2M", "850" as a number. */
export const countOf = (text: string | undefined) => {
  const m = text?.trim().match(/^([\d.,]+)\s*([KMB])?$/i)
  if (!m) return null
  const n = Number(m[1]!.replace(/,/g, ''))
  const unit = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Number.isFinite(n) ? Math.round(n * unit) : null
}

/** "1:05" or "1:02:03" as seconds. */
export const clockSeconds = (text: string | undefined) => {
  if (!text || !/^\d+(:\d{1,2}){0,2}$/.test(text.trim())) return null
  return text
    .trim()
    .split(':')
    .reduce((t, p) => t * 60 + Number(p), 0)
}

export const soundToTrack = (s: Sound): MusicTrack | null =>
  s.trackId && /^[\w-]{11}$/.test(s.trackId)
    ? {
        trackId: s.trackId,
        title: s.title ?? '',
        artist: s.artist ?? '',
        coverUrl: s.cover ?? null,
        previewUrl: null,
        duration: clockSeconds(s.duration),
        usage: countOf(s.usage),
      }
    : null

const api = (run: DriverRun) => {
  if (!run.api) throw new Error('the YouTube connector runs through API Anything')
  return run.api
}

/** A bigger copy of a yt3.ggpht.com picture (the switcher sends 40 px ones). */
const bigger = (url: string | undefined) => (url ? url.replace(/=s\d+-/, '=s240-') : null)

const ids = (a: DriverAccount) => {
  const pageId = a.platformIds.pageId
  const channelId = a.platformIds.channelId || a.externalId
  if (!pageId)
    throw new NeedsLogin('Reconnect YouTube once: Greenlit now reads every channel of the sign-in.')
  return { pageId, channelId }
}

/** Makes the account's channel the active one in its browser profile, then runs a Studio step there. */
export async function inStudioAs<T>(
  run: DriverRun,
  account: DriverAccount,
  fn: (page: DriverRun) => Promise<T>,
) {
  const { pageId } = ids(account)
  return api(run).browser(async (page) => {
    const tab = await page.page()
    const next = encodeURIComponent('https://studio.youtube.com/')
    await tab.goto(
      `https://www.youtube.com/signin?action_handle_signin=true&authuser=0&pageid=${pageId}&next=${next}`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 },
    )
    if (/accounts\.google\.com/.test(tab.url()))
      throw new NeedsLogin('Google asks to sign in again. Reconnect YouTube.')
    page.step(`Acting as ${account.handle || account.name}`)
    return fn(page)
  })
}

export const youtubeApi: Driver = {
  id: 'youtube',
  kind: 'api',
  template: 'youtube',
  name: 'YouTube',
  platforms: ['youtube'],
  signIn: {
    url: `https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=${encodeURIComponent('https://www.youtube.com/')}`,
    method: 'password',
    cookieDomains: ['youtube.com', 'google.com'],
  },
  capabilities: () => capabilities,

  async looksSignedIn(context) {
    const sapisid =
      (await cookie(context, 'https://www.youtube.com', 'SAPISID')) ??
      (await cookie(context, 'https://www.youtube.com', '__Secure-3PAPISID'))
    const login =
      (await cookie(context, 'https://www.youtube.com', 'LOGIN_INFO')) ??
      (await cookie(context, 'https://www.youtube.com', 'SID'))
    return !!sapisid && !!login
  },

  /** Every channel the sign-in manages; the sign-in's own identity counts only when it has a channel. */
  async discover(run) {
    const channels = await api(run).call<Channel[]>('channels', {}, { maxTier: 1 })
    const out: DiscoveredAccount[] = []
    // The switcher lists the Google account itself first, then the channels it manages.
    const first = channels?.[0]
    const login = first?.name ? { name: first.name, avatarUrl: bigger(first.photo) } : null
    for (const c of channels ?? []) {
      if (!c.hasChannel || !c.pageId || !c.handle) continue
      const channelId = await api(run)
        .call<string>('resolveHandle', { handle: c.handle }, { maxTier: 1 })
        .catch(() => null)
      if (!channelId || !/^UC[\w-]{22}$/.test(channelId)) {
        run.warn(`The channel id of ${c.handle} could not be read; it was left out.`)
        continue
      }
      out.push({
        platform: 'youtube',
        externalId: channelId,
        name: c.name || c.handle,
        handle: c.handle,
        avatarUrl: bigger(c.photo),
        profileUrl: `https://www.youtube.com/${c.handle}`,
        platformIds: { channelId, pageId: c.pageId },
        capabilities,
        login,
      })
    }
    return out
  },

  async check(run, account) {
    try {
      const { pageId } = ids(account)
      const channels = await api(run).call<Channel[]>('channels', {}, { maxTier: 1 })
      if (!(channels ?? []).some((c) => c.pageId === pageId))
        return { ok: false, reason: 'This Google sign-in no longer manages this channel.' }
      return { ok: true }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  async list(run, account, opts) {
    const { pageId, channelId } = ids(account)
    const out: RemotePost[] = []
    const since = opts.since ? opts.since.getTime() / 1000 : 0
    const videos = await api(run).call<Video[]>('videos', { pageId, channelId }, { maxTier: 1 })
    for (const v of videos ?? []) {
      const published = Number(v.published ?? 0)
      const scheduled = Number(v.scheduledAt ?? 0)
      if (since && published && published < since && !scheduled) continue
      if (v.draft && v.draft !== 'DRAFT_STATUS_NONE') continue
      const short = v.contentType === 'CREATOR_CONTENT_TYPE_SHORTS'
      out.push({
        remoteId: v.videoId,
        url:
          v.watchUrl ??
          (short ? `https://www.youtube.com/shorts/${v.videoId}` : `https://youtu.be/${v.videoId}`),
        placement: short ? 'short' : 'video',
        title: v.title ?? '',
        caption: v.description ?? '',
        thumbnailUrl: v.thumbnail ?? null,
        mediaUrl: null,
        state: scheduled && scheduled * 1000 > Date.now() ? 'scheduled' : 'published',
        scheduledAt: scheduled ? new Date(scheduled * 1000).toISOString() : null,
        publishedAt: published ? new Date(published * 1000).toISOString() : null,
        stats: {
          ...(v.views ? { views: Number(v.views) } : {}),
          ...(v.likes ? { likes: Number(v.likes) } : {}),
          ...(v.comments ? { comments: Number(v.comments) } : {}),
        },
      })
    }
    return out
  },

  app: APP,

  async publish(run, account, req) {
    if (req.music && req.placement === 'short') return shortWithSound(run, account, req)
    const out = await inStudioAs(run, account, (page) => studio.publish(page, account, req))
    // A sound left on a post that became a video: YouTube takes sounds on Shorts only.
    if (!req.music) return out
    return {
      ...out,
      warnings: [...(out.warnings ?? []), 'YouTube adds sounds to Shorts only: the video went up without it'],
    }
  },
  async update(run, account, remoteId, patch) {
    await inStudioAs(run, account, (page) => studio.update(page, account, remoteId, patch))
  },
  async remove(run, account, remoteId) {
    await inStudioAs(run, account, (page) => studio.remove(page, account, remoteId))
  },
  /** Sounds for a Short, as the YouTube app's sound picker finds them. */
  async searchMusic(run, account, query, placement) {
    if (placement !== 'short' || !query.trim()) return []
    const { pageId } = ids(account)
    const sounds = await api(run).app<Sound[]>('soundSearch', {
      query: query.trim(),
      pageId,
      hl: run.locale.slice(0, 2).toLowerCase(),
    })
    return (sounds ?? []).flatMap((s) => soundToTrack(s) ?? [])
  },

  /** A sound is a YouTube video: its progressive stream (itag 18) carries the audio the preview is cut from. */
  async soundAudio(run, account, trackId) {
    const { pageId } = ids(account)
    const p = await api(run).app<{ status?: string; url?: string; lengthMs?: string }>('soundPlayer', {
      videoId: trackId,
      pageId,
    })
    if (p?.status !== 'OK' || !p.url) return null
    return { url: p.url, offset: 0, length: p.lengthMs ? Number(p.lengthMs) / 1000 : null }
  },
}

/**
 * A Short with a sound from YouTube's library, made as the YouTube app makes it. The app mixes the sound into the
 * video on the phone (its start, both volumes) and uploads that; YouTube's servers mix nothing (measured: a Short
 * made with only the edit kept its own audio). So Greenlit mixes the sound in first (`withSound`, the video stream
 * copied as it is), the file goes to YouTube's upload server, `createVideo` makes the Short and links the sound
 * ("Use this sound"), `metadataUpdate` gives it its title and description; it is private until then. A visibility
 * other than private, a schedule and the rest of the details (tags, thumbnail, translations) are then set in YouTube
 * Studio, as for any other video. Once the Short exists, a failure is never retried: a retry would make a second one.
 */
export async function shortWithSound(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  const music = req.music!
  const { pageId } = ids(account)
  const video = req.files.find((f) => f.kind === 'video')
  if (!video) throw new ConnectorUnsupported('placement', 'A Short is a video')
  const length = (await probe(video.path)).durationSec
  if (!length) throw new Error('The video has no length Greenlit could read')
  if (length > SHORT_MAX_SECONDS)
    throw new ConnectorUnsupported('placement', `A Short is at most ${SHORT_MAX_SECONDS / 60} minutes long`)
  const a = api(run)
  const dry = a.dryRun
  // One id per publish attempt: it keys each write (a retry inside the attempt is the same write) and is the
  // upload's own id, as the app makes them.
  const attempt = randomUUID()
  const frontendUploadId = `innertube_android:${attempt}:0:v=3,api=1,cf=3`
  const file = dry ? video.path : await withSound(run, account, video.path, music, req.audio, length, attempt)
  if (dry) run.step(`Would mix ${music.title} into the video from ${music.startAt ?? 0} s`)
  try {
    return await sendShort(run, account, req, { file, length, attempt, frontendUploadId, pageId })
  } finally {
    if (file !== video.path) await rm(file, { force: true })
  }
}

/** The video with the sound mixed in, as the YouTube app makes it (sound-mix.ts). */
export async function withSound(
  run: DriverRun,
  account: DriverAccount,
  video: string,
  music: MusicChoice,
  audio: AudioMix,
  length: number,
  name: string,
) {
  const src = await youtubeApi.soundAudio!(run, account, music.trackId)
  if (!src) throw new Error('YouTube gives no audio for this sound')
  return mixSound(run, {
    video,
    src,
    music,
    audio,
    length,
    name,
    folder: 'youtube-sounds',
    app: 'the YouTube app',
  })
}

async function sendShort(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
  o: { file: string; length: number; attempt: string; frontendUploadId: string; pageId: string },
): Promise<PublishOutcome> {
  const music = req.music!
  const { file, length, attempt, frontendUploadId, pageId } = o
  const a = api(run)
  const dry = a.dryRun
  const { size } = await stat(file)

  const started = await a.app<Record<string, string>>(
    'uploadStart',
    { size, frontendUploadId },
    { write: true, key: `${attempt}:start` },
  )
  const address = started?.['x-goog-upload-url']
  const resourceId = started?.['x-goog-upload-header-scotty-resource-id']
  if (!dry && (!address || !resourceId)) throw new Error('YouTube did not start the upload')
  const upload = address ? new URL(address) : null
  if (upload && (upload.hostname !== 'upload.youtube.com' || upload.pathname !== '/'))
    throw new Error(`YouTube's upload address changed (${upload.hostname}${upload.pathname})`)
  const uploadId = upload?.searchParams.get('upload_id') ?? 'dryRunUpload000000000000'
  const origin = upload?.searchParams.get('origin') ?? 'dryRunOrigin00'
  await a.app(
    'uploadBytes',
    { uploadId, origin, path: file },
    { write: true, key: `${attempt}:bytes`, timeoutMs: 30 * 60_000 },
  )
  if (!dry) run.step('Video sent to YouTube')

  const seconds = Math.floor(length)
  const videoId = await a.app<string>(
    'createVideo',
    {
      resourceId: resourceId ?? 'dryRunResource0000000000',
      frontendUploadId,
      pageId,
      soundId: music.trackId,
      soundStartMs: Math.round((music.startAt ?? 0) * 1000),
      seconds: Math.max(1, seconds),
      nanos: seconds < 1 ? 0 : Math.round((length - seconds) * 1e9),
      soundVolume: req.audio.music,
      originalVolume: req.audio.original,
    },
    { write: true, key: `${attempt}:create` },
  )
  if (!dry && (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId)))
    throw new Error('YouTube did not make the Short')
  const id = dry ? 'dry-run-000' : videoId
  run.step(`YouTube video id ${id}, with the sound ${music.title}`)
  const unfinished = (err: unknown) =>
    Object.assign(
      new Error(
        `The Short ${videoId} was made with its sound but is still private: ${(err as Error).message}. Finish it in YouTube Studio.`,
      ),
      { retriable: false },
    )
  await a
    .app(
      'metadataUpdate',
      { videoId: id, pageId, title: req.title.slice(0, 100), description: req.caption.slice(0, 5000) },
      { write: true, key: `${attempt}:details` },
    )
    .catch((err) => {
      throw unfinished(err)
    })
  if (dry) return { remoteId: 'dry-run', url: null, state: req.scheduleAt ? 'scheduled' : 'published' }

  // What the app's requests leave as they are: set in Studio, as for any other video.
  const privacy = String(req.options.privacy ?? 'public').toLowerCase()
  const rest: Partial<PublishRequest> = {
    ...(privacy !== 'private' || req.scheduleAt
      ? { options: req.options, scheduleAt: req.scheduleAt, timeZone: req.timeZone }
      : {}),
    ...(req.tags.length ? { tags: req.tags } : {}),
    ...(req.thumbnailPath ? { thumbnailPath: req.thumbnailPath } : {}),
    ...(Object.keys(req.translations).length ? { translations: req.translations } : {}),
  }
  const warnings: string[] = []
  if (req.options.madeForKids === true)
    warnings.push('The Short could not be marked as made for kids: set its audience in YouTube Studio')
  if (Object.keys(rest).length)
    await inStudioAs(run, account, (page) => studio.update(page, account, videoId, rest)).catch((err) => {
      throw unfinished(err)
    })
  return {
    remoteId: videoId,
    url: `https://www.youtube.com/shorts/${videoId}`,
    state: req.scheduleAt ? 'scheduled' : 'published',
    ...(warnings.length ? { warnings } : {}),
  }
}
