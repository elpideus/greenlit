import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/** Helpers every module schema uses so tables look alike. */
export const pk = () => uuid('id').primaryKey().default(sql`uuidv7()`)
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/** Key/value settings; each key is owned and validated by the module that defined it. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
})

/**
 * Version history for anything versioned (media, projects, posts, compositions...).
 * `data` is a full snapshot, so any revision can be restored on its own.
 */
export const revisions = pgTable(
  'revisions',
  {
    id: pk(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    seq: integer('seq').notNull(),
    authorId: uuid('author_id'),
    source: text('source').notNull().default('web'),
    changed: text('changed').array().notNull().default(sql`'{}'::text[]`),
    summary: text('summary').notNull().default(''),
    name: text('name'),
    note: text('note'),
    data: jsonb('data').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('revisions_entity_seq').on(t.entityType, t.entityId, t.seq),
    index('revisions_author').on(t.authorId),
  ],
)

/** Long-running work the UI can show (processing, renders, publishing, archival). */
export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    message: text('message').notNull().default(''),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    createdBy: uuid('created_by'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_entity').on(t.entityType, t.entityId), index('tasks_state').on(t.state)],
)
