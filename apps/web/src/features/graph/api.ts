import type { EntityRef, Lineage, ProductionGraph } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useLiveQuery } from '@/lib/realtime'

export const graphKey = (q: { projectId?: string | null; brandKits?: boolean }) =>
  ['graph', q.projectId ?? 'all', q.brandKits ? 'brand' : 'work'] as const
export const lineageKey = (ref: EntityRef) => ['graph', 'lineage', ref.type, ref.id] as const

/** Every item of the projects (or one) and the links between them. */
export function useGraph(q: { projectId?: string | null; brandKits?: boolean }) {
  useLiveQuery('library', [['graph']])
  return useQuery({
    queryKey: graphKey(q),
    queryFn: () =>
      api.get<ProductionGraph>('/graph', {
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.brandKits ? { brandKits: 'true' } : {}),
      }),
    staleTime: 60_000,
  })
}

/** One item's place in the process: what it was made from and what was made with it. */
export function useLineage(ref: EntityRef | null) {
  useLiveQuery(ref ? `${ref.type}:${ref.id}` : null, ref ? [lineageKey(ref)] : [], ['links.updated'])
  return useQuery({
    queryKey: ref ? lineageKey(ref) : ['graph', 'lineage', 'none'],
    queryFn: () => api.get<Lineage>('/graph/lineage', { type: ref!.type, id: ref!.id }),
    enabled: !!ref,
    staleTime: 30_000,
  })
}
