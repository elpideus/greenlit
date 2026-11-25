import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MusicTrack } from '@greenlit/shared/areas/connectors'
import type { Placement } from '@greenlit/shared/areas/posts'
import { probe } from '../../../lib/ffmpeg.ts'
import { previewHostOk } from '../sounds.ts'
import { firstFrame } from './frames.ts'
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
import { cookie, findObjects, str } from './util.ts'

/**
 * How far ahead facebook.com takes a Page's scheduled post: at least 10 minutes (its composer's rule) and, as
 * seen on 25 Nov 2026, not much past four weeks: 23 Dec went in, 30 Dec came back "A server error field_exception
 * occured". 28 days keeps a day clear of that edge; a later post waits in Greenlit and goes out at its time.
 */
export const FB_FEED_SCHEDULE = { minLeadMinutes: 10, maxLeadDays: 28 }

/**
 * Facebook signed in directly on facebook.com, through API Anything (aa/sites/facebook.json): facebook.com's own
 * GraphQL requests over plain HTTP. One login reaches its own profile and every Page it can switch to (Pages
 * are profiles in Facebook's current Pages experience); each becomes an account, chosen when publishing.
 * `platformIds.actorId` is who a request acts as: the login itself or the Page's profile.
 *
 * Reading the profiles and Pages is plain requests. Posting (pictures or text, `postWithPhotos`) is wired but
 * switched off (`publish: false`) until a real send has been tested with the owner; a dry run already goes through
 * it and returns the requests it would send.
 *
 * A Page's reels, with a sound from Meta's music library, go through Meta Business Suite's own requests with the
 * same login (business.facebook.com, in the same spec): its music search, its video upload and its reel Share
 * (`reelWithSound`). Facebook adds the sound to the reel itself, at both volumes: nothing is mixed into the file.
 */

const capabilities = {
  ...noCapabilities,
  // Posting is switched on once a real send has been tested (postWithPhotos).
  publish: false,
  // Feed posts with pictures or text; a Page's reels below (pageCapabilities); stories come later.
  placements: ['feed'] as Placement[],
  delete: true,
  sync: true,
}
/**
 * A Page publishes (tested for real with the owner, Nov 2026) and schedules on Facebook itself (its composer's
 * Schedule post). The login's own profile stays read-only until a test there.
 */
const pageCapabilities = {
  ...capabilities,
  publish: true,
  // Feed posts schedule on Facebook itself, 10 minutes to 28 days ahead (FB_FEED_SCHEDULE); reels, and feed
  // posts further out, go out at their time from Greenlit.
  nativeSchedule: true,
  scheduleOn: ['feed'] as Placement[],
  scheduleWindow: { minMinutes: FB_FEED_SCHEDULE.minLeadMinutes, maxDays: FB_FEED_SCHEDULE.maxLeadDays },
  // Reels through Business Suite's requests, with a sound from Meta's music library at the volumes chosen.
  placements: ['feed', 'reel', 'story'] as Placement[],
  music: true,
  audioMix: true,
  // A reel's cover: the post's own frame or picture, uploaded as the composer uploads one.
  thumbnail: true,
  // A post's or reel's place (facebook.com's own search), and a first comment as the Page (Graph, plain requests).
  location: true,
  firstComment: true,
}

/** A sound as Business Suite's music search answers (musicSearch). */
interface FbSound {
  kind?: string
  assetId?: string
  title?: string
  artist?: string
  cover?: string
  preview?: string
  durationMs?: number | string
  tags?: string[]
}

export function fbSoundToTrack(s: FbSound | null | undefined): MusicTrack | null {
  if (s?.kind !== 'AudioAsset' || !s.assetId || !/^\d{5,30}$/.test(String(s.assetId))) return null
  const ms = Number(s.durationMs)
  return {
    trackId: String(s.assetId),
    title: s.title ?? '',
    artist: s.artist ?? '',
    coverUrl: s.cover && previewHostOk(s.cover) ? s.cover : null,
    previewUrl: s.preview && previewHostOk(s.preview) ? s.preview : null,
    duration: ms > 0 ? ms / 1000 : null,
    usage: null,
  }
}

interface TimelinePost {
  postId?: string
  created?: number | string
  text?: string
  url?: string
  mediaUrl?: string
  mediaType?: string
  image?: string
  thumbnail?: string
}

interface Profile {
  id?: string
  name?: string
  kind?: string
  picture?: string
  /** A Page's classic Page id (Business Suite's pageId). */
  delegatePageId?: string
}

