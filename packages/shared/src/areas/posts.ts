import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'

export const Platform = z.enum(['instagram', 'facebook', 'tiktok', 'youtube'])
export type Platform = z.infer<typeof Platform>

/** Where on the platform the post goes. Platform specs (@greenlit/platforms) say which exist per platform. */
/** A feed post with several media is a carousel. Keys match @greenlit/platforms (platform.placement). */
export const Placement = z.enum(['feed', 'reel', 'story', 'video', 'short', 'photo', 'post'])
export type Placement = z.infer<typeof Placement>

export const MusicChoice = z.object({
  /** The platform's own id for the track (sounds stay linked on the platform). */
  trackId: z.string(),
  title: z.string(),
  artist: z.string().default(''),
  coverUrl: z.string().nullable().default(null),
  previewUrl: z.string().nullable().default(null),
  /** Where in the song to start, seconds. */
  startAt: z.number().min(0).default(0),
  duration: z.number().nullable().default(null),
})
export type MusicChoice = z.infer<typeof MusicChoice>

export const AudioMix = z.object({
  /** 0..1 — volume of the video's own sound on the platform (0 = mute it). */
  original: z.number().min(0).max(1).default(1),
  /** 0..1 — volume of the platform music. */
  music: z.number().min(0).max(1).default(1),
})
export type AudioMix = z.infer<typeof AudioMix>

export const Thumbnail = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  /** A frame of the video at `time` seconds. */
  z.object({ mode: z.literal('frame'), time: z.number().min(0) }),
  /** A picture from the library. */
  z.object({ mode: z.literal('media'), mediaId: Id }),
])
export type Thumbnail = z.infer<typeof Thumbnail>

export const Translation = z.object({ title: z.string().default(''), caption: z.string().default('') })

export const TargetState = z.enum([
  'draft',
  'queued',
  'preparing',
  'uploading',
  'scheduled',
  'published',
  'failed',
  'removed',
])
export type TargetState = z.infer<typeof TargetState>

/** One post on one account: everything can differ per platform (caption, title, cover, music...). */
export const PostTarget = z.object({
  id: Id,
  accountId: Id,
  /** The connector account that published it, when another one merged into `accountId` did (Business Suite). */
  viaAccountId: Id.nullable().default(null),
  platform: Platform,
  placement: Placement,
  enabled: z.boolean(),
  /** null = use the post's caption/title */
  title: z.string().nullable(),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()).nullable(),
  /** YouTube tags */
  tags: z.array(z.string()),
  firstComment: z.string(),
  location: z
    .object({
      name: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      platformId: z.string().nullable(),
    })
    .nullable(),
  thumbnail: Thumbnail,
  translations: z.record(z.string(), Translation),
  music: MusicChoice.nullable(),
  audio: AudioMix,
  /** Platform-specific switches: privacy, allow comments/duet/stitch, made for kids, category, AI label... */
  options: z.record(z.string(), z.unknown()),
  /** Which format of each media item this target uses (format key per media id). */
  formats: z.record(z.string(), z.string()),
  /** Which version of each media item this target uses (version key per media id; missing = the main one). */
  versions: z.record(z.string(), z.string()),
  /** Which audio track replaces each video's own sound (track key per media id; missing = its own sound). */
  audioTracks: z.record(z.string(), z.string()),
  scheduleAt: IsoDate.nullable(),
  state: TargetState,
  remoteId: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  error: z.string().nullable(),
  publishedAt: IsoDate.nullable(),
  syncedAt: IsoDate.nullable(),
  /** Metrics read back from the platform when the connector can. */
  stats: z.record(z.string(), z.number()).nullable(),
  /** What the platform did not apply (e.g. a first comment on a scheduled post). */
  notes: z.array(z.string()).default([]),
})
export type PostTarget = z.infer<typeof PostTarget>

export const PostStatus = z.enum(['draft', 'scheduled', 'publishing', 'published', 'partial', 'failed'])

export const PostMediaFormat = z.object({
  key: z.string(),
  label: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration: z.number().nullable(),
  previewUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
})
export type PostMediaFormat = z.infer<typeof PostMediaFormat>

export const PostMediaItem = z.object({
  mediaId: Id,
  title: z.string(),
  kind: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** The main version's formats. */
  formats: z.array(PostMediaFormat),
  /** Every version (main first) with its formats; empty while the item has one. */
  versions: z.array(z.object({ key: z.string(), label: z.string(), formats: z.array(PostMediaFormat) })),
  /** Audio tracks that can replace the video's own sound. */
  audioTracks: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      duration: z.number().nullable(),
      previewUrl: z.string().nullable(),
    }),
  ),
})

export const Post = z.object({
  id: Id,
  projectId: Id.nullable(),
  name: z.string(),
  caption: z.string(),
  title: z.string(),
  hashtags: z.array(z.string()),
  translations: z.record(z.string(), Translation),
  media: z.array(PostMediaItem),
  targets: z.array(PostTarget),
  status: PostStatus,
  origin: z.enum(['greenlit', 'platform']),
  /** Earliest schedule among targets (for the calendar). */
  scheduleAt: IsoDate.nullable(),
  createdBy: UserRef.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type Post = z.infer<typeof Post>

export const TargetInput = z.object({
  id: Id.optional(),
  accountId: Id,
  placement: Placement,
  enabled: z.boolean().default(true),
  title: z.string().max(5000).nullable().default(null),
  caption: z.string().max(70_000).nullable().default(null),
  hashtags: z.array(z.string()).nullable().default(null),
  tags: z.array(z.string()).default([]),
  firstComment: z.string().max(5000).default(''),
  location: PostTarget.shape.location.default(null),
  thumbnail: Thumbnail.default({ mode: 'auto' }),
  translations: z.record(z.string(), Translation).default({}),
  music: MusicChoice.nullable().default(null),
  audio: AudioMix.default({ original: 1, music: 1 }),
  options: z.record(z.string(), z.unknown()).default({}),
  formats: z.record(z.string(), z.string()).default({}),
  versions: z.record(z.string(), z.string()).default({}),
  audioTracks: z.record(z.string(), z.string()).default({}),
  scheduleAt: z.iso.datetime({ offset: true }).nullable().default(null),
})
export type TargetInput = z.input<typeof TargetInput>

export const SavePostInput = z.object({
  projectId: Id.nullable().optional(),
  name: z.string().max(200).optional(),
  caption: z.string().max(70_000).optional(),
  title: z.string().max(500).optional(),
  hashtags: z.array(z.string()).optional(),
  translations: z.record(z.string(), Translation).optional(),
  media: z
    .array(z.object({ mediaId: Id }))
    .max(20)
    .optional(),
  targets: z.array(TargetInput).optional(),
  versionName: z.string().max(120).optional(),
})
export type SavePostInput = z.input<typeof SavePostInput>

export const CalendarQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  platform: Platform.optional(),
  accountId: Id.optional(),
})

export const CalendarEntry = z.object({
  postId: Id,
  targetId: Id,
  name: z.string(),
  caption: z.string(),
  platform: Platform,
  placement: Placement,
  account: z.object({ id: Id, name: z.string(), avatarUrl: z.string().nullable() }),
  at: IsoDate,
  state: TargetState,
  thumbnailUrl: z.string().nullable(),
  remoteUrl: z.string().nullable(),
})
export type CalendarEntry = z.infer<typeof CalendarEntry>
