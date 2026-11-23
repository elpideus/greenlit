import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk } from '../../core/schema.ts'

/** Directed relations between things: raw clip  source_of  final cut, editing project  rendered_to  media... */
export const links = pgTable(
  'links',
  {
    id: pk(),
    fromType: text('from_type').notNull(),
    fromId: uuid('from_id').notNull(),
    relation: text('relation').notNull(),
    toType: text('to_type').notNull(),
    toId: uuid('to_id').notNull(),
    note: text('note').notNull().default(''),
    auto: boolean('auto').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('links_unique').on(t.fromType, t.fromId, t.relation, t.toType, t.toId),
    index('links_from').on(t.fromType, t.fromId),
    index('links_to').on(t.toType, t.toId),
  ],
)