const api = (run: DriverRun) => {
  if (!run.api) throw new Error('the Facebook connector runs through API Anything')
  return run.api
}

const notYet = (what: string) =>
  new ConnectorUnsupported(
    what,
    'Posting through facebook.com is not offered yet; it is tested with you first',
  )

/** Who sees a post: the request's `audience` option (everyone, friends, only me), everyone by default. */
const AUDIENCE: Record<string, 'EVERYONE' | 'FRIENDS' | 'SELF'> = {
  public: 'EVERYONE',
  everyone: 'EVERYONE',
  friends: 'FRIENDS',
  only_me: 'SELF',
  self: 'SELF',
}

/**
 * A feed post with pictures (or text only) through facebook.com's own requests: each picture is uploaded
 * (`uploadPhoto` → photoID), then `createPost` publishes them with the caption, as the account's actor. In a dry
 * run nothing is sent and the uploads' ids are placeholders.
 */
export async function postWithPhotos(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  const actorId = account.platformIds.actorId || account.externalId
  const dry = api(run).dryRun
  if (req.files.some((f) => f.kind !== 'image'))
    throw new ConnectorUnsupported('video', 'Videos through facebook.com are not supported yet')
  const page = account.platformIds.kind === 'page'
  // A Page schedules on Facebook itself, 10 minutes to 28 days ahead (FB_FEED_SCHEDULE).
  if (req.scheduleAt && !page)
    throw new ConnectorUnsupported(
      'scheduleAt',
      'A Facebook profile cannot schedule posts; Greenlit posts it on time',
    )
  const lead = req.scheduleAt ? req.scheduleAt.getTime() - Date.now() : 0
  if (req.scheduleAt && lead < FB_FEED_SCHEDULE.minLeadMinutes * 60_000)
    throw new ConnectorUnsupported(
      'scheduleAt',
      `Facebook schedules posts at least ${FB_FEED_SCHEDULE.minLeadMinutes} minutes ahead`,
    )
  if (req.scheduleAt && lead > FB_FEED_SCHEDULE.maxLeadDays * 86_400_000)
    throw new ConnectorUnsupported(
      'scheduleAt',
      `Facebook schedules posts at most ${FB_FEED_SCHEDULE.maxLeadDays} days ahead; Greenlit posts it on time`,
    )
  // One token per publish attempt: it keys each write (a retry inside this attempt is the same write, a new
  // attempt is a new one) and is the composer's idempotence token.
  const token = `${randomUUID()}_FEED`
  const attachments: { photo: { id: string } }[] = []
  for (const [i, f] of req.files.entries()) {
    const up = await api(run).call<{ photoID?: string }>(
      'uploadPhoto',
      { actorId, path: f.path, filename: basename(f.path), uploadId: `jsc_c_${i + 1}` },
      { write: true, maxTier: 1, timeoutMs: 5 * 60_000, key: `${token}:photo:${i}`, asActor: true },
    )
    if (!up?.photoID && !dry) throw new Error('Facebook did not return the uploaded picture')
    attachments.push({ photo: { id: up?.photoID ? String(up.photoID) : `<photo ${i + 1}>` } })
    if (!dry) run.step(`Picture ${i + 1} uploaded`)
  }
  // A Page's posts are public (its composer offers no other audience); a profile's follow the option.
  const asked = AUDIENCE[String(req.options.audience ?? 'public').toLowerCase()] ?? 'EVERYONE'
  if (page && asked !== 'EVERYONE')
    run.warn('A Facebook Page posts publicly: the audience option was left out')
  const audience = page ? 'EVERYONE' : asked
  const op = req.scheduleAt ? 'schedulePost' : 'createPost'
  const placeId = await placeFor(run, actorId, req)
  const created = await api(run).call<unknown>(
    op,
    {
      actorId,
      text: req.caption,
      audience,
      token,
      attachments,
      placeId,
      placeShow: placeId ? 'SHOW_ATTACHMENT' : '',
      ...(req.scheduleAt ? { publishAt: Math.floor(req.scheduleAt.getTime() / 1000) } : {}),
    },
    { write: true, maxTier: 1, key: token, asActor: true },
  )
  // The story's id and address, wherever this version of the answer keeps them.
  const story = findObjects(
    [created],
    (o) => !!(str(o.post_id) || str(o.legacy_story_hideable_id) || str(o.url)),
  )[0]
  const id = str(story?.post_id) || str(story?.legacy_story_hideable_id) || null
  const url = str(story?.url) || (id ? `https://www.facebook.com/${id}` : null)
  const state = req.scheduleAt ? ('scheduled' as const) : ('published' as const)
  if (dry) return { remoteId: 'dry-run', url: null, state }
  run.step(
    req.scheduleAt
      ? `Scheduled on Facebook for ${req.scheduleAt.toISOString()}`
      : `Posted${audience === 'SELF' ? ' (only me)' : ''}`,
  )
  return { remoteId: id ?? `pending:${Date.now()}`, url, state }
}

