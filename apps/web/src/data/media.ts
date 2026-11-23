import type { Media, MediaFormat, MediaListQuery, UpdateMediaInput } from '@greenlit/shared'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { upload } from '@/lib/uploads'

/**
 * Shared media data: every feature that lists or opens media uses these hooks, so caches and live updates stay in one
 * place. (A feature's own endpoints stay in its folder.)
 */
export type MediaQuery = Partial<Omit<MediaListQuery, 'cursor'>>
type Page = { items: Media[]; nextCursor: string | null; total?: number }

export function useMediaList(query: MediaQuery, opts: { enabled?: boolean } = {}) {
  useLiveQuery(query.projectId ? `project:${query.projectId}` : 'library', [qk.media()])
  return useInfiniteQuery({
    queryKey: qk.media(query),
    queryFn: ({ pageParam, signal }) =>
      api.get<Page>('/media', { ...(query as Record<string, string>), cursor: pageParam ?? undefined, limit: query.limit ?? 120 }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export function useMediaItem(id: string | null | undefined) {
  useLiveQuery(id ? `media:${id}` : null, [qk.mediaItem(id ?? ''), qk.comments('media', id ?? '')])
  return useQuery({
    queryKey: qk.mediaItem(id ?? ''),
    queryFn: () => api.get<Media>(`/media/${id}`),
    enabled: !!id,
  })
}

export function useUpdateMedia(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateMediaInput) => api.patch<Media>(`/media/${id}`, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.mediaItem(id) })
      const prev = qc.getQueryData<Media>(qk.mediaItem(id))
      if (prev) qc.setQueryData(qk.mediaItem(id), { ...prev, ...patch })
      return { prev }
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(qk.mediaItem(id), ctx.prev),
    onSuccess: (m) => qc.setQueryData(qk.mediaItem(id), m),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.media() }),
  })
}

export type BulkAction =
  | { action: 'trash' | 'restore' | 'purge' }
  | { action: 'move'; projectId: string | null }
  | { action: 'tag' | 'untag'; tags: string[] }
  | { action: 'status'; status: Media['status'] }
  | { action: 'hide' | 'unhide'; userIds: string[] }

export function useBulkMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, ...rest }: { ids: string[] } & BulkAction) => api.post<{ count: number }>('/media/bulk', { ids, ...rest }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.media() })
      void qc.invalidateQueries({ queryKey: qk.projects })
    },
  })
}

/** The format to show by default: the primary one, else the first. */
export function primaryFormat(m: Pick<Media, 'formats'>): MediaFormat | undefined {
  return m.formats.find((f) => f.isPrimary) ?? m.formats[0]
}

export function formatByKey(m: Pick<Media, 'formats'>, key: string | null | undefined) {
  return (key && m.formats.find((f) => f.key === key)) || primaryFormat(m)
}

/** Sprite sheet layout for hover-scrubbing (next to sprite.jpg). */
export interface SpriteInfo {
  cols: number
  rows: number
  count: number
  interval: number
  w: number
  h: number
}
const spriteCache = new Map<string, Promise<SpriteInfo | null>>()
export function loadSprite(spriteUrl: string): Promise<SpriteInfo | null> {
  const url = spriteUrl.replace(/sprite\.jpg(\?.*)?$/, 'sprite.json$1')
  let p = spriteCache.get(url)
  if (!p) {
    p = fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<SpriteInfo>) : null))
      .catch(() => null)
    spriteCache.set(url, p)
  }
  return p
}

/**
 * Uploads files as new media (in a project), or as a format / new file version of an existing item.
 * Resolves to the created media ids.
 */
export async function uploadMedia(
  files: File[],
  target: { projectId?: string | null; mediaId?: string; formatKey?: string; label?: string; tags?: string[] } = {},
) {
  const results = await Promise.allSettled(
    files.map((file) => upload(file, { purpose: 'media.upload', target, label: file.name })),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? [(r.value as { mediaId: string }).mediaId] : []))
}
