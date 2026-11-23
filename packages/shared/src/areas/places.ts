import { z } from 'zod'
import { Id } from '../common.ts'

export const PlaceRef = z.object({
  id: Id,
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
})
export type PlaceRef = z.infer<typeof PlaceRef>

export const Place = PlaceRef.extend({
  address: z.string(),
  kind: z.string().nullable(),
  country: z.string().nullable(),
  source: z.enum(['osm', 'manual', 'exif']),
  sourceId: z.string().nullable(),
  usage: z.number().int(),
})
export type Place = z.infer<typeof Place>

export const PlaceInput = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).default(''),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  kind: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  source: z.enum(['osm', 'manual', 'exif']).default('manual'),
  sourceId: z.string().nullable().default(null),
})
export type PlaceInput = z.infer<typeof PlaceInput>

export const GeocodeResult = z.object({
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  kind: z.string().nullable(),
  country: z.string().nullable(),
  sourceId: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
})
export type GeocodeResult = z.infer<typeof GeocodeResult>

export const MapPoint = z.object({
  type: z.enum(['project', 'media']),
  id: Id,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  projectId: Id.nullable(),
  place: PlaceRef,
})
export type MapPoint = z.infer<typeof MapPoint>
