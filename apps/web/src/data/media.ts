import {
  isJunkPath,
  kitRoot,
  type Media,
  type MediaFormat,
  type MediaListQuery,
  type NewVersionInput,
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
import { filePath } from '@/lib/dom'
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

/** A Slides item's pages in order, each with all its formats and versions (the viewer and the post composer). */
export function useSlidePages(id: string | null | undefined) {
  useLiveQuery(id ? `media:${id}` : null, [qk.slidePages(id ?? '')])
  return useQuery({
    queryKey: qk.slidePages(id ?? ''),
    queryFn: () => api.get<Media[]>(`/media/${id}/slides`),
    enabled: !!id,
  })
}

/** Replaces Slides items with their pages (a post given a Slides item gets its pages, in order). */
export async function expandSlides(items: Media[]): Promise<Media[]> {
  const out: Media[] = []
  for (const m of items) {
    const pages = m.kind === 'slides' ? await api.get<Media[]>(`/media/${m.id}/slides`) : [m]
    for (const p of pages) if (!out.some((x) => x.id === p.id)) out.push(p)
  }
  return out
}

/**
 * Slides: group pictures and videos as one item (a carousel's pages), change its pages, take it apart. Every change
 * refreshes the lists (pages leave or come back to them).
 */
export function useSlides() {
  const qc = useQueryClient()
  const settle = (m?: Media) => {
    if (m) qc.setQueryData(qk.mediaItem(m.id), m)
    void qc.invalidateQueries({ queryKey: qk.media() })
    void qc.invalidateQueries({ queryKey: qk.projects })
  }
  return {
    create: async (input: { mediaIds: string[]; title?: string; projectId?: string | null }) => {
      const m = await api.post<Media>('/media/slides', input)
      settle(m)
      return m
    },
    set: async (id: string, mediaIds: string[]) => {
      const m = await api.put<Media>(`/media/${id}/slides`, { mediaIds })
      settle(m)
      return m
    },
    ungroup: async (id: string) => {
      const r = await api.delete<{ mediaIds: string[] }>(`/media/${id}/slides`)
      qc.removeQueries({ queryKey: qk.mediaItem(id) })
      settle()
      return r.mediaIds
    },
  }
}

/** The format to show by default: the primary one, else the first (of the main version, or of `version`). */
export function primaryFormat(m: WithFormats, version?: string | null): MediaFormat | undefined {
  const fs = formatsOfVersion(m, version)
  return fs.find((f) => f.isPrimary) ?? fs[0]
}

/** What a file picker offers for another file of an item of this kind (a new version, shape or file version). */
export function acceptForKind(kind: string) {
  if (kind === 'image') return 'image/*'
  if (kind === 'video') return 'video/*'
  if (kind === 'design') return '.figcraft'
  return undefined
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

/** A URL-safe key for a new audio track: from its name, never `main`, never one already taken. */
export { keyFor } from '@greenlit/shared'

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

export type UploadTarget = {
  projectId?: string | null
  mediaId?: string
  formatKey?: string
  label?: string
  tags?: string[]
  /** Into this version of `mediaId`. */
  version?: string
  /** As a new version of `mediaId` (another language, without the watermark...). */
  newVersion?: NewVersionInput
  audio?: boolean
  /** The depth map of format `formatKey` (of `version`). */
  depth?: boolean
  /** New items: the last page of this Slides item (they go into its project). */
  slidesId?: string
}

/**
 * Uploads files as new media (in a project), or into an existing item: a format (of the main version, of
 * `version`, or of a `newVersion`), a new file for one, or an audio track (`audio`). Resolves to the created media
 * ids.
 */
export async function uploadMedia(files: File[], target: UploadTarget = {}) {
  // Files of a dropped folder keep their path (a brand kit sorts them by it), without the folder they all sit in.
  const list = files.filter((f) => !isJunkPath(filePath(f) || f.name))
  const root = kitRoot(list.map(filePath).filter(Boolean))
  const pathOf = (f: File) => {
    const p = filePath(f)
    return p && root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p
  }
  const results = await mapLimit(list, 4, (file) => {
    const path = pathOf(file)
    return upload(file, {
      purpose: 'media.upload',
      target: path ? { ...target, path } : target,
      label: file.name,
    })
  })
  return results.flatMap((r) => (r.status === 'fulfilled' ? [(r.value as { mediaId: string }).mediaId] : []))
}

/** Runs `fn` over `items`, `limit` at a time (a folder of 150 files doesn't open 150 uploads at once). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]!) }
      } catch (reason) {
        out[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return out
}

/** Uploads one file as a new version of an item; resolves to the version's key (null when the upload failed). */
export async function uploadVersion(
  file: File,
  target: UploadTarget & { mediaId: string; newVersion: NewVersionInput },
): Promise<string | null> {
  try {
    const r = (await upload(file, { purpose: 'media.upload', target, label: file.name })) as {
      version?: string
    }
    return r.version ?? null
  } catch {
    return null
  }
}