/**
 * The story id facebook.com's delete takes for a post of `actorId`: base64 of `S:_I<actor>:<post>:<post>` (as its
 * own feed answers carry it). Takes a post id, a `<page>_<post>` id (Business Suite's form) or a story id.
 */
export function storyIdOf(actorId: string, remoteId: string): string {
  if (/^UzpfS[A-Za-z0-9+/]+={0,2}$/.test(remoteId)) return remoteId
  const post = /^(?:\d+_)?(\d+)$/.exec(remoteId)?.[1]
  if (!post) throw new Error(`Not a Facebook post id: ${remoteId}`)
  return Buffer.from(`S:_I${actorId}:${post}:${post}`).toString('base64')
}

export const facebookApi: Driver = {
  id: 'facebook',
  kind: 'api',
  template: 'facebook',
  name: 'Facebook',
  platforms: ['facebook'],
  signIn: {
    url: 'https://www.facebook.com/login/',
    method: 'password',
    cookieDomains: ['facebook.com'],
  },
  capabilities: (_platform, account) =>
    account?.platformIds.kind === 'page' ? pageCapabilities : capabilities,

  /**
   * Writes as a Page go the way facebook.com sends them after switching to it: the `i_user` cookie names the
   * Page, and `av` / `__user` are its profile id (recorded with the request aborted, Nov 2026).
   */
  actorSite(account, base) {
    if (account.platformIds.kind !== 'page') return null
    const id = account.platformIds.actorId || account.externalId
    return { site: `${base}-p${id}`, cookies: [{ name: 'i_user', value: id }] }
  },

  async looksSignedIn(context) {
    return (
      !!(await cookie(context, 'https://www.facebook.com', 'c_user')) &&
      !!(await cookie(context, 'https://www.facebook.com', 'xs')) &&
      !context.pages().some((p) => /\/login|\/checkpoint\//.test(p.url()))
    )
  },

  /** The login's own profile and every Page it can act as. */
  async discover(run) {
    const me = await api(run).call<Profile>('me', {}, { maxTier: 1 })
    if (!me?.id) throw new NeedsLogin('Facebook did not recognise the sign-in.')
    const pages = (await api(run).call<Profile[]>('profiles', {}, { maxTier: 1 })) ?? []
    const login = { name: me.name || 'Facebook profile', avatarUrl: me.picture ?? null }
    const out: DiscoveredAccount[] = [
      {
        platform: 'facebook',
        externalId: me.id,
        name: me.name || 'Facebook profile',
        handle: '',
        avatarUrl: me.picture ?? null,
        profileUrl: `https://www.facebook.com/profile.php?id=${me.id}`,
        platformIds: { actorId: me.id, kind: 'profile' },
        capabilities,
        login,
      },
    ]
    for (const p of pages) {
      if (!p.id || p.id === me.id) continue
      // The Page's classic id, which Business Suite knows it by: how the two connectors' Pages are told apart.
      const classic =
        p.delegatePageId ??
        (await api(run)
          .call<string>('pageId', { profileId: p.id }, { maxTier: 1 })
          .then((v) => (typeof v === 'string' && /^\d{5,30}$/.test(v) ? v : undefined))
          .catch(() => undefined))
      out.push({
        platform: 'facebook',
        externalId: p.id,
        name: p.name || 'Facebook Page',
        handle: '',
        avatarUrl: p.picture ?? null,
        profileUrl: `https://www.facebook.com/profile.php?id=${p.id}`,
        platformIds: {
          actorId: p.id,
          kind: 'page',
          loginId: me.id,
          ...(classic ? { pageId: String(classic) } : {}),
        },
        capabilities: pageCapabilities,
        via: null,
        linkedTo: null,
        login,
      })
    }
    return out
  },

  async check(run, account) {
    try {
      const me = await api(run).call<Profile>('me', {}, { maxTier: 1 })
      if (!me?.id) return { ok: false, reason: 'Facebook signed Greenlit out. Reconnect to sign in again.' }
      if (account.platformIds.kind === 'profile')
        return me.id === account.externalId
          ? { ok: true }
          : { ok: false, reason: 'This sign-in is now another Facebook profile.' }
      const pages = (await api(run).call<Profile[]>('profiles', {}, { maxTier: 1 })) ?? []
      return pages.some((p) => p.id === account.externalId)
        ? { ok: true }
        : { ok: false, reason: 'This login can no longer act as this Page.' }
    } catch (err) {
      if (err instanceof NeedsLogin) return { ok: false, reason: err.message }
      throw err
    }
  },

  /** The latest posts of the profile or Page (its timeline), read back for the sync. */
  async list(run, account, opts) {
    const profileId = account.platformIds.actorId || account.externalId
    const posts =
      (await api(run).call<TimelinePost[]>('posts', { profileId, count: 20 }, { maxTier: 1 })) ?? []
    const since = opts.since ? opts.since.getTime() / 1000 : 0
    return posts
      .filter((p) => p.postId && (!since || Number(p.created ?? 0) >= since))
      .map((p) => {
        const reel = /\/reel\//.test(p.url ?? p.mediaUrl ?? '')
        const created = Number(p.created ?? 0)
        return {
          remoteId: String(p.postId),
          url: p.url ?? null,
          placement: (reel ? 'reel' : 'feed') as Placement,
          title: '',
          caption: p.text ?? '',
          thumbnailUrl: p.thumbnail ?? p.image ?? null,
          mediaUrl: p.mediaUrl ?? null,
          state: 'published' as const,
          scheduledAt: null,
          publishedAt: created ? new Date(created * 1000).toISOString() : null,
          stats: null,
        }
      })
  },
  /**
   * Feed posts with pictures or text, and a Page's reels (Business Suite's requests). Reachable for real only once
   * `publish` is switched on (see capabilities).
   */
  async publish(run, account, req) {
    if (req.placement === 'story') return pictureStory(run, account, req)
    if (req.placement !== 'reel' && req.placement !== 'feed')
      throw new ConnectorUnsupported(
        'placement',
        `Facebook ${req.placement}s through facebook.com come later`,
      )
    const out = await (req.placement === 'reel'
      ? reelWithSound(run, account, req)
      : postWithPhotos(run, account, req))
    return commentOn(run, account, req, out)
  },
  async update() {
    throw notYet('update')
  },
  /** Deletes the post on Facebook (its own "Delete post"; a Page's post is deleted outright, not trashed). */
  async remove(run, account, remoteId) {
    // a story Facebook named no post for (`story:<id>`; `photo:<id>` before Nov 2026)
    if (/^(story|photo):/.test(remoteId))
      throw new ConnectorUnsupported(
        'remove',
        'Greenlit cannot delete a story: delete it on the Page (it ends by itself after 24 hours)',
      )
    if (remoteId.startsWith('video:'))
      throw new ConnectorUnsupported(
        'remove',
        'Greenlit does not know this reel’s post id on Facebook: delete it on the Page',
      )
    const actorId = account.platformIds.actorId || account.externalId
    const storyId = storyIdOf(actorId, remoteId)
    await api(run).call(
      'deletePost',
      { actorId, storyId },
      { write: true, maxTier: 1, key: `delete:${storyId}:${randomUUID()}`, asActor: true },
    )
    run.step('Deleted on Facebook')
  },
  /** Sounds for a Page's reel, as Business Suite's reel composer finds them (tracks for business use). */
  async searchMusic(run, account, query, placement) {
    const pageId = account.platformIds.pageId
    if (placement !== 'reel' || account.platformIds.kind !== 'page' || !pageId || !query.trim()) return []
    const sounds = await api(run).call<FbSound[]>(
      'musicSearch',
      { pageId, query: query.trim() },
      { maxTier: 1 },
    )
    return (sounds ?? []).flatMap((s) => fbSoundToTrack(s) ?? [])
  },
}

/** The reel just published, read back from the Page's timeline: one made since `since` with this text. */
async function findReel(run: DriverRun, account: DriverAccount, text: string, since: number) {
  const profileId = account.platformIds.actorId || account.externalId
  for (let i = 0; i < FIND_REEL.tries; i++) {
    await new Promise((r) => setTimeout(r, FIND_REEL.waitMs))
    const posts = await api(run)
      .call<TimelinePost[]>('posts', { profileId, count: 10 }, { maxTier: 1 })
      .catch(() => [])
    const hit = (posts ?? []).find(
      (p) =>
        p.postId && Number(p.created ?? 0) * 1000 >= since - 60_000 && (p.text ?? '').trim() === text.trim(),
    )
    if (hit) return { remoteId: String(hit.postId), url: hit.url ?? null }
  }
  return null
}

/** A place from facebook.com's check-in search. */
interface FbPlace {
  placeId?: string | number
  name?: string
  geohub?: boolean
}

/**
 * The post's place, as facebook.com's "Check in" finds it by the place's name (the place with the chosen id, else the
 * exact name, else the first), as the account's actor: its Page id, or '' when Facebook knows no such place or the
 * search fails (the post goes up without it, and Greenlit says so).
 */
async function placeFor(run: DriverRun, actorId: string, req: PublishRequest): Promise<string> {
  const loc = req.location
  if (!loc?.name.trim()) return ''
  if (api(run).dryRun) return '1000000004'
  let places: FbPlace[]
  try {
    places =
      (await api(run).call<FbPlace[]>(
        'placeSearch',
        { actorId, query: loc.name.trim() },
        { maxTier: 1, asActor: true },
      )) ?? []
  } catch (err) {
    run.warn(
      `Facebook's place search failed, so the post went up without a place: ${(err as Error).message.slice(0, 160)}`,
    )
    return ''
  }
  const usable = places.filter((x) => /^\d{5,30}$/.test(String(x?.placeId ?? '')))
  const want = loc.name.trim().toLowerCase()
  const pick =
    usable.find((x) => loc.platformId && String(x.placeId) === loc.platformId) ??
    usable.find((x) => (x.name ?? '').trim().toLowerCase() === want) ??
    usable[0]
  if (!pick) {
    run.warn(`Facebook knows no place called ${loc.name}: the post went up without one`)
    return ''
  }
  run.step(`Place: ${pick.name}`)
  return String(pick.placeId)
}

/**
 * The Graph object a first comment goes under: a Page post is `<page>_<post>`, a reel Facebook named no post for
 * is its video. Null for a post Facebook did not name.
 */
export function commentTargetOf(pageId: string, remoteId: string): string | null {
  const video = /^video:(\d{5,30})$/.exec(remoteId)?.[1]
  if (video) return video
  const post = /^(?:\d+_)?(\d{5,30})$/.exec(remoteId)?.[1]
  return post ? `${pageId}_${post}` : null
}

/**
 * The Page's own token, as Business Suite reads it, in plain requests (no browser): the planner token its settings page
 * embeds for itself (plannerToken), then the Page's token from Graph (pageToken). Kept in memory for the run only.
 */
async function pageTokenOf(run: DriverRun, pageId: string): Promise<string> {
  const a = api(run)
  const planner = await a.call<unknown>('plannerToken', { pageId }, { maxTier: 1 })
  if (typeof planner !== 'string' || !/^EAA/.test(planner))
    throw new Error('Business Suite gave Greenlit no planner token for this Page')
  const page = await a.call<{ token?: string }>('pageToken', { pageId, token: planner }, { maxTier: 1 })
  if (!page?.token) throw new Error('Facebook gave Greenlit no token for this Page')
  return page.token
}

/**
 * The post's first comment, posted as the Page once the post is up, as Business Suite replies to comments: Graph's
 * `POST /<page>_<post>/comments` with the Page's token (pageTokenOf: plain requests, no browser). Facebook publishes
 * a post in the background, so the comment is tried again while Graph says the post does not exist yet (nothing is
 * made then). The post stays up when the comment fails: Greenlit says so.
 */
async function commentOn(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
  out: PublishOutcome,
): Promise<PublishOutcome> {
  const text = (req.firstComment ?? '').trim()
  if (!text || out.state !== 'published') {
    if (text && out.state === 'scheduled')
      run.warn('A scheduled post gets its first comment once it is out: add it on Facebook then')
    return out
  }
  const pageId = account.platformIds.pageId
  if (!pageId) {
    run.warn('A profile’s first comment is not posted yet: add it on Facebook')
    return out
  }
  let token: string
  try {
    // read in a dry run too: it shows the comment can be sent, and sends nothing
    token = await pageTokenOf(run, pageId)
  } catch (err) {
    run.warn(`The post is up, but its first comment was not posted: ${(err as Error).message.slice(0, 200)}`)
    return out
  }
  if (api(run).dryRun) {
    run.step('Would post the first comment as the Page (its token was found)')
    return out
  }
  const target = commentTargetOf(pageId, out.remoteId)
  if (!target) {
    run.warn('Facebook did not name the post, so the first comment was not posted: add it on Facebook')
    return out
  }
  let last = ''
  for (let i = 0; i < COMMENT_RETRY.tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, COMMENT_RETRY.waitMs))
    let made: { id?: string; error?: string } | undefined
    try {
      made = await api(run).call<{ id?: string; error?: string }>(
        'pageComment',
        { target, text: text.slice(0, 8000), token },
        { write: true, maxTier: 1, key: `fb-comment:${out.remoteId}:${i}` },
      )
    } catch (err) {
      last = (err as Error).message
      // only "no such object" (the post still publishing) is worth waiting for: nothing was made
      if (/does not exist|Unsupported post request/i.test(last)) continue
      break
    }
    if (made?.id) {
      run.step(
        i ? `First comment posted (Facebook had the post after ${i + 1} tries)` : 'First comment posted',
      )
      return out
    }
    last = made?.error ?? 'Facebook did not name the comment'
    if (!/does not exist|Unsupported post request/i.test(last)) break
  }
  run.warn(`The post is up, but its first comment was not posted: ${last.slice(0, 200) || 'no answer'}`)
  return out
}

