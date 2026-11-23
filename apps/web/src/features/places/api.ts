import type { GeocodeResult, Place, PlaceRef } from '@greenlit/shared'
import type { PlaceSearchResponse } from '@greenlit/shared/areas/geo'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'

export type EntityType = 'project' | 'media'

const linksKey = (type: EntityType, id: string) => [...qk.places, 'links', type, id] as const

export function usePlacesOf(type: EntityType, id: string, initial?: PlaceRef[]) {
  return useQuery({
    queryKey: linksKey(type, id),
    queryFn: () => api.get<PlaceRef[]>(`/places/links/${type}/${id}`),
    initialData: initial,
    staleTime: 15_000,
  })
}

export function usePlaceSearch(q: string) {
  return useQuery({
    queryKey: [...qk.places, 'search', q],
    queryFn: ({ signal }) => api.get<PlaceSearchResponse>('/places/search', { q, limit: 6 }, signal),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
  })
}

/** Places already used in Greenlit (local, fast) — for ⌘K. */
export function useKnownPlaces(q: string) {
  return useQuery({
    queryKey: [...qk.places, 'list', q],
    queryFn: ({ signal }) => api.get<Place[]>('/places', { q, limit: 6 }, signal),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
}

export type AssignTarget = { placeId: string } | { place: GeocodeResult }

function inputOf(t: AssignTarget) {
  if ('placeId' in t) return { placeId: t.placeId }
  const r = t.place
  return {
    place: {
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      kind: r.kind,
      country: r.country,
      source: 'osm' as const,
      sourceId: r.sourceId,
    },
  }
}

export function usePlaceLinks(type: EntityType, id: string) {
  const qc = useQueryClient()
  const refresh = (places: PlaceRef[]) => {
    qc.setQueryData(linksKey(type, id), places)
    void qc.invalidateQueries({ queryKey: qk.mapPoints })
    void qc.invalidateQueries({ queryKey: [...qk.places, 'list'] })
    void qc.invalidateQueries({ queryKey: type === 'media' ? qk.mediaItem(id) : qk.project(id) })
    void qc.invalidateQueries({ queryKey: type === 'media' ? qk.media() : qk.projects })
  }
  const assign = useMutation({
    mutationFn: (t: AssignTarget) => api.post<PlaceRef[]>(`/places/links/${type}/${id}`, inputOf(t)),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (placeId: string) => api.delete<PlaceRef[]>(`/places/links/${type}/${id}/${placeId}`),
    onSuccess: refresh,
  })
  return { assign, remove }
}
