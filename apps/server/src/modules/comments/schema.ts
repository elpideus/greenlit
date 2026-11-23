import { bigint, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk } from '../../core/schema.ts'

export const comments = pgTable(
  'comments',
  {
    id: pk(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    formatId: uuid('format_id'),
    parentId: uuid('parent_id'),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    /** { point: {x,y}, region: {x,y,w,h}|null, strokes: [[{x,y}]] } normalised to the frame */
    pin: jsonb('pin'),
    time: real('time'),
    frame: integer('frame'),
    fileRevision: integer('file_revision'),
    status: text('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('comments_target').on(t.targetType, t.targetId), index('comments_parent').on(t.parentId)],
)

/** Files attached to a comment: a library media item, or a file that only lives in the comment. */
export const commentAttachments = pgTable(
  'comment_attachments',
  {
    id: pk(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    mediaId: uuid('media_id'),
    formatId: uuid('format_id'),
    blobId: uuid('blob_id'),
    name: text('name'),
    mime: text('mime'),
    size: bigint('size', { mode: 'number' }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('comment_attachments_comment').on(t.commentId),
    index('comment_attachments_blob').on(t.blobId),
  ],
)