/** How often to try a first comment while Facebook publishes the post in the background (tests shorten it). */
export const COMMENT_RETRY = { tries: 6, waitMs: 5000 }

/**
 * A picture story on a Page, as Business Suite's story composer makes it, as the Page: the picture goes up (uploadPhoto,
 * as the Page) and createStory shares it to the Facebook story only (the composer's default also shares to the linked
 * Instagram account, which is left out). A story has no caption; a video story is not set yet. Once Facebook has the
 * story a failure is never retried: a retry would make a second one.
 */
export async function pictureStory(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  const pageId = account.platformIds.pageId
  if (account.platformIds.kind !== 'page' || !pageId)
    throw new ConnectorUnsupported('placement', 'Facebook stories are for a Page: this is a profile')
  if (req.scheduleAt)
    throw new ConnectorUnsupported(
      'scheduleAt',
      'A Facebook story goes out now; Greenlit publishes it at its time',
    )
  const files = req.files.filter((f) => f.kind === 'image' || f.kind === 'video')
  if (files.length !== 1) throw new ConnectorUnsupported('placement', 'A story is one picture or one video')
  const picture = files[0]!
  if (picture.kind === 'video') return videoStory(run, pageId, picture.path)
  if (req.caption.trim()) run.warn('A story has no caption on Facebook: the text was left out')
  if (req.music)
    run.warn(`Facebook story sounds are not set yet: the story went up without ${req.music.title}`)
  if (req.location) run.warn('The location is not added to a Facebook story yet')
  if (req.firstComment.trim()) run.warn('A story has no comments: the first comment was left out')
  const a = api(run)
  const dry = a.dryRun
  const actorId = account.platformIds.actorId || account.externalId
  const attempt = `fb-story-${randomUUID()}`
  const up = await a.call<{ photoID?: string }>(
    'uploadPhoto',
    { actorId, path: picture.path, filename: 'story.jpg', uploadId: 'jsc_c_1' },
    { write: true, maxTier: 1, timeoutMs: 5 * 60_000, key: `${attempt}:photo`, asActor: true },
  )
  const photoId = up?.photoID ? String(up.photoID) : dry ? '1000000003' : null
  if (!photoId) throw new Error('Facebook did not take the picture')
  if (!dry) run.step('Picture sent to Facebook')
  let created: unknown
  try {
    created = await a.call<unknown>(
      'createStory',
      { pageId, identities: [pageId], photoId },
      { write: true, maxTier: 1, key: `${attempt}:create` },
    )
  } catch (err) {
    throw Object.assign(
      new Error(
        `Facebook's answer to the story's Share was not read (${(err as Error).message}). Check the Page before publishing again: the story may be there.`,
      ),
      { retriable: false },
    )
  }
  if (dry) return { remoteId: 'dry-run', url: null, state: 'published' }
  const found = findObjects(
    [created],
    (o) => !!(str(o.post_id) || str(o.legacy_story_hideable_id) || str(o.url)),
  )[0]
  const id = str(found?.post_id) || str(found?.legacy_story_hideable_id) || null
  run.step(`Facebook story ${id ?? photoId}`)
  return {
    remoteId: id ?? `story:${photoId}`,
    url: str(found?.url) || `https://www.facebook.com/${pageId}`,
    state: 'published',
  }
}

