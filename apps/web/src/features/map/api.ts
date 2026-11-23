import type { GeocodeResult, Place, PlaceRef } from '@greenlit/shared'
import type { MapPointView } from '@greenlit/shared/areas/geo'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

export type { MapPointView }

/** One marker on the map: a place and everything you can see there. */
export interface PlaceGroup {
  place: PlaceRef
  placeKind: string | null
  items: MapPointView[]
  projects: MapPointView[]
  media: MapPointView[]
  thumb: string | null
}

export function useMapPoints() {
  useLiveQuery('places', [qk.mapPoints])
  useLiveQuery('library', [qk.mapPoints], ['media.updated', 'media.deleted'])
  return useQuery({
    queryKey: qk.mapPoints,
    queryFn: () => api.get<MapPointView[]>('/map/points'),
    staleTime: 60_000,
  })
}

export function groupByPlace(points: MapPointView[]): PlaceGroup[] {
  const map = new Map<string, PlaceGroup>()
  for (const p of points) {
    let g = map.get(p.place.id)
    if (!g) {
      g = { place: p.place, placeKind: p.placeKind, items: [], projects: [], media: [], thumb: null }
      map.set(p.place.id, g)
    }
    // one entry per item per place
    if (g.items.some((x) => x.type === p.type && x.id === p.id)) continue
    g.items.push(p)
    if (p.type === 'project') g.projects.push(p)
    else g.media.push(p)
  }
  for (const g of map.values()) {
    g.thumb =
      (g.projects.find((x) => x.thumbnailUrl) ?? g.media.find((x) => x.thumbnailUrl))?.thumbnailUrl ?? null
  }
  return [...map.values()]
}

export function usePlace(id: string | null) {
  return useQuery({
    queryKey: [...qk.places, 'item', id],
    queryFn: () => api.get<Place>(`/places/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useGeocode(q: string) {
  return useQuery({
    queryKey: ['geocode', q],
    queryFn: ({ signal }) => api.get<GeocodeResult[]>('/geocode/search', { q, limit: 6 }, signal),
    enabled: q.trim().length >= 3,
    staleTime: 10 * 60_000,
  })
}
