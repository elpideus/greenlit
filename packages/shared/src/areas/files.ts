import { z } from 'zod'
import { Id } from '../common.ts'

/**
 * What an upload is for. The server routes a finished upload to the module that registered the purpose,
 * so new kinds of uploads never touch the upload code itself.
 */
export const UploadPurpose = z.string().regex(/^[a-z][a-z0-9.-]*$/)

export const UploadMetadata = z.object({
  purpose: UploadPurpose,
  filename: z.string(),
  filetype: z.string().default('application/octet-stream'),
  /** JSON string with purpose-specific fields (projectId, mediaId, formatKey...). */
  target: z.string().default('{}'),
})
export type UploadMetadata = z.infer<typeof UploadMetadata>

export const BlobInfo = z.object({
  id: Id,
  sha256: z.string(),
  size: z.number(),
  mime: z.string(),
  state: z.enum(['hot', 'archiving', 'archived', 'restoring']),
})
export type BlobInfo = z.infer<typeof BlobInfo>

export const UploadResult = z.object({
  uploadId: z.string(),
  purpose: z.string(),
  result: z.unknown(),
})

/** Chunk size for resumable uploads; kept below Cloudflare's 100 MB request limit. */
export const UPLOAD_CHUNK_BYTES = 48 * 1024 * 1024