/**
 * A video story on a Page, as Business Suite's story composer makes it: the video goes up (uploadPageVideo), is
 * encoded (encodeVideo: no post), then createVideoStory shares it to the Facebook story only. Once Facebook has the
 * story a failure is never retried.
 */
async function videoStory(run: DriverRun, pageId: string, path: string): Promise<PublishOutcome> {
  const info = await probe(path)
  if (!info.durationSec) throw new Error('The video has no length Greenlit could read')
  if (info.durationSec > STORY_VIDEO_MAX_SECONDS)
    throw new ConnectorUnsupported(
      'placement',
      `A Facebook video story is at most ${STORY_VIDEO_MAX_SECONDS} seconds long`,
    )
  const a = api(run)
  const dry = a.dryRun
  const waterfallId = randomUUID()
  const attempt = `fb-story-${waterfallId}`
  const videoId = await uploadPageVideo(run, pageId, path, waterfallId, attempt)
  await a.call('encodeVideo', { pageId, videoId }, { write: true, maxTier: 1, key: `${attempt}:encode` })
  let created: unknown
  try {
    created = await a.call<unknown>(
      'createVideoStory',
      { pageId, identities: [pageId], videoId },
      { write: true, maxTier: 1, key: `${attempt}:create` },
    )
  } catch (err) {
    throw Object.assign(
      new Error(
        `Facebook's answer to the story's Share was not read (${(err as Error).message}). Check the Page before publishing again: the story may be there.`,
      ),
      { retriable: false },
    )
  }
  if (dry) return { remoteId: 'dry-run', url: null, state: 'published' }
  const found = findObjects(
    [created],
    (o) => !!(str(o.post_id) || str(o.legacy_story_hideable_id) || str(o.url)),
  )[0]
  const id = str(found?.post_id) || str(found?.legacy_story_hideable_id) || null
  run.step(`Facebook video story ${id ?? videoId}`)
  return {
    remoteId: id ?? `story:${videoId}`,
    url: str(found?.url) || `https://www.facebook.com/${pageId}`,
    state: 'published',
  }
}

