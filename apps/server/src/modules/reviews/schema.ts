import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk } from '../../core/schema.ts'

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: pk(),
    mediaId: uuid('media_id').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    message: text('message').notNull().default(''),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** open | approved | changes_requested | cancelled */
    status: text('status').notNull().default('open'),
    createdAt: createdAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('review_requests_media').on(t.mediaId), index('review_requests_status').on(t.status)],
)

export const reviewAssignments = pgTable(
  'review_assignments',
  {
    requestId: uuid('request_id')
      .notNull()
      .references(() => reviewRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    decision: text('decision'),
    note: text('note').notNull().default(''),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] }), index('review_assignments_user').on(t.userId)],
)
