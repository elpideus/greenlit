import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'
import { projects } from '../projects/schema.ts'

export const media = pgTable(
  'media',
  {
    id: pk(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    origin: text('origin').notNull().default('upload'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    hiddenFrom: uuid('hidden_from').array().notNull().default(sql`'{}'::uuid[]`),
    /**
     * The item's versions in order (the same video with Italian or English text...), `key` '' being the main one.
     * Empty while the item has a single version. Each version's files are formats with that `version` key.
     */
    versions: jsonb('versions').$type<{ key: string; label: string }[]>().notNull().default([]),
    /** title + notes + tags, lower case without accents, for search. */
    searchText: text('search_text').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('media_project').on(t.projectId),
    index('media_created').on(t.createdAt),
    index('media_tags').using('gin', t.tags),
    index('media_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

/**
 * The renditions of a media item: main, vertical, square... each with its own file history. A row belongs to one of
 * the item's versions (`version`, '' = the main one), or is one of its extra audio tracks (`role` 'audio', shared by
 * every version: a voice-over in another language, a mix without music...).
 */
export const mediaFormats = pgTable(
  'media_formats',
  {
    id: pk(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** 'format' = a picture/video of a version; 'audio' = an audio track that can replace the video's sound. */
    role: text('role').notNull().default('format'),
    /** The version the format belongs to ('' = the main version). Audio tracks keep ''. */
    version: text('version').notNull().default(''),
    /** The main format of its version (the main version's one is the item's thumbnail). */
    isPrimary: boolean('is_primary').notNull().default(false),
    position: integer('position').notNull().default(0),
    blobId: uuid('blob_id').notNull(),
    fileRevision: integer('file_revision').notNull().default(1),
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    duration: real('duration'),
    fps: real('fps'),
    hasAudio: boolean('has_audio').notNull().default(false),
    processingState: text('processing_state').notNull().default('pending'),
    processingProgress: real('processing_progress').notNull().default(0),
    processingError: text('processing_error'),
    /** Names of the derived files that exist for the blob (thumb.webp, preview.mp4...). */
    derived: text('derived').array().notNull().default(sql`'{}'::text[]`),
    meta: jsonb('meta').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('media_formats_key').on(t.mediaId, t.role, t.version, t.key),
    index('media_formats_blob').on(t.blobId),
  ],
)

/** Every file a format has ever had (file versions). */
export const mediaFiles = pgTable(
  'media_files',
  {
    id: pk(),
    mediaId: uuid('media_id').notNull(),
    formatId: uuid('format_id').notNull(),
    blobId: uuid('blob_id').notNull(),
    fileRevision: integer('file_revision').notNull(),
    filename: text('filename').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('media_files_format').on(t.formatId),
    index('media_files_blob').on(t.blobId),
    index('media_files_media').on(t.mediaId),
  ],
)
