import { z } from 'zod'
import { Id, IsoDate, MediaKind, UserRef } from '../common.ts'
import { DepthInfo, DepthJob, DepthNear } from './depth.ts'
import { PlaceRef } from './places.ts'

export const MediaStatus = z.enum(['draft', 'in_review', 'changes_requested', 'approved'])
export type MediaStatus = z.infer<typeof MediaStatus>

export const ProcessingState = z.enum(['pending', 'processing', 'ready', 'failed'])

/** Well-known format keys. Any other slug is allowed for custom formats. */
export const FORMAT_PRESETS = [
  { key: 'main', label: 'Main', aspect: null },
  { key: 'vertical', label: 'Vertical 9:16', aspect: 9 / 16 },
  { key: 'portrait', label: 'Portrait 4:5', aspect: 4 / 5 },
  { key: 'square', label: 'Square 1:1', aspect: 1 },
  { key: 'landscape', label: 'Landscape 16:9', aspect: 16 / 9 },
] as const

export const FormatKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)

/** One rendition of a media item: the same content in another shape (16:9, 9:16, 1:1...). */
export const MediaFormat = z.object({
  id: Id,
  mediaId: Id,
  key: FormatKey,
  label: z.string(),
  /** The main format of its version. */
  isPrimary: z.boolean(),
  /** The version this format belongs to ('' = the main version; audio tracks too). */
  version: z.string(),
  kind: MediaKind,
  mime: z.string(),
  filename: z.string(),
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration: z.number().nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  /** File version: goes up every time a new file replaces this format's file. */
  fileRevision: z.number().int(),
  processing: z.object({
    state: ProcessingState,
    progress: z.number().min(0).max(1),
    error: z.string().nullable(),
  }),
  urls: z.object({
    original: z.string(),
    download: z.string(),
    thumbnail: z.string().nullable(),
    poster: z.string().nullable(),
    preview: z.string().nullable(),
    sprite: z.string().nullable(),
    waveform: z.string().nullable(),
  }),
  storage: z.enum(['hot', 'archiving', 'archived', 'restoring']),
  /** Depth maps only: which end is near, the file's bit depth and the range its preview shows. */
  depth: DepthInfo.optional(),
  createdAt: IsoDate,
})
export type MediaFormat = z.infer<typeof MediaFormat>

/**
 * One kind of difference between an item's versions, with its choices: Language (Italiano | English), Watermark
 * (With | Without)... Groups combine: each version is one option from every group.
 */
export const MediaVersionGroup = z.object({
  key: z.string(),
  /** What differs ("Language", "Watermark"); '' = unnamed. */
  label: z.string(),
  /** Its options, the main version's first. */
  options: z.array(z.object({ key: z.string(), label: z.string() })),
})
export type MediaVersionGroup = z.infer<typeof MediaVersionGroup>

/**
 * Another version of the same item: the same video with English instead of Italian text, without the watermark...
 * Each version has its own formats; the main version (key '') is the one lists, thumbnails and the editor use.
 */
export const MediaVersion = z.object({
  /** '' = the main version. */
  key: z.string(),
  /** Its options' names ("English · Without watermark"). */
  label: z.string(),
  /** Its option in each of `Media.versionGroups` (group key → option key). */
  values: z.record(z.string(), z.string()),
  /** Its formats, main first (for the main version, the same list as `Media.formats`). */
  formats: z.array(MediaFormat),
})
export type MediaVersion = z.infer<typeof MediaVersion>

export const MediaOrigin = z.enum(['upload', 'render', 'import', 'platform', 'link'])

