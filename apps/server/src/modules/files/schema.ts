import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk } from '../../core/schema.ts'

/**
 * Every stored file. Files never change once written: a "new version" of something is a new blob, so old
 * versions stay restorable for as long as a revision points at them.
 */
export const blobs = pgTable(
  'blobs',
  {
    id: pk(),
    sha256: text('sha256'),
    size: bigint('size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    /** hot | archiving | archived | restoring */
    state: text('state').notNull().default('hot'),
    /** Relative to the data folder. */
    path: text('path').notNull(),
    archiveStrategy: text('archive_strategy'),
    archivedPath: text('archived_path'),
    archivedSize: bigint('archived_size', { mode: 'number' }),
    archivedMime: text('archived_mime'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Who owns the blob: media | attachment | avatar | render... (for storage statistics). */
    usage: text('usage').notNull().default('media'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('blobs_sha').on(t.sha256),
    index('blobs_state').on(t.state),
    index('blobs_usage').on(t.usage),
  ],
)
