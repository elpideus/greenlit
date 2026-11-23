import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk } from '../../core/schema.ts'

/** Single-use links: opening one signs the assigned person in (limited to the item) and burns the link. */
export const shareLinks = pgTable(
  'share_links',
  {
    id: pk(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('share_links_token').on(t.tokenHash), index('share_links_target').on(t.targetId)],
)
