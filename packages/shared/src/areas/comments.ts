import { z } from 'zod'
import { FramePoint, Id, IsoDate, UserRef } from '../common.ts'

export const CommentTargetType = z.enum(['media', 'composition', 'post'])
export type CommentTargetType = z.infer<typeof CommentTargetType>

/** Where on the frame the comment points: a spot, optionally a box and/or a freehand drawing. */
export const CommentPin = z.object({
  point: FramePoint,
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().default(null),
  /** Freehand strokes, each a list of normalised points. */
  strokes: z.array(z.array(FramePoint)).max(50).default([]),
})
export type CommentPin = z.infer<typeof CommentPin>

export const CommentAttachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('media'),
    mediaId: Id,
    formatId: Id.nullable(),
    title: z.string(),
    thumbnailUrl: z.string().nullable(),
    mediaKind: z.string(),
  }),
  z.object({
    kind: z.literal('file'),
    id: Id,
    name: z.string(),
    mime: z.string(),
    size: z.number(),
    url: z.string(),
    thumbnailUrl: z.string().nullable(),
  }),
])
export type CommentAttachment = z.infer<typeof CommentAttachment>

export const Comment = z.object({
  id: Id,
  targetType: CommentTargetType,
  targetId: Id,
  formatId: Id.nullable(),
  parentId: Id.nullable(),
  author: UserRef,
  body: z.string(),
  pin: CommentPin.nullable(),
  /** Seconds into the video when the comment was made. */
  time: z.number().nullable(),
  frame: z.number().int().nullable(),
  /** File revision of the format when the comment was written. */
  fileRevision: z.number().int().nullable(),
  attachments: z.array(CommentAttachment),
  status: z.enum(['open', 'done']),
  resolvedBy: UserRef.nullable(),
  resolvedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  editedAt: IsoDate.nullable(),
  replies: z.array(z.lazy((): z.ZodType => Comment)).optional(),
})
export type Comment = z.infer<typeof Comment> & { replies?: Comment[] }

export const CreateCommentInput = z.object({
  targetType: CommentTargetType,
  targetId: Id,
  formatId: Id.nullable().default(null),
  parentId: Id.nullable().default(null),
  body: z.string().min(1).max(20_000),
  pin: CommentPin.nullable().default(null),
  time: z.number().min(0).nullable().default(null),
  frame: z.number().int().min(0).nullable().default(null),
  attachments: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('media'), mediaId: Id, formatId: Id.nullable().default(null) }),
        /** id of an upload made with purpose "comment.attachment" */
        z.object({ kind: z.literal('file'), id: Id }),
      ]),
    )
    .max(20)
    .default([]),
})
export type CreateCommentInput = z.infer<typeof CreateCommentInput>
