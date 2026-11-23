import {
  type Media,
  type MediaFormat,
  type MediaListQuery,
  type UpdateMediaInput,
  versionFormats,
} from '@greenlit/shared'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
      api.get<Page>(
        '/media',
        { ...(query as Record<string, string>), cursor: pageParam ?? undefined, limit: query.limit ?? 120 },
        signal,
      ),
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
    mutationFn: ({ ids, ...rest }: { ids: string[] } & BulkAction) =>
      api.post<{ count: number }>('/media/bulk', { ids, ...rest }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.media() })
      void qc.invalidateQueries({ queryKey: qk.projects })
    },
  })
}

/** The format to show by default: the primary one, else the first (of the main version, or of `version`). */
export function primaryFormat(m: WithFormats, version?: string | null): MediaFormat | undefined {
  const fs = formatsOfVersion(m, version)
  return fs.find((f) => f.isPrimary) ?? fs[0]
}

/** A format of the main version (or of `version`) by key; the version's main format when it has none. */
export function formatByKey(m: WithFormats, key: string | null | undefined, version?: string | null) {
  return (key && formatsOfVersion(m, version).find((f) => f.key === key)) || primaryFormat(m, version)
}

type WithFormats = Pick<Media, 'formats'> & { versions?: Media['versions'] }
const formatsOfVersion = (m: WithFormats, version?: string | null) =>
  version && m.versions ? versionFormats({ formats: m.formats, versions: m.versions }, version) : m.formats

/** The label of a version ('' = the main one). */
export function versionLabel(m: Pick<Media, 'versions'>, version: string | null | undefined) {
  return m.versions.find((v) => v.key === (version ?? ''))?.label ?? ''
}

/** A URL-safe key for a new version or audio track: from its name, never `main`, never one already taken. */
export function keyFor(name: string, taken: Iterable<string>, fallback: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || fallback
  const used = new Set(taken)
  used.add('main')
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}-${i}`
  return key
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
 * Uploads files as new media (in a project), or into an existing item: a format (of the main version or of
 * `version`, created as `versionLabel` when new), a new file for one, or an audio track (`audio`).
 * Resolves to the created media ids.
 */
export async function uploadMedia(
  files: File[],
  target: {
    projectId?: string | null
    mediaId?: string
    formatKey?: string
    label?: string
    tags?: string[]
    version?: string
    versionLabel?: string
    mainVersionLabel?: string
    audio?: boolean
  } = {},
) {
  const results = await Promise.allSettled(
    files.map((file) => upload(file, { purpose: 'media.upload', target, label: file.name })),
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? [(r.value as { mediaId: string }).mediaId] : []))
}
