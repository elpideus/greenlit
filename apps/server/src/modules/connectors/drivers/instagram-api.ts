import { randomBytes, randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import type { MusicTrack } from '@greenlit/shared/areas/connectors'
import type { MusicChoice, Placement } from '@greenlit/shared/areas/posts'
import { probe } from '../../../lib/ffmpeg.ts'
import { previewHostOk, type SoundSource } from '../sounds.ts'
import { firstFrame, type StickerBox, stillVideo, withPlaceSticker } from './frames.ts'
import { mixSound, withOwnVolume } from './sound-mix.ts'
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
} from './types.ts'
import { cookie } from './util.ts'

/**
 * Instagram signed in directly on instagram.com, through API Anything (aa/sites/instagram.json). Reading is the
 * GraphQL queries instagram.com's own profile page sends (the account, its posts), over plain HTTP with the
 * login's cookies. Should the account read fail at sign-in, the account is still connected by its id, so the
 * session is kept.
 *
 * Sounds and reels are the Instagram Android app's own requests (recorded on Greenlit's device), sent with the same
 * session in the app's header form (`Bearer IGT:2`, API Anything's `gen: igt`): the app's sound search, its video
 * upload and its Share. As the app does, the sound is mixed into the video before it is uploaded (sound-mix.ts) and
 * Instagram links it to the reel (music_params). Feed posts (a picture or a carousel) and stories are the app's
 * own requests too, recorded with the publish held so nothing was posted. A carousel's Share and the Edit of a
 * published post are not sent: Instagram ends the session for them (APP_ONLY_WRITES).
 */

const capabilities = {
  ...noCapabilities,
  publish: true,
  // Reels tested for real with the owner (Nov 2026); feed posts and stories built the same way, from the app's
  // own requests recorded with nothing sent.
  placements: ['feed', 'reel', 'story'] as Placement[],
  delete: true,
  // A sound from Instagram's library, at the volumes chosen (mixed into the upload, as the app does).
  music: true,
  audioMix: true,
  // A place from Instagram's own search: in feed posts' and reels' Share, as a story's location sticker.
  location: true,
  firstComment: true,
  // Not sent: Instagram ends the sign-in's session for the app's Edit (APP_ONLY_WRITES).
  editAfterPublish: false,
  // A cover that is a frame of the video (reels); a picture of its own is not set.
  thumbnail: true,
  sync: true,
  stats: true,
}

/**
 * The app's requests Greenlit does not send, and why. Instagram holds these two to its own app: sent with the
 * `sec-fetch-*` headers Node's fetch adds, they are refused ("SecFetch Policy violation"); sent without them, as the
 * app sends them, they now end the instagram.com sign-in's session (403 login_required, logout_reason 3, then every
 * request logged out). They worked that way until 22 Nov 2026; every one sent since has ended the session: the 4
 * carousels of 25 Nov (without the session's cookies) and the caption edit of 26 Nov (with them), so the cookies are
 * not what decides it. The app's requests that carry the sec-fetch headers (sound search, uploads) keep the session.
 * The requests are kept as learned (`editPost`, `publishCarousel`); the driver refuses before anything is sent.
 */
export const APP_ONLY_WRITES = {
  editMedia:
    'Instagram signs Greenlit out when it changes a caption with the app’s Edit, so Greenlit does not send it: change the caption in the Instagram app',
  configureSidecar:
    'Instagram signs Greenlit out when it shares a carousel with the app’s request, so Greenlit does not send it: share the carousel in the Instagram app',
} as const

/** The longest reel the app makes. */
const REEL_MAX_SECONDS = 180
/** How long a picture with a sound lasts as a reel (the post's `stillSeconds` option sets another). */
const STILL_SECONDS = 10
/** How long a sound plays on a picture story, as the app sets it. */
const STORY_SOUND_MS = 20_000

/** How long to wait before sending Share again while Instagram processes the upload (tests shorten it). */
export const SHARE_RETRY = { waitMs: 5000 }

interface User {
  id?: string | number
  username?: string
  name?: string
  picture?: string
  /** The account's id in Meta's other tools (Business Suite's igUserId). */
  fbId?: string
}

interface GridPost {
  id?: string
  code?: string
  created?: number
  text?: string | null
  kind?: string
  mediaType?: number
  image?: string
  likes?: number
  comments?: number
}

/** A sound as the app's sound search answers (musicSearch). */
interface IgSound {
  assetId?: string | number
  clusterId?: string | number
  title?: string
  artist?: string
  cover?: string
  preview?: string
  durationMs?: number | string
  highlights?: number[]
  dashManifest?: string
  monetization?: string
}

/** A place from the app's location search. */
interface IgPlace {
  placeId?: string | number
  name?: string
  subtitle?: string
  lat?: number
  lng?: number
}

/** Configure's answer: the reel, or why not. */
interface Configured {
  status?: string
  pk?: string | number
  code?: string
  id?: string
  message?: string
}

const api = (run: DriverRun) => {
  if (!run.api) throw new Error('the Instagram connector runs through API Anything')
  return run.api
}

const notYet = (what: string) =>
  new ConnectorUnsupported(what, 'Greenlit publishes reels to Instagram; this comes next')

/** A post's id as the app names it: its pk, an underscore, the account's id. */
const MEDIA_ID = /^\d{5,25}_\d{3,25}$/

/** A sound's id in Greenlit: both of Instagram's ids (a reel's music_params names the two). */
export const igTrackId = (assetId: string, clusterId: string) => `${assetId}-${clusterId}`

export function parseIgTrackId(trackId: string) {
  const m = trackId.match(/^(\d{5,25})-(\d{5,25})$/)
  return m ? { assetId: m[1]!, clusterId: m[2]! } : null
}

export function igSoundToTrack(s: IgSound | null | undefined): MusicTrack | null {
  // The search's items are sounds and other things (an item without a track is read as null).
  if (!s || typeof s !== 'object') return null
  const assetId = s.assetId === undefined ? '' : String(s.assetId)
  const clusterId = s.clusterId === undefined ? '' : String(s.clusterId)
  if (!parseIgTrackId(igTrackId(assetId, clusterId))) return null
  const ms = Number(s.durationMs)
  return {
    trackId: igTrackId(assetId, clusterId),
    title: s.title ?? '',
    artist: s.artist ?? '',
    coverUrl: s.cover && previewHostOk(s.cover) ? s.cover : null,
    previewUrl: s.preview && previewHostOk(s.preview) ? s.preview : null,
    duration: ms > 0 ? ms / 1000 : null,
    usage: null,
  }
}

