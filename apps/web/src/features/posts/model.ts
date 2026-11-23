import { composeCaption, getPlacement, type PlacementKey, type PlacementSpec } from '@greenlit/platforms'
import type { Account, Placement, Platform, Post, PostTarget, SavePostInput } from '@greenlit/shared'

/** The composer's working copy of a post: what PATCH /posts/{id} takes. Targets keep their ids. */
export type Draft = Pick<Post, 'name' | 'caption' | 'title' | 'hashtags' | 'translations'> & {
  projectId: string | null
  media: { mediaId: string }[]
  targets: DraftTarget[]
}
export type DraftTarget = Pick<
  PostTarget,
  | 'accountId'
  | 'placement'
  | 'enabled'
  | 'title'
  | 'caption'
  | 'hashtags'
  | 'tags'
  | 'firstComment'
  | 'location'
  | 'thumbnail'
  | 'translations'
  | 'music'
  | 'audio'
  | 'options'
  | 'formats'
  | 'versions'
  | 'audioTracks'
  | 'scheduleAt'
> & { id?: string; key: string }

export const targetKey = (accountId: string, placement: string) => `${accountId}:${placement}`

export function draftFromPost(p: Post): Draft {
  return {
    projectId: p.projectId,
    name: p.name,
    caption: p.caption,
    title: p.title,
    hashtags: p.hashtags,
    translations: p.translations,
    media: p.media.map((m) => ({ mediaId: m.mediaId })),
    targets: p.targets.map((t) => ({
      id: t.id,
      key: targetKey(t.accountId, t.placement),
      accountId: t.accountId,
      placement: t.placement,
      enabled: t.enabled,
      title: t.title,
      caption: t.caption,
      hashtags: t.hashtags,
      tags: t.tags,
      firstComment: t.firstComment,
      location: t.location,
      thumbnail: t.thumbnail,
      translations: t.translations,
      music: t.music,
      audio: t.audio,
      options: t.options,
      formats: t.formats,
      versions: t.versions,
      audioTracks: t.audioTracks,
      scheduleAt: t.scheduleAt,
    })),
  }
}

export function newTarget(accountId: string, placement: Placement): DraftTarget {
  return {
    key: targetKey(accountId, placement),
    accountId,
    placement,
    enabled: true,
    title: null,
    caption: null,
    hashtags: null,
    tags: [],
    firstComment: '',
    location: null,
    thumbnail: { mode: 'auto' },
    translations: {},
    music: null,
    audio: { original: 1, music: 1 },
    options: {},
    formats: {},
    versions: {},
    audioTracks: {},
    scheduleAt: null,
  }
}

export function inputFromDraft(d: Draft): SavePostInput {
  return {
    projectId: d.projectId,
    name: d.name,
    caption: d.caption,
    title: d.title,
    hashtags: d.hashtags,
    translations: d.translations,
    media: d.media,
    targets: d.targets.map(({ key: _k, ...t }) => t),
  }
}

export function specOf(platform: Platform, placement: string): PlacementSpec | undefined {
  return getPlacement(platform, placement)
}

export function placementKey(platform: Platform, placement: string) {
  return `${platform}.${placement}` as PlacementKey
}

/** The caption a target will publish (its own or the post's, plus the hashtags not already in it). */
export function finalCaption(
  d: Pick<Draft, 'caption' | 'hashtags'>,
  t: Pick<DraftTarget, 'caption' | 'hashtags'>,
) {
  return composeCaption(t.caption ?? d.caption, t.hashtags ?? d.hashtags)
}

/** Accounts a post can go to: connected (not off), not merged into another, publishing allowed. */
export function publishableAccounts(accounts: Account[] | undefined) {
  return (accounts ?? []).filter((a) => !a.mergedInto && a.state !== 'disabled')
}

export const PLATFORM_ORDER: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube']

export function sortTargets<T extends { accountId: string; placement: string }>(
  ts: T[],
  accounts: Account[],
) {
  const pos = (t: T) => {
    const a = accounts.find((x) => x.id === t.accountId)
    return (
      (a ? PLATFORM_ORDER.indexOf(a.platform) : 9) * 100 +
      (a?.capabilities.placements.indexOf(t.placement as never) ?? 0)
    )
  }
  return [...ts].sort((a, b) => pos(a) - pos(b))
}

/** States in which a version lives on its platform (edits are pushed there). */
export const onPlatform = (t: Pick<PostTarget, 'state'>) => t.state === 'scheduled' || t.state === 'published'

