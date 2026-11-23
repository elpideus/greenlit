import type { TagCount } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

/** Tags in use with their counts (the 50 most used), for autocomplete and filters. */
export function useTags() {
  useLiveQuery('library', [qk.tags], ['tags.changed'])
  return useQuery({ queryKey: qk.tags, queryFn: () => api.get<TagCount[]>('/tags'), staleTime: 60_000 })
}

/** Every tag in use with its count, kept live while items are tagged, renamed or deleted anywhere. */
export function useAllTags() {
  useLiveQuery('library', [qk.allTags], ['tags.changed', 'media.created', 'media.updated', 'media.deleted'])
  return useQuery({
    queryKey: qk.allTags,
    queryFn: () => api.get<TagCount[]>('/tags', { limit: 10_000 }),
    staleTime: 30_000,
  })
}