/** The longest video a Page's story takes in Business Suite's composer. */
const STORY_VIDEO_MAX_SECONDS = 60

/** How long to look for a reel just published on the Page's timeline, and how often (tests shorten it). */
export const FIND_REEL = { tries: 6, waitMs: 5000 }

/**
 * A video sent to Facebook as Business Suite's composers send one, as the Page: videoUploadStart (its size; it
 * answers the video's id and an upload session), videoUploadBytes (the file in one piece to Facebook's upload
 * service) and videoUploadReceive (the service's handle). An upload makes no post. Returns the video's id.
 */
async function uploadPageVideo(
  run: DriverRun,
  pageId: string,
  path: string,
  waterfallId: string,
  attempt: string,
): Promise<string> {
  const a = api(run)
  const dry = a.dryRun
  const { size } = await stat(path)
  const up = await a.call<{ videoId?: string; sessionId?: string; endOffset?: number | string }>(
    'videoUploadStart',
    { pageId, waterfallId, size: String(size) },
    { write: true, maxTier: 1, key: `${attempt}:start` },
  )
  const videoId = up?.videoId ? String(up.videoId) : dry ? '1000000000' : null
  const sessionId = up?.sessionId ? String(up.sessionId) : dry ? '1000000001' : null
  if (!videoId || !sessionId) throw new Error('Facebook did not start the video upload')
  const bytes = await a.call<{ handle?: string }>(
    'videoUploadBytes',
    {
      entityName: randomBytes(16).toString('hex'),
      filename:
        basename(path)
          .replace(/[^\w.-]/g, '_')
          .slice(0, 80) || 'video.mp4',
      size: String(size),
      waterfallId,
      endOffset: String(up?.endOffset ?? size),
      sessionId,
      videoId,
      path,
    },
    { write: true, maxTier: 1, key: `${attempt}:bytes`, timeoutMs: 30 * 60_000 },
  )
  if (!dry && !bytes?.handle) throw new Error('Facebook’s upload service did not take the video')
  await a.call(
    'videoUploadReceive',
    { pageId, waterfallId, videoId, size: String(size), handle: bytes?.handle ?? 'dry-run' },
    { write: true, maxTier: 1, key: `${attempt}:receive` },
  )
  if (!dry) run.step('Video sent to Facebook')
  return videoId
}

