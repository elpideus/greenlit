import { z } from 'zod'
import { Id, IsoDate, MediaKind, UserRef } from '../common.ts'
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
  isPrimary: z.boolean(),
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
  createdAt: IsoDate,
})
export type MediaFormat = z.infer<typeof MediaFormat>

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
  formats: z.array(MediaFormat),
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
})

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
