import { sql } from 'drizzle-orm'
import { doublePrecision, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, pk, updatedAt } from '../../core/schema.ts'

/** A named point on Earth (a property, a town, a street…), shared by every project and media item placed there. */
export const places = pgTable(
  'places',
  {
    id: pk(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** Normalised kind: country, region, city, district, street, address, poi, other. */
    kind: text('kind'),
    /** ISO 3166-1 alpha-2 code (IT, FR…). */
    country: text('country'),
    /** osm = picked from geocoding, manual = typed or dropped by hand, exif = from a file's GPS tags. */
    source: text('source').notNull().default('manual'),
    /** OpenStreetMap reference ("osm:R40666") so the same geocoding result is never added twice. */
    sourceId: text('source_id'),
    /** name + address, lower case without accents, for search. */
    searchText: text('search_text').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('places_lat_lng').on(t.lat, t.lng),
    index('places_source_id').on(t.sourceId),
    index('places_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

/** Which projects and media items are at which places (many to many). */
export const placeLinks = pgTable(
  'place_links',
  {
    id: pk(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('place_links_unique').on(t.placeId, t.entityType, t.entityId),
    index('place_links_entity').on(t.entityType, t.entityId),
  ],
)
