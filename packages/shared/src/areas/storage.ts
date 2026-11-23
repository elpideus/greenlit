import { z } from 'zod'

/**
 * How cold media is packed. Every file is archived on its own (one archive per file), so a single
 * file can be downloaded, restored or deleted without unpacking anything else.
 */
export const ArchiveStrategy = z.enum([
  /** zstd, byte-exact; small savings on already-compressed video, big on raw/ProRes/WAV/PSD */
  'lossless',
  /** AV1 (SVT-AV1) re-encode at a visually lossless quality; typically 60–90% smaller */
  'av1',
  /** JPEG XL lossless transcoding: ~20% smaller and the original JPEG can be rebuilt bit for bit */
  'jxl',
  /** FLAC for uncompressed audio (byte-exact samples) */
  'flac',
  'none',
])
export type ArchiveStrategy = z.infer<typeof ArchiveStrategy>

export const ArchivePolicy = z.object({
  enabled: z.boolean().default(true),
  afterDays: z.number().int().min(7).max(3650).default(183),
  /** Time of day (platform time zone) for the nightly pass. */
  runAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('03:30'),
  strategies: z
    .object({
      video: ArchiveStrategy.default('av1'),
      image: ArchiveStrategy.default('jxl'),
      audio: ArchiveStrategy.default('flac'),
      document: ArchiveStrategy.default('lossless'),
      design: ArchiveStrategy.default('lossless'),
      other: ArchiveStrategy.default('lossless'),
    })
    .default({
      video: 'av1',
      image: 'jxl',
      audio: 'flac',
      document: 'lossless',
      design: 'lossless',
      other: 'lossless',
    }),
  /** Keep editing proxies of archived videos so they still play in the browser. */
  keepPreviews: z.boolean().default(true),
  /** Media used by a post scheduled in the future is never archived. */
  skipScheduled: z.boolean().default(true),
})
export type ArchivePolicy = z.infer<typeof ArchivePolicy>

export const StorageStats = z.object({
  disk: z.object({ total: z.number(), free: z.number(), path: z.string() }),
  originals: z.object({ hot: z.number(), archived: z.number(), archivedOriginalSize: z.number() }),
  derived: z.number(),
  attachments: z.number(),
  byKind: z.array(z.object({ kind: z.string(), bytes: z.number(), count: z.number() })),
  archiveCandidates: z.object({ count: z.number(), bytes: z.number() }),
  lastRun: z
    .object({ at: z.string(), archived: z.number(), savedBytes: z.number(), errors: z.number() })
    .nullable(),
})
export type StorageStats = z.infer<typeof StorageStats>
