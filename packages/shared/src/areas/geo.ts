import { z } from 'zod'
import { Id } from '../common.ts'
import { GeocodeResult, MapPoint, Place, PlaceInput } from './places.ts'

/**
 * API contracts of the places module beyond the base types in ./places.ts: assignment, combined search,
 * map points with the extra fields the map card shows, and camera hints per kind of place.
 */

/** Normalised kind of a place, from OpenStreetMap's many tags. Drives the zoom the map flies to. */
export const PlaceKind = z.enum([
  'country',
  'region',
  'city',
  'district',
  'street',
  'address',
  'poi',
  'other',
])
export type PlaceKind = z.infer<typeof PlaceKind>

/** A comfortable zoom level for each kind of place when there is no bounding box to fit. */
export const zoomForKind: Record<PlaceKind, number> = {
  country: 4.6,
  region: 7.2,
  city: 11.8,
  district: 13.6,
  street: 15.6,
  address: 17,
  poi: 16.6,
  other: 14,
}

export const PlaceEntityType = z.enum(['project', 'media'])
export type PlaceEntityType = z.infer<typeof PlaceEntityType>

export const PlaceUpdateInput = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  kind: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
})
export type PlaceUpdateInput = z.infer<typeof PlaceUpdateInput>

/** Assign an existing place (placeId) or a new one (place, e.g. a geocoding result) to a project or media item. */
export const PlaceAssignInput = z
  .object({
    placeId: Id.optional(),
    place: PlaceInput.optional(),
  })
  .refine((v) => !!v.placeId !== !!v.place, { message: 'Give either placeId or place' })
export type PlaceAssignInput = z.infer<typeof PlaceAssignInput>

export const PlaceSearchResponse = z.object({
  /** Places already used in Greenlit (reuse these first). */
  places: z.array(Place),
  /** Places found on OpenStreetMap that are not in Greenlit yet. */
  geocoded: z.array(GeocodeResult),
})
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponse>

/** A map point with what the map's card and side list show. */
export const MapPointView = MapPoint.extend({
  /** Media kind (video, image…); null for projects. */
  kind: z.string().nullable(),
  projectName: z.string().nullable(),
  /** Project colour (for projects and media inside a coloured project). */
  color: z.string().nullable(),
  /** Projects: how many media items they hold. */
  mediaCount: z.number().int().nullable(),
  placeKind: z.string().nullable(),
})
export type MapPointView = z.infer<typeof MapPointView>

export const MapPointsQuery = z.object({
  /** minLng,minLat,maxLng,maxLat (minLng > maxLng crosses the antimeridian). */
  bbox: z.string().optional(),
  /** Free text matched against titles and place names. */
  q: z.string().optional(),
  type: PlaceEntityType.optional(),
  placeId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(20_000).default(5000),
})
export type MapPointsQuery = z.infer<typeof MapPointsQuery>

/** Parses "minLng,minLat,maxLng,maxLat"; null when missing or malformed. */
export function parseBbox(s: string | undefined | null): [number, number, number, number] | null {
  if (!s) return null
  const parts = s.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number]
  if (minLat > maxLat || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null
  return [minLng, minLat, maxLng, maxLat]
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
