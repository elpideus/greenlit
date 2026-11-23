import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'
import { projects } from '../projects/schema.ts'

/** Editing projects: a composition document edited live by people and Claude, exported to media. */
export const compositions = pgTable(
  'compositions',
  {
    id: pk(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    document: jsonb('document').notNull(),
    revision: integer('revision').notNull().default(0),
    /** The media item renders go to (each output format becomes one of its formats). */
    outputMediaId: uuid('output_media_id'),
    posterRevision: integer('poster_revision'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('compositions_project').on(t.projectId)],
)

/** Every batch of edits, in order: lets clients catch up and shows who (or what) changed what. */
export const compositionOps = pgTable(
  'composition_ops',
  {
    id: pk(),
    compositionId: uuid('composition_id')
      .notNull()
      .references(() => compositions.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    ops: jsonb('ops').notNull(),
    authorId: uuid('author_id'),
    source: text('source').notNull(),
    clientId: text('client_id'),
    createdAt: createdAt(),
  },
  (t) => [index('composition_ops_rev').on(t.compositionId, t.revision)],
)
