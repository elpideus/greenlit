import type { Media } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { formatByKey, type MediaQuery, useMediaList } from '@/data/media'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { BROWSER_IMAGES } from './Stage'

/**
 * What the viewer's previous / next buttons step through: the list it was opened from. `query` is a library or
 * project view (its search, sort, trash), so the viewer walks the very pages the grid loaded; `ids` is a fixed order
 * (a brand kit's files, the review queue). Opened without one (a shared link), it walks the item's project.
 */
export type Browse = { query: MediaQuery } | { ids: string[] }

/** Router state that opens the viewer on a list: `navigate(`/media/${id}`, { state: browseState(browse) })`. */
export const browseState = (browse: Browse) => ({ browse })

function readBrowse(state: unknown): Browse | null {
  const b = (state as { browse?: unknown } | null)?.browse as Browse | undefined
  if (!b || typeof b !== 'object') return null
  if ('ids' in b && Array.isArray(b.ids)) return b
  if ('query' in b && b.query && typeof b.query === 'object') return b
  return null
}

const SAVED = 'viewer.browse'

/**
 * The list the viewer was opened with. It outlives the viewer's own URL changes (?tab=, ?format= replace the entry
 * without router state) and a reload of the tab: the last one is kept for this tab with the item it opened.
 */
function openedWith(mediaId: string, state: unknown): Browse | null {
  const given = readBrowse(state)
  try {
    if (given) sessionStorage.setItem(SAVED, JSON.stringify({ mediaId, browse: given }))
    else {
      const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? 'null') as { mediaId?: string } | null
      if (saved?.mediaId === mediaId) return readBrowse(saved)
    }
  } catch {
    // storage unavailable: the list lasts while the viewer is open
  }
  return given
}

/** The item the viewer last stepped to, for the grid to bring into view when it shows again. */
let stepped: string | null = null
export function takeSteppedTo() {
  const id = stepped
  stepped = null
  return id
}

export interface Neighbors {
  prev: string | null
  next: string | null
  /** 1-based place in the list and its length, when known. */
  position: number | null
  total: number | null
  go: (id: string) => void
}

/** Pages the viewer may load to find the open item in its list (the grid loads 120 at a time). */
const MAX_PAGES = 10

/** The items before and after the open one in the list it was opened from; null when there is no list to walk. */
export function useNeighbors(mediaId: string, media: Media | undefined, enabled = true): Neighbors | null {
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  // Read once: the viewer is a fresh one per item (MediaPage keys it), and `go` hands the list to the next.
  const [given] = useState(() => (enabled ? openedWith(mediaId, location.state) : null))
  const projectId = media ? (media.projectId ?? '') : null
  const browse = useMemo<Browse | null>(
    () =>
      given ??
      (projectId === null
        ? null
        : // the same query as the project page or the library grid, so their cached pages serve here too
          { query: projectId ? { sort: 'recent', projectId } : { sort: 'recent', projectKind: 'project' } }),
    [given, projectId],
  )
  const query = browse && 'query' in browse ? browse.query : null
  const list = useMediaList(query ?? {}, { enabled: enabled && !!query })
  const pages = list.data?.pages
  const ids = useMemo(
    () => (browse && 'ids' in browse ? browse.ids : (pages?.flatMap((p) => p.items.map((m) => m.id)) ?? [])),
    [browse, pages],
  )
  const index = media ? ids.indexOf(mediaId) : -1

  // The grid may have loaded only the first pages: load on until the item is found, and one page ahead at its end.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    if (!query || !hasNextPage || isFetchingNextPage) return
    if ((index === -1 && (pages?.length ?? 0) < MAX_PAGES) || (index >= 0 && index >= ids.length - 2))
      void fetchNextPage()
  }, [query, hasNextPage, isFetchingNextPage, fetchNextPage, index, ids.length, pages?.length])

  const prev = index > 0 ? ids[index - 1]! : null
  const next = index >= 0 && index < ids.length - 1 ? ids[index + 1]! : null

  // Fetch the neighbours and their picture now, so a step shows them at once.
  useEffect(() => {
    if (!enabled) return
    for (const nid of [next, prev]) {
      if (!nid) continue
      void qc
        .prefetchQuery({
          queryKey: qk.mediaItem(nid),
          queryFn: () => api.get<Media>(`/media/${nid}`),
          staleTime: 30_000,
        })
        .then(() => {
          const m = qc.getQueryData<Media>(qk.mediaItem(nid))
          const f = m ? formatByKey(m, null) : undefined
          const src =
            f?.kind === 'image' && BROWSER_IMAGES.includes(f.mime)
              ? f.urls.original
              : (f?.urls.poster ?? f?.urls.thumbnail)
          if (src) new Image().src = src
        })
    }
  }, [enabled, next, prev, qc])

  const go = useCallback(
    (to: string) => {
      stepped = to
      // In place of the open item, so Back still returns to the grid; the list goes along.
      navigate(`/media/${to}`, { replace: true, state: browse ? browseState(browse) : null })
    },
    [navigate, browse],
  )

  if (!enabled || !browse || index === -1 || ids.length < 2) return null
  const total = query ? (pages?.[0]?.total ?? (hasNextPage ? null : ids.length)) : ids.length
  return { prev, next, position: index + 1, total, go }
}