/** Whether a signed fbcdn address still works for a while: its `oe` is when it expires (hex Unix seconds). */
export function stillSigned(url: string | null | undefined, now = Date.now()) {
  if (!url || !previewHostOk(url)) return false
  const oe = new URL(url).searchParams.get('oe')
  if (!oe || !/^[0-9a-f]{6,10}$/i.test(oe)) return true
  return Number.parseInt(oe, 16) * 1000 > now + 15 * 60_000
}

/** The app's volume_data.volume: a field 1 float of protobuf (0x0d, then the volume as float32 little-endian), base64. */
export function volumeData(volume: number) {
  const b = Buffer.alloc(5)
  b[0] = 0x0d
  b.writeFloatLE(volume, 1)
  return b.toString('base64')
}

async function signedInId(run: DriverRun): Promise<string> {
  const id = (await api(run).cookies()).find((c) => c.name === 'ds_user_id')?.value
  if (!id) throw new NeedsLogin('Instagram did not keep the sign-in.')
  return id
}

export const instagramApi: Driver = {
  id: 'instagram',
  kind: 'api',
  template: 'instagram',
  name: 'Instagram',
  platforms: ['instagram'],
  signIn: {
    url: 'https://www.instagram.com/accounts/login/',
    method: 'password',
    cookieDomains: ['instagram.com'],
  },
  capabilities: () => capabilities,

  async looksSignedIn(context) {
    return (
      !!(await cookie(context, 'https://www.instagram.com', 'sessionid')) &&
      !!(await cookie(context, 'https://www.instagram.com', 'ds_user_id')) &&
      !context.pages().some((p) => /\/accounts\/login|\/challenge\//.test(p.url()))
    )
  },

  async discover(run) {
    const id = await signedInId(run)
    let u: User | null = null
    try {
      u = await api(run).call<User>('profile', { userId: id }, { maxTier: 1 })
    } catch (err) {
      if (err instanceof NeedsLogin) throw err
      run.warn(`The Instagram account could not be read yet (${(err as Error).message.slice(0, 160)})`)
    }
    const account: DiscoveredAccount = {
      platform: 'instagram',
      externalId: id,
      name: u?.name || u?.username || 'Instagram account',
      handle: u?.username ? `@${u.username}` : '',
      avatarUrl: u?.picture ?? null,
      profileUrl: u?.username ? `https://www.instagram.com/${u.username}/` : null,
      platformIds: {
        userId: id,
        ...(u?.username ? { username: u.username } : {}),
        ...(u?.fbId ? { igUserId: String(u.fbId) } : {}),
      },
      capabilities,
      login: u?.username ? { name: `@${u.username}`, avatarUrl: u.picture ?? null } : null,
    }
    return [account]
  },

  async check(run, account) {
    try {
      const id = await signedInId(run)
      if (id !== account.externalId)
        return { ok: false, reason: 'This sign-in is now another Instagram account.' }
      // A cookie is not a sign-in: publishing goes through the app's requests with this session (IGT), so one of
      // them is made. On 25 Nov 2026 Instagram logged that form out while the cookie stayed, and the check kept
      // saying connected until the 13:00 carousel failed.
      try {
        await api(run).call('musicSearch', { query: 'piano' }, { maxTier: 1 })
      } catch (err) {
        if (/login_required|logged out|HTTP 401/i.test((err as Error).message))
          return {
            ok: false,
            reason:
              'Instagram logged Greenlit out (its posting requests answer "login_required"). Reconnect Instagram.',
          }
        throw err
      }
      return { ok: true }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  /** The latest posts of the account's grid, read back for the sync. */
  async list(run, account, opts) {
    let username = account.platformIds.username
    if (!username) {
      const u = await api(run).call<User>('profile', { userId: account.externalId }, { maxTier: 1 })
      username = u?.username
    }
    if (!username) return []
    const posts = (await api(run).call<GridPost[]>('posts', { username, count: 24 }, { maxTier: 1 })) ?? []
    const since = opts.since ? opts.since.getTime() / 1000 : 0
    return posts
      .filter((p) => p.id && p.code && (!since || Number(p.created ?? 0) >= since))
      .map((p) => {
        const reel = p.kind === 'clips'
        const created = Number(p.created ?? 0)
        return {
          remoteId: String(p.id),
          url: `https://www.instagram.com/${reel ? 'reel' : 'p'}/${p.code}/`,
          placement: (reel ? 'reel' : 'feed') as Placement,
          title: '',
          caption: p.text ?? '',
          thumbnailUrl: p.image ?? null,
          mediaUrl: null,
          state: 'published' as const,
          scheduledAt: null,
          publishedAt: created ? new Date(created * 1000).toISOString() : null,
          stats:
            p.likes !== undefined || p.comments !== undefined
              ? { likes: Number(p.likes ?? 0), comments: Number(p.comments ?? 0) }
              : null,
        }
      })
  },
  async publish(run, account, req) {
    if (req.placement === 'story') return publishStory(run, account, req)
    if (req.placement !== 'reel' && req.placement !== 'feed') throw notYet(req.placement)
    const out = await (req.placement === 'reel'
      ? publishReel(run, account, req)
      : publishFeed(run, account, req))
    return commentOn(run, req, out)
  },
  /** A published post is not changed from Greenlit: the app's Edit ends the sign-in's session (APP_ONLY_WRITES). */
  async update() {
    throw new ConnectorUnsupported('update', APP_ONLY_WRITES.editMedia)
  },
  /** Deletes a post as the app's Delete does: it goes to Recently deleted, where it can be restored for 30 days. */
  async remove(run, account, remoteId) {
    if (!MEDIA_ID.test(remoteId))
      throw new ConnectorUnsupported(
        'remove',
        'Greenlit does not know this reel’s id on Instagram: delete it in the Instagram app',
      )
    if (!remoteId.endsWith(`_${account.externalId}`))
      throw new Error('This post belongs to another Instagram account')
    const out = await api(run).call<{ status?: string; deleted?: boolean; message?: string }>(
      'deleteMedia',
      { mediaId: remoteId },
      { write: true, maxTier: 1, key: `ig-delete-${remoteId}` },
    )
    if (!api(run).dryRun && (out?.status !== 'ok' || out.deleted === false))
      throw new Error(`Instagram did not delete the post${out?.message ? `: ${out.message}` : ''}`)
  },

  /** Sounds for a reel, as the app's audio picker finds them. */
  async searchMusic(run, _account, query, placement) {
    // A picture or a video in the feed with a sound is a reel on Instagram; a picture story takes one (a video story not yet).
    if ((placement !== 'reel' && placement !== 'feed' && placement !== 'story') || !query.trim()) return []
    const sounds = await api(run).call<IgSound[]>('musicSearch', { query: query.trim() }, { maxTier: 1 })
    return (sounds ?? []).flatMap((s) => igSoundToTrack(s) ?? [])
  },
}

/** The sound as the app's search gives it, with its DASH manifest (the story sticker needs it for the audio to play). */
async function soundOf(run: DriverRun, music: MusicChoice): Promise<IgSound | null> {
  const query = [music.title, music.artist].filter(Boolean).join(' ').trim()
  const sounds = await api(run).call<IgSound[]>('musicSearch', { query }, { maxTier: 1 })
  for (const s of sounds ?? []) {
    const t = igSoundToTrack(s)
    if (t?.trackId === music.trackId && s?.dashManifest) return s
  }
  return null
}

/**
 * The sound's whole track: the address the post kept when it is still signed, else the one the app's search gives
 * now (found by the sound's title and artist, then its ids).
 */
async function soundSource(run: DriverRun, music: MusicChoice): Promise<SoundSource> {
  if (stillSigned(music.previewUrl)) return { url: music.previewUrl!, offset: 0, length: music.duration }
  const ids = parseIgTrackId(music.trackId)
  const query = [music.title, music.artist].filter(Boolean).join(' ').trim()
  if (ids && query) {
    const sounds = await api(run).call<IgSound[]>('musicSearch', { query }, { maxTier: 1 })
    for (const s of sounds ?? []) {
      const t = igSoundToTrack(s)
      if (t?.trackId === music.trackId && t.previewUrl)
        return { url: t.previewUrl, offset: 0, length: t.duration }
    }
  }
  throw new Error(`Instagram no longer finds the sound ${music.title}: choose it again`)
}

const warnLeftOut = (run: DriverRun, req: PublishRequest, what: string) => {
  if (req.options.paidPartnership === true)
    run.warn('The paid partnership label is not set through the app’s requests yet: add it in the app')
  if (req.firstComment.trim() && what === 'story')
    run.warn('A story has no comments: the first comment was left out')
  if (req.thumbnailPath && (what !== 'reel' || req.thumbnailAt === null || req.thumbnailAt === undefined))
    run.warn(
      what === 'reel'
        ? 'Instagram takes a frame of the reel as its cover through the app’s requests: a picture of your own is not set'
        : `Instagram takes the ${what}’s first frame as its cover through the app’s requests`,
    )
}

const refuseSchedule = (req: PublishRequest) => {
  if (req.scheduleAt)
    throw new ConnectorUnsupported(
      'scheduleAt',
      'Instagram posts through the app’s requests go out now; schedule them by publishing at the time',
    )
}

/** How long to look for a post Instagram publishes in the background, and how often (tests shorten it). */
export const FIND_REEL = { tries: 6, waitMs: 5000 }

interface GridItem {
  id?: string
  code?: string
  created?: number
  text?: string | null
  kind?: string
}

/** The post just published, read back from the account's grid: one made since `since` with this caption. */
async function findPost(
  run: DriverRun,
  account: DriverAccount,
  caption: string,
  since: number,
  reel: boolean,
) {
  const username = account.platformIds.username
  if (!username) return null
  const want = caption.trim().slice(0, 2200)
  for (let i = 0; i < FIND_REEL.tries; i++) {
    await new Promise((r) => setTimeout(r, FIND_REEL.waitMs))
    const posts = await api(run)
      .call<GridItem[]>('posts', { username, count: 12 }, { maxTier: 1 })
      .catch(() => [])
    const hit = (posts ?? []).find(
      (p) =>
        p.id &&
        (p.kind === 'clips') === reel &&
        Number(p.created ?? 0) * 1000 >= since - 60_000 &&
        (p.text ?? '').trim() === want,
    )
    if (hit) return { remoteId: String(hit.id), code: hit.code ? String(hit.code) : null }
  }
  return null
}

/** The post a configure answer names, when it names one (Share runs in the background and often does not). */
const named = (done: Configured, account: DriverAccount) =>
  done.id
    ? { remoteId: String(done.id), code: done.code ? String(done.code) : null }
    : done.pk
      ? { remoteId: `${done.pk}_${account.externalId}`, code: done.code ? String(done.code) : null }
      : null

/**
 * The app's Share (a configure request). Instagram answers "Transcode not finished yet" while it processes an
 * upload: Share is sent again for a while. Any other failure of Share is final: Instagram may have made the post
 * anyway, and a retry would make a second one.
 */
async function share(
  run: DriverRun,
  op: string,
  args: Record<string, unknown>,
  attempt: string,
  what: string,
): Promise<Configured> {
  const a = api(run)
  const processing = (text: string | undefined) => /transcode|not finished|processing/i.test(text ?? '')
  let done: Configured | null = null
  for (let i = 0; i < 12; i++) {
    try {
      done = await a.call<Configured>(op, args, { write: true, maxTier: 1, key: `${attempt}:share:${i}` })
    } catch (err) {
      if (!processing((err as Error).message))
        throw Object.assign(
          new Error(
            `Instagram's answer to the ${what}'s Share was not read (${(err as Error).message}). Check the profile before publishing again: the ${what} may be there.`,
          ),
          { retriable: false },
        )
      done = { status: 'fail', message: (err as Error).message }
    }
    if (a.dryRun || done?.status === 'ok' || !processing(done?.message)) break
    run.step('Instagram is still processing the upload')
    await new Promise((r) => setTimeout(r, SHARE_RETRY.waitMs))
  }
  if (a.dryRun) return { status: 'ok' }
  if (done?.status === 'ok' && !done.pk && !done.id && !done.code)
    run.step(`Instagram took the ${what}'s Share and publishes it in the background: ${JSON.stringify(done)}`)
  if (done?.status !== 'ok')
    throw new Error(`Instagram did not publish the ${what}${done?.message ? `: ${done.message}` : ''}`)
  return done
}

/** One attempt's upload ids, as the app makes them from the time in ms: each new one is later than the last. */
function uploadIds() {
  let last = Date.now()
  return () => String(++last)
}

const videoEntity = (size: number, uploadId: string) =>
  `${randomBytes(16).toString('hex')}-0-${size}-${uploadId}-${uploadId}`
const photoEntity = (uploadId: string) => `${uploadId}_0_${randomBytes(4).readUInt32BE(0)}`

/** A picture's size, as Greenlit reads it. */
async function pictureSize(path: string) {
  const p = await probe(path)
  if (!p.width || !p.height) throw new Error('The picture has no size Greenlit could read')
  return { width: p.width, height: p.height }
}

/** Sends a picture to Instagram's upload server (uploadPhoto). */
async function sendPhoto(
  run: DriverRun,
  o: {
    path: string
    uploadId: string
    sessionId: string
    shareType: 'feed' | 'stories'
    sidecar?: boolean
    cover?: boolean
    width: number
    height: number
    key: string
    /** A picture story's sound, burned into the picture by Instagram at upload: the asset and where it starts. */
    sound?: { assetId: string; startMs: number; lengthMs: number }
  },
) {
  const { size } = await stat(o.path)
  const up = await api(run).call<{ status?: string; upload_id?: string }>(
    'uploadPhoto',
    {
      entityName: photoEntity(o.uploadId),
      size: String(size),
      uploadId: o.uploadId,
      sessionId: o.sessionId,
      mediaType: o.cover ? '2' : '1',
      shareType: o.shareType,
      sidecar: o.sidecar ? '1' : '',
      cover: o.cover ? 'first_frame' : '',
      photoToVideoMs: o.sound ? String(o.sound.lengthMs) : '',
      musicBurnin: o.sound ? JSON.stringify({ asset_fbid: o.sound.assetId, offset_ms: o.sound.startMs }) : '',
      stickerBurnin: o.sound ? '[]' : '',
      forAlbum: o.sound ? '1' : '',
      width: o.width,
      height: o.height,
      path: o.path,
    },
    { write: true, maxTier: 1, key: o.key, timeoutMs: 10 * 60_000 },
  )
  if (!api(run).dryRun && up?.status !== 'ok') throw new Error('Instagram did not take the picture')
}

/** Sends a video to Instagram's upload server (uploadVideo), for a story or a carousel. */
async function sendVideo(
  run: DriverRun,
  o: {
    path: string
    uploadId: string
    sessionId: string
    shareType: 'feed' | 'stories'
    length: number
    width: number
    height: number
    key: string
    /** A video story's sound, burned in by Instagram at upload: the asset and where it starts. */
    sound?: { assetId: string; startMs: number; lengthMs: number }
  },
) {
  const { size } = await stat(o.path)
  const story = o.shareType === 'stories'
  const up = await api(run).call<{ status?: string }>(
    'uploadVideo',
    {
      entityName: videoEntity(size, o.uploadId),
      size: String(size),
      uploadId: o.uploadId,
      sessionId: o.sessionId,
      shareType: o.shareType,
      sidecar: story ? '' : '1',
      forAlbum: story ? '1' : '',
      extractCover: story ? '1' : '',
      durationMsText: String(Math.round(o.length * 1000)),
      widthText: String(o.width),
      heightText: String(o.height),
      musicBurnin: o.sound ? JSON.stringify({ asset_fbid: o.sound.assetId, offset_ms: o.sound.startMs }) : '',
      path: o.path,
    },
    { write: true, maxTier: 1, key: o.key, timeoutMs: 30 * 60_000 },
  )
  if (!api(run).dryRun && up?.status !== 'ok') throw new Error('Instagram did not take the video')
}

/** The edits the app writes for a picture it posts uncropped. */
const pictureEdits = (w: number, h: number) =>
  `{"filter_type":0,"filter_strength":1.0,"crop_original_size":[${w}.0,${h}.0],"crop_center":[0.0,-0.0],"crop_zoom":1.0}`
const DEVICE =
  '{"manufacturer":"Google","model":"sdk_gphone64_x86_64","android_version":33,"android_release":"13"}'

/** A carousel item as the app writes it in children_metadata (recorded from its carousel Share). */
export function carouselChild(item: {
  uploadId: string
  width: number
  height: number
  length?: number
}): Record<string, string> {
  const common = {
    upload_id: item.uploadId,
    original_width: String(item.width),
    original_height: String(item.height),
    source_type: '4',
    creation_tool_info: '[]',
    hide_from_profile_grid: 'false',
    bottom_camera_dial_selected: '11',
    audience: 'default',
    timezone_offset: '0',
    app_attribution_android_namespace: '',
    extra: `{"source_width":${item.width},"source_height":${item.height}}`,
    device: DEVICE,
  }
  if (item.length === undefined)
    return { ...common, scene_capture_type: '', edits: pictureEdits(item.width, item.height) }
  const length = String(Math.round(item.length * 1000) / 1000)
  return {
    ...common,
    video_result: '',
    clips: `[{"length":${length},"source_type":"4"}]`,
    poster_frame_index: '0',
    length,
    audio_muted: 'false',
    edits: '{"filter_type":0,"filter_strength":1.0}',
  }
}

/**
 * The post's location as the app's Share writes it, found by searching Instagram's places for the name (the place with
 * the chosen id, else the exact name, else the first): a JSON string, or '' when Instagram knows no such place.
 */
async function placeFor(run: DriverRun, req: PublishRequest): Promise<string> {
  const loc = req.location
  if (!loc?.name.trim()) return ''
  if (api(run).dryRun) return JSON.stringify({ name: loc.name, external_source: 'meta_place' })
  let places: IgPlace[]
  try {
    places = (await api(run).call<IgPlace[]>('placeSearch', { query: loc.name.trim() }, { maxTier: 1 })) ?? []
  } catch (err) {
    // the post's pictures are up already: a failed search leaves the location out rather than the post
    run.warn(
      `Instagram's place search failed, so the post went up without a location: ${(err as Error).message.slice(0, 160)}`,
    )
    return ''
  }
  const usable = places.filter(
    (x) => x?.placeId !== undefined && typeof x.lat === 'number' && typeof x.lng === 'number',
  )
  const want = loc.name.trim().toLowerCase()
  const pick =
    usable.find((x) => loc.platformId && String(x.placeId) === loc.platformId) ??
    usable.find((x) => (x.name ?? '').trim().toLowerCase() === want) ??
    usable[0]
  if (!pick) {
    run.warn(`Instagram knows no place called ${loc.name}: the post went up without a location`)
    return ''
  }
  run.step(`Location: ${pick.name}`)
  return JSON.stringify({
    name: pick.name,
    address: pick.subtitle ?? '',
    lat: pick.lat,
    lng: pick.lng,
    external_source: 'meta_place',
    meta_place_id: String(pick.placeId),
  })
}

/**
 * The post's first comment, posted as the app's comment box posts it once the post is up (the account's own post,
 * by its id). The post stays published when the comment fails: Greenlit says so.
 */
async function commentOn(run: DriverRun, req: PublishRequest, out: PublishOutcome): Promise<PublishOutcome> {
  const text = req.firstComment.trim()
  if (!text) {
    if (req.options.pinFirstComment === true) run.warn('There is no first comment to pin')
    return out
  }
  if (api(run).dryRun) {
    run.step(`Would post the first comment${req.options.pinFirstComment === true ? ' and pin it' : ''}`)
    return out
  }
  const id = out.remoteId.match(/^(\d{4,25})_\d{3,20}$/)
  if (!id) {
    run.warn('Instagram did not name the post, so the first comment was not posted: add it in the app')
    return out
  }
  try {
    const r = await api(run).call<{ status?: string; id?: string | number; message?: string }>(
      'postComment',
      { mediaId: out.remoteId, numericId: id[1], text: text.slice(0, 2200), token: randomUUID() },
      { write: true, maxTier: 1, key: `ig-comment:${out.remoteId}` },
    )
    if (r?.status !== 'ok') throw new Error(r?.message ?? 'Instagram did not take it')
    run.step('First comment posted')
    if (req.options.pinFirstComment === true) await pinComment(run, out.remoteId, r.id)
  } catch (err) {
    run.warn(`The post is up, but its first comment was not posted: ${(err as Error).message.slice(0, 200)}`)
  }
  return out
}

/** Pins the comment under the post, as the app's Pin does. The comment stays when Instagram does not pin it. */
async function pinComment(run: DriverRun, mediaId: string, commentId: string | number | undefined) {
  const id = String(commentId ?? '')
  if (!/^\d{5,25}$/.test(id)) {
    run.warn('Instagram did not name the comment, so it was not pinned: pin it in the app')
    return
  }
  try {
    const r = await api(run).call<{ status?: string; message?: string }>(
      'pinComment',
      { mediaId, commentId: id },
      { write: true, maxTier: 1, key: `ig-pin:${id}` },
    )
    if (r?.status !== 'ok') throw new Error(r?.message ?? 'Instagram did not take it')
    run.step('First comment pinned')
  } catch (err) {
    run.warn(`The first comment is up but not pinned: ${(err as Error).message.slice(0, 200)}`)
  }
}

/** The cover as the app's cover editor sets it: the chosen frame's time, and its place in the video as a percentage. */
function coverFrame(req: PublishRequest, length: number) {
  const at = req.thumbnailAt
  if (at === null || at === undefined || !(length > 0)) return {}
  const t = Math.min(Math.max(at, 0), length)
  return { coverMs: String(Math.round(t * 1000)), posterIndex: Math.min(100, Math.floor((t / length) * 100)) }
}

const aiLabel = (req: PublishRequest) => (req.options.aiGenerated === true ? 'SELF_DISCLOSURE_FLOW' : '')

/** What a feed post or a story cannot take through the app's requests yet; Greenlit says so on the post. */
function warnFeed(run: DriverRun, req: PublishRequest, what: string) {
  warnLeftOut(run, req, what)
  if (req.music)
    run.warn(`Instagram sounds go on reels for now: the ${what} went up without ${req.music.title}`)
  if (req.options.allowComments === false && what === 'story')
    run.warn('A story has no comments switch: the setting was left out')
}

/** The comments switch of a feed post's Share ("Turn off commenting": disable_comments). */
const commentsOff = (req: PublishRequest) => (req.options.allowComments === false ? '1' : '0')

/** The outcome of a feed post's Share: the post it names, else the one found in the grid by its caption. */
async function feedOutcome(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
  done: Configured,
  started: number,
  fallbackId: string,
): Promise<PublishOutcome> {
  if (api(run).dryRun) return { remoteId: 'dry-run', url: null, state: 'published' }
  const post = named(done, account) ?? (await findPost(run, account, req.caption, started, false))
  if (!post)
    run.warn(
      'Instagram is publishing the post in the background and named no id: Greenlit cannot link to it or delete it',
    )
  run.step(`Instagram post ${post?.code ?? post?.remoteId ?? fallbackId}`)
  return {
    remoteId: post?.remoteId ?? `upload:${fallbackId}`,
    url: post?.code ? `https://www.instagram.com/p/${post.code}/` : null,
    state: 'published',
  }
}

/**
 * Changes a post as the app's Edit does: its caption and place (edit_media, which names the post's AI label as it
 * is, so it stays), and comments on or off (the post menu's switch). A story has nothing to edit here.
 *
 * Not called by the driver (APP_ONLY_WRITES: Instagram ends the sign-in's session for it).
 */
export async function editPost(run: DriverRun, remoteId: string, patch: Partial<PublishRequest>) {
  if (!MEDIA_ID.test(remoteId))
    throw new ConnectorUnsupported('update', 'Greenlit cannot edit this post: Instagram did not name it')
  if (patch.caption === undefined)
    throw new ConnectorUnsupported(
      'update',
      'Instagram posts are edited here by their caption, place and comments',
    )
  const asked = patch.location?.name.trim() ? (patch as PublishRequest) : null
  const location = asked ? await placeFor(run, asked) : ''
  const r = await api(run).call<{ status?: string; message?: string }>(
    'editMedia',
    {
      mediaId: remoteId,
      caption: patch.caption.slice(0, 2200),
      aiMethod: patch.options?.aiGenerated === true ? 'SELF_DISCLOSURE_FLOW' : 'NONE',
      location,
    },
    // One key per edit: an edit is safe to send again, and a key already used is never sent twice (editing A, then
    // B, then back to A would otherwise leave B).
    { write: true, maxTier: 1, key: `ig-edit:${remoteId}:${randomUUID()}` },
  )
  if (r?.status !== 'ok')
    throw new Error(`Instagram did not change the caption${r?.message ? `: ${r.message}` : ''}`)
  run.step(location ? 'Caption and place changed' : 'Caption changed')
  const comments = patch.options?.allowComments
  if (typeof comments === 'boolean') {
    const op = comments ? 'enableComments' : 'disableComments'
    const c = await api(run).call<{ status?: string; message?: string }>(
      op,
      { mediaId: remoteId },
      { write: true, maxTier: 1, key: `ig-${op}:${remoteId}:${randomUUID()}` },
    )
    if (c?.status !== 'ok')
      run.warn(
        `The caption changed, but comments were not turned ${comments ? 'on' : 'off'}${c?.message ? `: ${c.message}` : ''}`,
      )
    else run.step(`Comments ${comments ? 'on' : 'off'}`)
  }
}

/**
 * A feed post, made as the app makes it: one picture (uploadPhoto, then configurePhoto). A feed post of one video
 * is a reel on Instagram (publishReel, shown in the grid). A carousel is refused before anything is uploaded
 * (APP_ONLY_WRITES: its Share ends the sign-in's session).
 */
export async function publishFeed(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  refuseSchedule(req)
  const files = req.files.filter((f) => f.kind === 'image' || f.kind === 'video')
  if (!files.length)
    throw new ConnectorUnsupported('placement', 'A feed post has at least one picture or video')
  if (files.length > 1) throw new ConnectorUnsupported('placement', APP_ONLY_WRITES.configureSidecar)
  if (files[0]!.kind === 'video') {
    run.step('Instagram posts a single video as a reel, shown in the grid')
    return publishReel(run, account, {
      ...req,
      placement: 'reel',
      options: { ...req.options, shareToFeed: true },
    })
  }
  if (req.music) {
    // Instagram makes a picture with a sound into a reel (its editor says "New reel"): the picture becomes a
    // silent video of a few seconds (STILL_SECONDS, or the post's stillSeconds) and goes out as a reel with the sound.
    const asked = Number(req.options.stillSeconds)
    const seconds = Math.min(90, Math.max(3, Math.round(asked > 0 ? asked : STILL_SECONDS)))
    run.step(
      `Instagram makes a picture with a sound into a reel: ${seconds} s of the picture, with ${req.music.title}`,
    )
    const name = `still-${Date.now()}`
    const video = await stillVideo(run, files[0]!.path, seconds, name, 'instagram-sounds')
    try {
      return await publishReel(run, account, {
        ...req,
        placement: 'reel',
        files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
        options: { ...req.options, shareToFeed: true },
      })
    } finally {
      await rm(video, { force: true })
    }
  }
  warnFeed(run, req, 'post')
  const next = uploadIds()
  const started = Date.now()
  const caption = req.caption.slice(0, 2200)

  const uploadId = next()
  const attempt = `ig-${uploadId}`
  const { width, height } = await pictureSize(files[0]!.path)
  await sendPhoto(run, {
    path: files[0]!.path,
    uploadId,
    sessionId: uploadId,
    shareType: 'feed',
    width,
    height,
    key: `${attempt}:photo`,
  })
  if (!api(run).dryRun) run.step('Picture sent to Instagram')
  const done = await share(
    run,
    'configurePhoto',
    {
      uploadId,
      caption,
      widthText: String(width),
      heightText: String(height),
      width,
      height,
      aiLabel: aiLabel(req),
      disableComments: commentsOff(req),
      location: await placeFor(run, req),
    },
    attempt,
    'post',
  )
  return feedOutcome(run, account, req, done, started, uploadId)
}

/**
 * A carousel of 2 to 10 pictures and videos, made as the app makes it: each uploaded as an item of the carousel (a
 * video with its first frame as its cover), then configureSidecar.
 *
 * Not called by the driver (APP_ONLY_WRITES: Instagram ends the sign-in's session for its Share).
 */
export async function publishCarousel(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  refuseSchedule(req)
  const files = req.files.filter((f) => f.kind === 'image' || f.kind === 'video')
  if (files.length < 2) throw new ConnectorUnsupported('placement', 'A carousel has at least 2 items')
  if (files.length > 10) throw new ConnectorUnsupported('placement', 'A carousel has at most 10 items')
  warnFeed(run, req, 'post')
  const next = uploadIds()
  const started = Date.now()
  const caption = req.caption.slice(0, 2200)

  // A carousel: its own id is its items' upload session.
  const sidecarId = next()
  const attempt = `ig-${sidecarId}`
  const children: Record<string, string>[] = []
  const made: string[] = []
  try {
    for (const [i, f] of files.entries()) {
      const uploadId = next()
      if (f.kind === 'image') {
        const { width, height } = await pictureSize(f.path)
        await sendPhoto(run, {
          path: f.path,
          uploadId,
          sessionId: sidecarId,
          shareType: 'feed',
          sidecar: true,
          width,
          height,
          key: `${attempt}:item:${i}`,
        })
        children.push(carouselChild({ uploadId, width, height }))
      } else {
        const info = await probe(f.path)
        if (!info.durationSec || !info.width || !info.height)
          throw new Error('A video of the carousel has no length or size Greenlit could read')
        if (info.durationSec > 60)
          throw new ConnectorUnsupported('placement', 'A carousel video is at most 60 seconds long')
        await sendVideo(run, {
          path: f.path,
          uploadId,
          sessionId: sidecarId,
          shareType: 'feed',
          length: info.durationSec,
          width: info.width,
          height: info.height,
          key: `${attempt}:item:${i}`,
        })
        const cover = api(run).dryRun ? f.path : await firstFrame(run, f.path, `${attempt}-${i}`, 'instagram')
        if (cover !== f.path) made.push(cover)
        const c = api(run).dryRun ? { width: info.width, height: info.height } : await pictureSize(cover)
        await sendPhoto(run, {
          path: cover,
          uploadId,
          sessionId: sidecarId,
          shareType: 'feed',
          sidecar: true,
          cover: true,
          width: c.width,
          height: c.height,
          key: `${attempt}:cover:${i}`,
        })
        children.push(
          carouselChild({ uploadId, width: info.width, height: info.height, length: info.durationSec }),
        )
      }
      if (!api(run).dryRun) run.step(`Item ${i + 1} of ${files.length} sent to Instagram`)
    }
  } finally {
    for (const m of made) await rm(m, { force: true })
  }
  const done = await share(
    run,
    'configureSidecar',
    {
      sidecarId,
      caption,
      children,
      aiLabel: aiLabel(req),
      disableComments: commentsOff(req),
      location: await placeFor(run, req),
    },
    attempt,
    'carousel',
  )
  return feedOutcome(run, account, req, done, started, sidecarId)
}

/**
 * A story, shared as the app's "Your story" does: one picture (uploadPhoto, then configureStoryPhoto) or one video of
 * up to 60 seconds (uploadVideo, Instagram making its cover, then configureStoryVideo). A sound from Instagram's
 * library goes in as the app's hidden music sticker and is burned in at upload (the *WithSound Shares); else a place
 * goes in as the app's location sticker, drawn on the picture or video as the app burns its stickers in, its tap area
 * named in the Share. Stories are not in the grid, so one Instagram shares in the background keeps its upload's id
 * and links to the account's stories.
 */
export async function publishStory(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  refuseSchedule(req)
  const files = req.files.filter((f) => f.kind === 'image' || f.kind === 'video')
  if (files.length !== 1) throw new ConnectorUnsupported('placement', 'A story is one picture or one video')
  const f = files[0]!
  const video = f.kind === 'video'
  const music = req.music
  const ids = music ? parseIgTrackId(music.trackId) : null
  if (music && !ids) throw new Error('This sound is not one of Instagram’s: choose it again')
  warnFeed(run, { ...req, music: null, location: null }, 'story')
  if (req.caption.trim()) run.warn('A story has no caption on Instagram: the text was left out')
  const a = api(run)
  const dry = a.dryRun
  const uploadId = uploadIds()()
  const attempt = `ig-${uploadId}`
  const nowSec = String(Math.floor(Date.now() / 1000))
  const info = video ? await probe(f.path) : null
  if (video && (!info?.durationSec || !info.width || !info.height))
    throw new Error('The video has no length or size Greenlit could read')
  if (video && info!.durationSec! > 60)
    throw new ConnectorUnsupported('placement', 'A story video is at most 60 seconds long')
  const { width, height } = video ? { width: info!.width!, height: info!.height! } : await pictureSize(f.path)

  // The sound as the app's search gives it, with the manifest the music sticker carries. A sound without one is left
  // out rather than shown silent.
  const found = music && ids && !dry ? await soundOf(run, music) : null
  const manifest = dry ? 'dry-run' : (found?.dashManifest ?? '')
  if (music && ids && !manifest)
    run.warn(`Instagram gave no audio for ${music.title}: the story went up without the sound`)
  const withSound = !!(music && ids && manifest)
  const startMs = Math.round((music?.startAt ?? 0) * 1000)
  // a picture story's sound plays 20 s, as the app sets it; a video story's, the video's length
  const lengthMs = video ? Math.round(info!.durationSec! * 1000) : STORY_SOUND_MS

  // A place, as the app's location sticker (not with a sound: the Share takes one sticker here).
  let path = f.path
  const made: string[] = []
  let sticker: { tapModels: string; stickerIds: string } | null = null
  if (req.location?.name.trim() && withSound)
    run.warn('A story with a sound takes no location sticker here: the location was left out')
  else if (req.location?.name.trim()) {
    const place = await placeFor(run, req)
    const meta = place ? (JSON.parse(place) as { meta_place_id?: string; name?: string }) : null
    if (meta?.meta_place_id && !dry) {
      try {
        const drawn = await withPlaceSticker(run, {
          path: f.path,
          kind: video ? 'video' : 'image',
          width,
          height,
          name: meta.name ?? req.location.name,
          file: `${attempt}-place`,
          folder: 'instagram',
        })
        path = drawn.path
        made.push(drawn.path, ...drawn.extra)
        sticker = { tapModels: placeTapModels(drawn.box, meta.meta_place_id), stickerIds: 'location_sticker' }
        run.step(`Location sticker: ${meta.name}`)
      } catch (err) {
        run.warn(
          `The location sticker could not be drawn, so the story went up without it: ${(err as Error).message.slice(0, 160)}`,
        )
      }
    } else if (meta?.meta_place_id) sticker = { tapModels: '[]', stickerIds: 'location_sticker' }
  }

  try {
    const sound = withSound && ids ? { assetId: ids.assetId, startMs, lengthMs } : undefined
    if (video)
      await sendVideo(run, {
        path,
        uploadId,
        sessionId: uploadId,
        shareType: 'stories',
        length: info!.durationSec!,
        width,
        height,
        key: `${attempt}:video`,
        sound,
      })
    else
      await sendPhoto(run, {
        path,
        uploadId,
        sessionId: uploadId,
        shareType: 'stories',
        width,
        height,
        key: `${attempt}:photo`,
        sound,
      })
  } finally {
    for (const m of made) await rm(m, { force: true })
  }
  if (!dry) run.step(video ? 'Video sent to Instagram' : 'Picture sent to Instagram')
  const base = {
    uploadId,
    widthText: String(width),
    heightText: String(height),
    width,
    height,
    nowSec,
    ...(video ? { seconds: Math.round(info!.durationSec! * 1000) / 1000 } : {}),
  }
  if (withSound && music) {
    run.step(
      `Story with the sound ${music.title}, for ${Math.round(lengthMs / 1000)} s${video ? ' (the video’s own sound muted)' : ''}`,
    )
    if (video && req.audio.original > 0.001)
      run.warn(
        'A video story with a sound plays the sound only, as the app’s “music only” does: the video’s own sound is muted',
      )
  }
  const done = await share(
    run,
    withSound
      ? video
        ? 'configureStoryVideoWithSound'
        : 'configureStoryPhotoWithSound'
      : video
        ? 'configureStoryVideo'
        : 'configureStoryPhoto',
    withSound && music && ids
      ? {
          ...base,
          assetId: ids.assetId,
          clusterId: ids.clusterId,
          startMs,
          lengthMs,
          trackMs:
            Number(found?.durationMs) > 0
              ? Math.round(Number(found?.durationMs))
              : Math.round((music.duration ?? 60) * 1000),
          audioUrl:
            (found?.preview && previewHostOk(found.preview) ? found.preview : null) ??
            music.previewUrl ??
            'https://dry-run.invalid/',
          dashManifest: manifest,
          ...(found?.monetization ? { monetization: found.monetization } : {}),
          ...(found?.highlights?.length ? { highlights: found.highlights } : {}),
          cover: [found?.cover, music.coverUrl].find((c) => c && previewHostOk(c)) ?? '',
          title: music.title,
          artist: music.artist,
        }
      : { ...base, ...(sticker ?? {}) },
    attempt,
    'story',
  )
  if (dry) return { remoteId: 'dry-run', url: null, state: 'published' }
  const story = named(done, account)
  const username = account.platformIds.username
  run.step(`Instagram story ${story?.remoteId ?? uploadId}`)
  return {
    remoteId: story?.remoteId ?? `upload:${uploadId}`,
    url: username ? `https://www.instagram.com/stories/${username}/` : null,
    state: 'published',
  }
}

/** A location sticker's tap model, as the app writes it (where the drawn sticker is, and its place). */
export function placeTapModels(box: StickerBox, metaPlaceId: string): string {
  return JSON.stringify([
    {
      x: box.x,
      y: box.y,
      z: 0,
      width: box.width,
      height: box.height,
      rotation: 0.0,
      type: 'location',
      meta_place_id: metaPlaceId,
      is_sticker: true,
      tap_state: 0,
      tap_state_str_id: 'location_sticker_refresh_default',
    },
  ])
}

/**
 * A reel, made as the Instagram app makes it: with a sound, the sound mixed into the video (its start, both
 * volumes; sound-mix.ts), the file sent to Instagram's upload server in one piece (uploadReelVideo), then the app's
 * Share (configureReelWithSound, which links the sound; configureReel without one, the video's own audio at its
 * volume). Once Instagram has the reel, a failure is never retried: a retry would make a second one.
 */
export async function publishReel(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  refuseSchedule(req)
  const video = req.files.find((f) => f.kind === 'video')
  if (!video || req.files.length !== 1) throw new ConnectorUnsupported('placement', 'A reel is one video')
  const info = await probe(video.path)
  const length = info.durationSec
  if (!length) throw new Error('The video has no length Greenlit could read')
  if (length > REEL_MAX_SECONDS)
    throw new ConnectorUnsupported('placement', `A reel is at most ${REEL_MAX_SECONDS / 60} minutes long`)
  if (!info.width || !info.height) throw new Error('The video has no size Greenlit could read')
  const music = req.music
  const ids = music ? parseIgTrackId(music.trackId) : null
  if (music && !ids) throw new Error('This sound is not one of Instagram’s: choose it again')
  warnLeftOut(run, req, 'reel')

  const a = api(run)
  const dry = a.dryRun
  // One upload id per attempt, as the app makes them (the time in ms); it keys each write of the attempt.
  const started = Date.now()
  const uploadId = String(started)
  const attempt = `ig-${uploadId}`
  let file = video.path
  if (music && !dry) {
    const src = await soundSource(run, music)
    file = await mixSound(run, {
      video: video.path,
      src,
      music,
      audio: req.audio,
      length,
      name: attempt,
      folder: 'instagram-sounds',
      app: 'the Instagram app',
    })
  } else if (!music && !dry)
    file = await withOwnVolume(run, {
      video: video.path,
      volume: req.audio.original,
      name: attempt,
      folder: 'instagram-sounds',
    })
  if (dry && music) run.step(`Would mix ${music.title} into the video from ${music.startAt ?? 0} s`)
  try {
    const { size } = await stat(file)
    const durationMs = Math.round(length * 1000)
    const up = await a.call<{ media_id?: string | number; status?: string }>(
      'uploadReelVideo',
      {
        entityName: videoEntity(size, uploadId),
        size: String(size),
        uploadId,
        durationMs,
        width: info.width,
        height: info.height,
        path: file,
      },
      { write: true, maxTier: 1, key: `${attempt}:upload`, timeoutMs: 30 * 60_000 },
    )
    if (!dry && up?.status !== 'ok') throw new Error('Instagram did not take the video')
    if (!dry) run.step('Video sent to Instagram')

    const common = {
      uploadId,
      caption: req.caption.slice(0, 2200),
      seconds: Math.round(length * 1000) / 1000,
      durationMs,
      widthText: String(info.width),
      heightText: String(info.height),
      width: info.width,
      height: info.height,
      originalVolume: req.audio.original,
      disableComments: req.options.allowComments === false ? '1' : '0',
      shareToFeed: req.options.shareToFeed === false ? '0' : '1',
      aiLabel: aiLabel(req),
      ...coverFrame(req, length),
      location: await placeFor(run, req),
    }
    const op = music ? 'configureReelWithSound' : 'configureReel'
    const args = music
      ? {
          ...common,
          assetId: ids!.assetId,
          clusterId: ids!.clusterId,
          startMs: Math.round((music.startAt ?? 0) * 1000),
          trackMs: Math.round((music.duration ?? length) * 1000),
          songName: music.title,
          artist: music.artist,
          songVolume: req.audio.music,
          volumeData: volumeData(req.audio.music),
          cover: music.coverUrl && previewHostOk(music.coverUrl) ? music.coverUrl : '',
          audioUrl: '',
        }
      : common
    const done = await share(run, op, args, attempt, 'reel')
    if (dry) return { remoteId: 'dry-run', url: null, state: 'published' }
    // The app's Share publishes in the background (async_publish): Instagram answers "ok" without the reel. A
    // reel also shown in the grid is then found there by its caption; one kept to the Reels tab is not listed
    // where Greenlit reads, and keeps the upload's id until Greenlit can read that tab.
    let reel = named(done, account)
    if (!reel && req.options.shareToFeed !== false)
      reel = await findPost(run, account, req.caption, started, true)
    if (!reel)
      run.warn(
        'Instagram is publishing the reel in the background and named no id: Greenlit cannot link to it or delete it',
      )
    const remoteId = reel?.remoteId ?? `upload:${uploadId}`
    run.step(`Instagram reel ${reel?.code ?? remoteId}${music ? `, with the sound ${music.title}` : ''}`)
    return {
      remoteId,
      url: reel?.code ? `https://www.instagram.com/reel/${reel.code}/` : null,
      state: 'published',
    }
  } finally {
    if (file !== video.path) await rm(file, { force: true })
  }
}