// ── platform options ────────────────────────────────────────────────────────────────────

export interface OptionDef {
  key: string
  kind: 'toggle' | 'select'
  /** Default shown when the target has no value. */
  fallback: unknown
  values?: string[]
  placements: PlacementKey[]
  /** Only for some accounts (e.g. Facebook profiles, not Pages). */
  when?: (ctx: { account: Account | undefined; target: DraftTarget }) => boolean
}

/** The switches each placement takes; drivers read them from `target.options`. */
export const OPTIONS: OptionDef[] = [
  {
    key: 'privacy',
    kind: 'select',
    fallback: 'public',
    values: ['public', 'unlisted', 'private'],
    placements: ['youtube.video', 'youtube.short'],
  },
  {
    key: 'privacy',
    kind: 'select',
    fallback: 'public',
    values: ['public', 'friends', 'private'],
    placements: ['tiktok.video', 'tiktok.photo'],
  },
  {
    key: 'audience',
    kind: 'select',
    fallback: 'public',
    values: ['public', 'friends', 'only_me'],
    placements: ['facebook.feed', 'facebook.reel'],
    // A Page always posts publicly.
    when: ({ account }) => !!account && !account.handle && account.signIn.name === account.name,
  },
  {
    key: 'allowComments',
    kind: 'toggle',
    fallback: true,
    placements: [
      'instagram.feed',
      'instagram.reel',
      'facebook.feed',
      'facebook.reel',
      'tiktok.video',
      'tiktok.photo',
      'youtube.video',
      'youtube.short',
    ],
  },
  { key: 'allowDuet', kind: 'toggle', fallback: true, placements: ['tiktok.video'] },
  { key: 'allowStitch', kind: 'toggle', fallback: true, placements: ['tiktok.video'] },
  { key: 'shareToFeed', kind: 'toggle', fallback: true, placements: ['instagram.reel'] },
  { key: 'madeForKids', kind: 'toggle', fallback: false, placements: ['youtube.video', 'youtube.short'] },
  {
    key: 'category',
    kind: 'select',
    fallback: '',
    values: [
      '',
      'Film & Animation',
      'Autos & Vehicles',
      'Music',
      'Pets & Animals',
      'Sports',
      'Travel & Events',
      'Gaming',
      'People & Blogs',
      'Comedy',
      'Entertainment',
      'News & Politics',
      'Howto & Style',
      'Education',
      'Science & Technology',
      'Nonprofits & Activism',
    ],
    placements: ['youtube.video', 'youtube.short'],
  },
  {
    key: 'aiGenerated',
    kind: 'toggle',
    fallback: false,
    placements: [
      'instagram.feed',
      'instagram.reel',
      'facebook.reel',
      'tiktok.video',
      'tiktok.photo',
      'youtube.video',
      'youtube.short',
    ],
  },
  {
    key: 'paidPartnership',
    kind: 'toggle',
    fallback: false,
    placements: ['instagram.feed', 'instagram.reel'],
  },
  { key: 'brandOrganic', kind: 'toggle', fallback: false, placements: ['tiktok.video', 'tiktok.photo'] },
  { key: 'brandedContent', kind: 'toggle', fallback: false, placements: ['tiktok.video', 'tiktok.photo'] },
  {
    key: 'pinFirstComment',
    kind: 'toggle',
    fallback: false,
    placements: ['instagram.feed', 'instagram.reel'],
    when: ({ target }) => !!target.firstComment.trim(),
  },
  { key: 'qualityBoost', kind: 'toggle', fallback: false, placements: ['youtube.video'] },
  {
    key: 'fit',
    kind: 'select',
    fallback: 'auto',
    values: ['auto', 'keep', 'pad', 'crop'],
    placements: [
      'instagram.feed',
      'instagram.reel',
      'instagram.story',
      'facebook.feed',
      'facebook.reel',
      'facebook.story',
      'tiktok.video',
      'tiktok.photo',
      'youtube.video',
      'youtube.short',
    ],
  },
]

export function optionsFor(
  platform: Platform,
  placement: string,
  ctx: { account: Account | undefined; target: DraftTarget },
) {
  const key = placementKey(platform, placement)
  return OPTIONS.filter((o) => o.placements.includes(key) && (!o.when || o.when(ctx)))
}

/** Seconds from now until `iso`, or null. */
export function leadMs(iso: string | null) {
  return iso ? new Date(iso).getTime() - Date.now() : null
}
