import type { Asset, Composition } from '@greenlit/composition'
import type { AssetResolver } from '@greenlit/player'
import type { Media } from '@greenlit/shared'
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { formatByKey } from '@/data/media'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'

/** The library media behind an edit's assets, keyed by media id. */
export function useAssetMedia(doc: Composition | null) {
  const ids = useMemo(
    () => [...new Set(Object.values(doc?.assets ?? {}).map((a) => a.mediaId))].sort(),
    [doc?.assets],
  )
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.mediaItem(id),
      queryFn: () => api.get<Media>(`/media/${id}`),
      staleTime: 60_000,
    })),
  })
  const key = results.map((r) => r.dataUpdatedAt).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when any query updates
  return useMemo(() => {
    const m = new Map<string, Media>()
    for (const r of results) if (r.data) m.set(r.data.id, r.data)
    return m
  }, [key])
}

/** URLs the editor preview plays: the browser-friendly proxy for video, a large still for pictures. */
export function useAssetResolver(doc: Composition | null): AssetResolver & { media: Map<string, Media> } {
  const media = useAssetMedia(doc)
  return useMemo(() => {
    const fmt = (a: Asset) => {
      const m = media.get(a.mediaId)
      return m ? formatByKey(m, a.formatKey) : undefined
    }
    return {
      media,
      src: (a) => {
        const f = fmt(a)
        if (!f) return null
        if (a.kind === 'video') return f.urls.preview ?? f.urls.original
        if (a.kind === 'image') return f.urls.poster ?? f.urls.original
        // Sound too plays from its preview (AAC), as in the viewer: an original WAV can be large and 24-bit, which not
        // every browser plays.
        return f.urls.preview ?? f.urls.original
      },
      poster: (a) => fmt(a)?.urls.poster ?? fmt(a)?.urls.thumbnail ?? null,
    }
  }, [media])
}

export function assetThumb(a: Asset, media: Map<string, Media>) {
  const m = media.get(a.mediaId)
  const f = m ? formatByKey(m, a.formatKey) : undefined
  return {
    thumb: f?.urls.thumbnail ?? null,
    sprite: f?.urls.sprite ?? null,
    waveform: f?.urls.waveform ?? null,
    duration: f?.duration ?? a.duration,
  }
}