/**
 * A Page's reel, made as Business Suite's reel composer makes it, as the Page (`av` its classic id, the login's
 * session): the video goes up in three steps (videoUploadStart → videoUploadBytes to Facebook's upload service →
 * videoUploadReceive), its first frame as the cover (uploadPhoto, as the Page), then createReel publishes it to
 * Facebook only, with the edits Facebook renders itself: the sound (where in the track it starts, how long it
 * plays) and both volumes. Without a sound the reel keeps its own audio, at its volume. Once Facebook has the
 * reel, a failure is never retried: a retry would make a second one.
 */
export async function reelWithSound(
  run: DriverRun,
  account: DriverAccount,
  req: PublishRequest,
): Promise<PublishOutcome> {
  const pageId = account.platformIds.pageId
  if (account.platformIds.kind !== 'page' || !pageId)
    throw new ConnectorUnsupported(
      'placement',
      'Reels go to a Facebook Page (reconnect it if it has no Page id)',
    )
  if (req.scheduleAt)
    throw new ConnectorUnsupported(
      'scheduleAt',
      'Facebook reels through Business Suite’s requests go out now; schedule them by publishing at the time',
    )
  const video = req.files.find((f) => f.kind === 'video')
  if (!video || req.files.length !== 1) throw new ConnectorUnsupported('placement', 'A reel is one video')
  const info = await probe(video.path)
  if (!info.durationSec || !info.width || !info.height)
    throw new Error('The video has no length or size Greenlit could read')
  if (req.music && !/^\d{5,30}$/.test(req.music.trackId))
    throw new Error('This sound is not one of Facebook’s: choose it again')

  const a = api(run)
  const dry = a.dryRun
  const actorId = account.platformIds.actorId || account.externalId
  const started = Date.now()
  const waterfallId = randomUUID()
  const attempt = `fb-reel-${waterfallId}`
  const videoId = await uploadPageVideo(run, pageId, video.path, waterfallId, attempt)

  // The cover, as the composer uploads it: the post's own (a frame Greenlit took, or a picture from the library),
  // else the video's first frame.
  const own = req.thumbnailPath && existsSync(req.thumbnailPath) ? req.thumbnailPath : null
  const frame = dry || own ? null : await firstFrame(run, video.path, attempt, 'facebook')
  let coverId = '1000000002'
  try {
    const cover = await a.call<{ photoID?: string }>(
      'uploadPhoto',
      { actorId, path: own ?? frame ?? video.path, filename: 'cover.jpg', uploadId: 'jsc_c_1' },
      { write: true, maxTier: 1, timeoutMs: 5 * 60_000, key: `${attempt}:cover`, asActor: true },
    )
    if (cover?.photoID) coverId = String(cover.photoID)
    else if (!dry) throw new Error('Facebook did not take the reel’s cover')
  } finally {
    if (frame) await rm(frame, { force: true })
  }

  const seconds = Math.max(1, Math.floor(info.durationSec))
  const music = req.music
  const placeId = await placeFor(run, actorId, req)
  const args = {
    pageId,
    identities: [pageId],
    text: req.caption,
    placeId,
    videoId,
    lengthMs: Math.round(info.durationSec * 1000),
    coverId,
    seconds,
    width: info.width,
    height: info.height,
    // Facebook's composer moves a sound's start by whole seconds.
    ...(music
      ? { music: { id: music.trackId, offset: Math.round(music.startAt ?? 0), duration: seconds } }
      : {}),
    musicVolume: req.audio.music,
    originalVolume: req.audio.original,
  }
  let created: unknown
  try {
    created = await a.call<unknown>('createReel', args, { write: true, maxTier: 1, key: `${attempt}:create` })
  } catch (err) {
    throw Object.assign(
      new Error(
        `Facebook's answer to the reel's Share was not read (${(err as Error).message}). Check the Page before publishing again: the reel may be there.`,
      ),
      { retriable: false },
    )
  }
  if (dry) return { remoteId: 'dry-run', url: null, state: 'published' }
  // The post's id and address, wherever this version of the answer keeps them; else read back from the timeline.
  const story = findObjects(
    [created],
    (o) => !!(str(o.post_id) || str(o.legacy_story_hideable_id) || str(o.url)),
  )[0]
  let remoteId = str(story?.post_id) || str(story?.legacy_story_hideable_id) || null
  let url = str(story?.url) || null
  if (!remoteId) {
    const found = await findReel(run, account, req.caption, started)
    remoteId = found?.remoteId ?? null
    url = url ?? found?.url ?? null
  }
  url = url ?? `https://www.facebook.com/reel/${videoId}`
  if (!remoteId) run.warn('Facebook named no post id for the reel: Greenlit links to it but cannot delete it')
  run.step(`Facebook reel ${videoId}${music ? `, with the sound ${music.title}` : ''}`)
  return { remoteId: remoteId ?? `video:${videoId}`, url, state: 'published' }
}