export const Media = z.object({
  id: Id,
  projectId: Id.nullable(),
  title: z.string(),
  description: z.string(),
  kind: MediaKind,
  status: MediaStatus,
  origin: MediaOrigin,
  tags: z.array(z.string()),
  /** The main version's formats. */
  formats: z.array(MediaFormat),
  /** Every version, the main one first; empty while the item has only one. */
  versions: z.array(MediaVersion),
  /** What tells the versions apart (Language, Watermark...); empty while the item has only one. */
  versionGroups: z.array(MediaVersionGroup),
  /** Extra audio tracks that can replace a video's own sound (voice-over in another language, no music...). */
  audioTracks: z.array(MediaFormat),
  /**
   * Depth maps made elsewhere, one per format of a version: each has the `key` and `version` of the format it
   * describes (see depthMapFor).
   */
  depthMaps: z.array(MediaFormat),
  /** Depth maps Greenlit is making for the item's formats right now. */
  depthJobs: z.array(DepthJob).optional(),
  thumbnailUrl: z.string().nullable(),
  places: z.array(PlaceRef),
  commentCount: z.number().int(),
  openCommentCount: z.number().int(),
  linkCount: z.number().int(),
  takenAt: IsoDate.nullable(),
  createdBy: UserRef.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  deletedAt: IsoDate.nullable(),
  /** Admin only. */
  hiddenFrom: z.array(Id).optional(),
})
export type Media = z.infer<typeof Media>

export const MediaListQuery = z.object({
  projectId: z.string().optional(),
  /**
   * Only media of projects of this kind (`project` includes media outside any project): the library shows `project`
   * so brand kits' files don't fill it. Ignored with `projectId` or a `project:` search token.
   */
  projectKind: z.enum(['project', 'brand']).optional(),
  q: z.string().optional(),
  kind: MediaKind.optional(),
  status: MediaStatus.optional(),
  tag: z.string().optional(),
  trash: z.coerce.boolean().optional(),
  sort: z.enum(['recent', 'oldest', 'title', 'size', 'taken']).default('recent'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(60),
})
export type MediaListQuery = z.infer<typeof MediaListQuery>

export const UpdateMediaInput = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(50_000).optional(),
  tags: z.array(z.string().min(1).max(60)).max(200).optional(),
  status: MediaStatus.optional(),
  projectId: Id.nullable().optional(),
  takenAt: IsoDate.nullable().optional(),
  hiddenFrom: z.array(Id).optional(),
  /** Optional name for the version this change creates. */
  versionName: z.string().max(120).optional(),
})
export type UpdateMediaInput = z.infer<typeof UpdateMediaInput>

export const UpdateFormatInput = z.object({
  key: FormatKey.optional(),
  label: z.string().min(1).max(60).optional(),
  isPrimary: z.literal(true).optional(),
  /** Depth maps: which end of the scale is near the camera. */
  near: DepthNear.optional(),
})

export const UpdateVersionInput = z.object({
  /** Rename it (only while the versions differ in one way; otherwise rename an option of a group). */
  label: z.string().trim().min(1).max(60).optional(),
  /** Make it the main version (the one lists, thumbnails and new posts use). */
  isMain: z.literal(true).optional(),
})
export type UpdateVersionInput = z.infer<typeof UpdateVersionInput>

/** Rename a version group ("Watermark") or one of its options ("Without watermark"). */
export const RenameVersionPartInput = z.object({ label: z.string().trim().max(60) })

/**
 * Upload a file as a new version: like version `from` (default the main one) but with another option in one group,
 * an existing `option` (a combination not uploaded yet) or a new one named `optionLabel`. Without `group`, a new
 * group starts (`groupLabel`), whose first option (`currentLabel`) every existing version gets.
 */
export const NewVersionInput = z.object({
  from: z.string().optional(),
  group: z.string().optional(),
  groupLabel: z.string().trim().max(60).optional(),
  option: z.string().optional(),
  optionLabel: z.string().trim().max(60).optional(),
  currentLabel: z.string().trim().max(60).optional(),
})
export type NewVersionInput = z.infer<typeof NewVersionInput>

/** The formats of one version of an item ('' or an unknown key = the main version). */
export function versionFormats(m: Pick<Media, 'formats' | 'versions'>, version: string | null | undefined) {
  if (!version) return m.formats
  return m.versions.find((v) => v.key === version)?.formats ?? m.formats
}

export function aspectLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null
  const r = width / height
  const known: [number, string][] = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [5 / 4, '5:4'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [3 / 2, '3:2'],
    [2 / 3, '2:3'],
    [21 / 9, '21:9'],
    [1.91, '1.91:1'],
  ]
  for (const [v, label] of known) if (Math.abs(r - v) / v < 0.02) return label
  return r > 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`
}
