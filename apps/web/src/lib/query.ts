import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false
        return count < 2
      },
    },
    mutations: { retry: false },
  },
})

/**
 * Query keys. One namespace per area so realtime events can invalidate a whole area
 * (`['media']` refreshes every media list and item).
 */
export const qk = {
  config: ['config'] as const,
  me: ['me'] as const,
  users: ['users'] as const,
  directory: ['users', 'directory'] as const,
  media: (q?: unknown) => (q === undefined ? (['media'] as const) : (['media', 'list', q] as const)),
  mediaItem: (id: string) => ['media', 'item', id] as const,
  slidePages: (id: string) => ['media', 'slides', id] as const,
  mediaFiles: (id: string) => ['media', 'files', id] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  tags: ['tags'] as const,
  allTags: ['tags', 'all'] as const,
  comments: (type: string, id: string) => ['comments', type, id] as const,
  reviews: (q?: unknown) => ['reviews', q ?? 'all'] as const,
  inbox: ['reviews', 'inbox'] as const,
  history: (type: string, id: string) => ['history', type, id] as const,
  links: (type: string, id: string) => ['links', type, id] as const,
  notifications: ['notifications'] as const,
  tasks: ['tasks'] as const,
  /** The Activity page (its own root: the popup refetches `tasks` on every progress report). */
  taskHistory: (q?: unknown) => ['taskHistory', q ?? 'all'] as const,
  places: ['places'] as const,
  mapPoints: ['places', 'map'] as const,
  compositions: (projectId?: string) => ['compositions', projectId ?? 'all'] as const,
  composition: (id: string) => ['compositions', 'item', id] as const,
  posts: (q?: unknown) => ['posts', q ?? 'all'] as const,
  post: (id: string) => ['posts', 'item', id] as const,
  calendar: (from: string, to: string) => ['calendar', from, to] as const,
  accounts: ['connectors', 'accounts'] as const,
  platforms: ['connectors', 'platforms'] as const,
  storage: ['storage'] as const,
  shareLinks: ['share-links'] as const,
  tokens: ['tokens'] as const,
  settings: ['settings'] as const,
}
