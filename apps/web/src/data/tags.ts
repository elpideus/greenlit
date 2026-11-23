import type { TagCount } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'

/** Tags in use with their counts, for autocomplete and filters. */
export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: () => api.get<TagCount[]>('/tags'), staleTime: 60_000 })
}
