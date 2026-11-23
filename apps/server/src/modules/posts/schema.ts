import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'
import { projects } from '../projects/schema.ts'

export const posts = pgTable(
  'posts',
  {
    id: pk(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull().default(''),
    caption: text('caption').notNull().default(''),
    title: text('title').notNull().default(''),
    hashtags: text('hashtags').array().notNull().default(sql`'{}'::text[]`),
    translations: jsonb('translations').notNull().default({}),
    /** greenlit = made here; platform = found on a connected account by the sync */
    origin: text('origin').notNull().default('greenlit'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('posts_project').on(t.projectId)],
)

/**
 * Where a project's posts last went (accounts and placements): a new post in the project starts with them, so a
 * channel or Page is not chosen again for every post. Updated whenever a post's destinations are saved.
 */
export const projectPostDestinations = pgTable('project_post_destinations', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  targets: jsonb('targets').$type<{ accountId: string; placement: string }[]>().notNull().default([]),
  updatedAt: updatedAt(),
})

export const postMedia = pgTable(
  'post_media',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.mediaId] }), index('post_media_media').on(t.mediaId)],
)

export const postTargets = pgTable(
  'post_targets',
  {
    id: pk(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    /** The connector account that published it, when another one merged into `accountId` did (Business Suite). */
    viaAccountId: uuid('via_account_id'),
    platform: text('platform').notNull(),
    placement: text('placement').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    title: text('title'),
    caption: text('caption'),
    hashtags: text('hashtags').array(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    firstComment: text('first_comment').notNull().default(''),
    location: jsonb('location'),
    thumbnail: jsonb('thumbnail').notNull().default({ mode: 'auto' }),
    translations: jsonb('translations').notNull().default({}),
    music: jsonb('music'),
    audio: jsonb('audio').notNull().default({ original: 1, music: 1 }),
    options: jsonb('options').notNull().default({}),
    formats: jsonb('formats').notNull().default({}),
    scheduleAt: timestamp('schedule_at', { withTimezone: true }),
    state: text('state').notNull().default('draft'),
    remoteId: text('remote_id'),
    remoteUrl: text('remote_url'),
    error: text('error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    stats: jsonb('stats'),
    /** What the platform last told us (to tell remote edits from ours). */
    remoteSnapshot: jsonb('remote_snapshot'),
    /** Optimised files made for this target, and the inputs they were made from. */
    preparedBlobIds: uuid('prepared_blob_ids').array().notNull().default(sql`'{}'::uuid[]`),
    preparedKey: text('prepared_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_targets_post').on(t.postId),
    index('post_targets_schedule').on(t.scheduleAt),
    index('post_targets_remote').on(t.accountId, t.remoteId),
  ],
)
