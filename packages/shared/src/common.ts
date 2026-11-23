import { z } from 'zod'

export const Id = z.uuid()
export type Id = z.infer<typeof Id>

export const IsoDate = z.iso.datetime({ offset: true })

/** Where a change came from. Stored on every revision so history can say "changed by Claude via MCP". */
export const ChangeSource = z.enum(['web', 'api', 'mcp', 'sync', 'system', 'share'])
export type ChangeSource = z.infer<typeof ChangeSource>

export const Paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional(),
  })

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(60),
})

export const UserRef = z.object({
  id: Id,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
})
export type UserRef = z.infer<typeof UserRef>

/** A point inside a picture or video frame, normalised to 0..1 of the frame size. */
export const FramePoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type FramePoint = z.infer<typeof FramePoint>

export const MediaKind = z.enum(['video', 'image', 'audio', 'document', 'other'])
export type MediaKind = z.infer<typeof MediaKind>

export function mediaKindFromMime(mime: string): MediaKind {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime.includes('document') ||
    mime.includes('presentation') ||
    mime.includes('spreadsheet')
  )
    return 'document'
  return 'other'
}

export function formatBytes(bytes: number, locale = 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

/** 00:00:12:05 style timecode (frames after the last colon). */
export function formatTimecode(seconds: number, fps = 30): string {
  const totalFrames = Math.round(seconds * fps)
  const f = totalFrames % Math.round(fps)
  const s = Math.floor(totalFrames / Math.round(fps))
  return `${formatDuration(s)}:${String(f).padStart(2, '0')}`
}
