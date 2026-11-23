import type { BrandColor, BrandFontUse } from '@greenlit/shared'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from '../../core/schema.ts'
import { media } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'

/** What a brand kit says that its files alone don't: one row per project of kind `brand`. */
export const brandKits = pgTable('brand_kits', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** The kit's guide (its README), Markdown. */
  guide: text('guide').notNull().default(''),
  /** Read from the kit's palette files, then edited by hand. */
  colors: jsonb('colors').$type<BrandColor[]>().notNull().default([]),
  /** What each font family is for (display / text), from tokens or CSS files, then edited by hand. */
  fonts: jsonb('fonts').$type<BrandFontUse[]>().notNull().default([]),
  /** The main logo someone chose; null = Greenlit picks one. */
  logoMediaId: uuid('logo_media_id'),
  /** Archives being unpacked into the kit: media id → files done / total. */
  unpacking: jsonb('unpacking')
    .$type<Record<string, { done: number; total: number }>>()
    .notNull()
    .default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Facts Greenlit reads from a kit's file, for the file version they were read from. */
export interface BrandAssetInfo {
  blobId?: string
  font?: {
    family: string
    style: string
    weight: number
    italic: boolean
    variable: boolean
    weightRange: [number, number] | null
  } | null
  /** Transparent artwork: the background it reads on. */
  surface?: 'dark' | 'light' | null
}

/** Where each file of a kit sits. Files without a row are placed by their name the first time the kit is read. */
export const brandAssets = pgTable(
  'brand_assets',
  {
    mediaId: uuid('media_id')
      .primaryKey()
      .references(() => media.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    section: text('section').notNull(),
    group: text('group').notNull().default(''),
    /** Its path inside the folder or archive it was added with. */
    path: text('path').notNull().default(''),
    /** 'auto' = placed by Greenlit; 'user' = moved by someone (never re-sorted). */
    placedBy: text('placed_by').notNull().default('auto'),
    info: jsonb('info').$type<BrandAssetInfo>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('brand_assets_project').on(t.projectId)],
)
