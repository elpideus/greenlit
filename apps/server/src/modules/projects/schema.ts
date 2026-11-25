import type { WebLink } from '@greenlit/shared'
import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'

export const projects = pgTable(
  'projects',
  {
    id: pk(),
    /** 'project' or 'brand' (a brand kit). */
    kind: text('kind').notNull().default('project'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Web addresses kept with the project, in order (see cleanWebLinks). */
    webLinks: jsonb('web_links').$type<WebLink[]>().notNull().default([]),
    color: text('color'),
    coverMediaId: uuid('cover_media_id'),
    /** Reviewers who must not see this project or anything in it. */
    hiddenFrom: uuid('hidden_from').array().notNull().default(sql`'{}'::uuid[]`),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('projects_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`)],
)
