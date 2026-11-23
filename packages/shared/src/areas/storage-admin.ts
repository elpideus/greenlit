import { z } from 'zod'
import { ArchivePolicy, ArchiveStrategy, StorageStats } from './storage.ts'

/** One file handled by an archive run. */
export const ArchiveRunItem = z.object({
  blobId: z.string(),
  filename: z.string(),
  kind: z.string(),
  strategy: ArchiveStrategy,
  /** archived | skipped | failed */
  outcome: z.enum(['archived', 'skipped', 'failed']),
  before: z.number(),
  after: z.number().nullable(),
  note: z.string().nullable(),
})
export type ArchiveRunItem = z.infer<typeof ArchiveRunItem>

/** Summary of the last archive pass (kept in a setting). */
export const ArchiveRun = z.object({
  at: z.string(),
  finishedAt: z.string(),
  trigger: z.enum(['schedule', 'manual', 'file']),
  candidates: z.number(),
  archived: z.number(),
  skipped: z.number(),
  errors: z.number(),
  savedBytes: z.number(),
  durationMs: z.number(),
  /** The run stopped before every candidate was done (time budget); the rest follow next night. */
  stoppedEarly: z.boolean(),
  items: z.array(ArchiveRunItem),
})
export type ArchiveRun = z.infer<typeof ArchiveRun>

/** Summary of the last orphan clean-up. */
export const GcReport = z.object({
  at: z.string(),
  dryRun: z.boolean(),
  removedBlobs: z.number(),
  removedFiles: z.number(),
  freedBytes: z.number(),
  /** Unreferenced blobs younger than the grace period (kept for now). */
  keptRecent: z.number(),
  /** Blobs of a kind nobody claims to track (kept). */
  keptUnknownUsage: z.number(),
  blobs: z.array(z.object({ id: z.string(), filename: z.string(), usage: z.string(), bytes: z.number() })),
})
export type GcReport = z.infer<typeof GcReport>

/** Which encoders this server has (missing ones fall back to lossless zstd). */
export const StorageTools = z.object({
  zstd: z.boolean(),
  av1: z.boolean(),
  jxl: z.boolean(),
  flac: z.boolean(),
})
export type StorageTools = z.infer<typeof StorageTools>

/** Everything the Storage settings page shows. */
export const StorageOverview = StorageStats.extend({
  /** Bytes on disk per blob usage (media, attachment, render…), hot + archived. */
  usage: z.array(z.object({ usage: z.string(), bytes: z.number(), count: z.number() })),
  /** Unfinished uploads and scratch files. */
  temporary: z.number(),
  archivedCount: z.number(),
  lastRun: ArchiveRun.nullable(),
  lastGc: GcReport.nullable(),
  tools: StorageTools,
  policy: ArchivePolicy,
  /** The archive task currently queued or running, if any. */
  running: z.object({ taskId: z.string(), progress: z.number(), message: z.string() }).nullable(),
  /** When the next nightly pass starts (ISO), null when archival is off. */
  nextRunAt: z.string().nullable(),
  timeZone: z.string(),
})
export type StorageOverview = z.infer<typeof StorageOverview>

export const ArchivePolicyPatch = z.object({
  enabled: z.boolean().optional(),
  afterDays: z.number().int().min(7).max(3650).optional(),
  runAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .optional(),
  strategies: z
    .object({
      video: ArchiveStrategy.optional(),
      image: ArchiveStrategy.optional(),
      audio: ArchiveStrategy.optional(),
      document: ArchiveStrategy.optional(),
      other: ArchiveStrategy.optional(),
    })
    .optional(),
  keepPreviews: z.boolean().optional(),
  skipScheduled: z.boolean().optional(),
})
export type ArchivePolicyPatch = z.infer<typeof ArchivePolicyPatch>

export const StorageJobStarted = z.object({ taskId: z.string().nullable(), alreadyRunning: z.boolean() })
export type StorageJobStarted = z.infer<typeof StorageJobStarted>

export const RestoreResult = z.object({ state: z.enum(['hot', 'restoring']), taskId: z.string().nullable() })
export type RestoreResult = z.infer<typeof RestoreResult>
