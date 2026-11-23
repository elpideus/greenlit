import type { DesignFont, DesignInfo, FigcraftStatus, MediaFormat } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useLiveQuery } from '@/lib/realtime'

export const designKeys = {
  status: ['figcraft', 'status'] as const,
  fonts: ['figcraft', 'fonts'] as const,
  info: (mediaId: string, formatId: string, rev: number) =>
    ['media', 'design', mediaId, formatId, rev] as const,
}

/** Whether the FigCraft browser build is installed (the server fetches it on its first start). */
export function useFigcraftStatus() {
  return useQuery({
    queryKey: designKeys.status,
    queryFn: () => api.get<FigcraftStatus>('/figcraft/status'),
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.state === 'installing' ? 3000 : false),
  })
}

/** Pages, frames and fonts of a design file (read by the server when the file was uploaded). */
export function useDesignInfo(mediaId: string, format: MediaFormat | undefined) {
  const ready = format?.processing.state === 'ready'
  return useQuery({
    queryKey: designKeys.info(mediaId, format?.id ?? '', format?.fileRevision ?? 0),
    queryFn: () => api.get<DesignInfo | null>(`/media/${mediaId}/design`, { formatId: format!.id }),
    enabled: !!format && ready,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useDesignFonts() {
  useLiveQuery('library', [designKeys.fonts], ['figcraft.fonts'])
  return useQuery({
    queryKey: designKeys.fonts,
    queryFn: () => api.get<DesignFont[]>('/figcraft/fonts'),
    staleTime: 5 * 60_000,
  })
}

/** Greenlit's fonts of these families, as FigCraft's text.loadFont takes them. */
export async function fetchFonts(fonts: DesignFont[], families: string[]) {
  const wanted = new Set(families.map((f) => f.toLowerCase()))
  const files = fonts.filter((f) => wanted.has(f.family.toLowerCase()))
  return Promise.all(
    files.map(async (f) => {
      const res = await fetch(f.url, { credentials: 'include' })
      if (!res.ok) throw new Error(`Could not load the font ${f.filename}`)
      return { font: f, bytes: await res.arrayBuffer() }
    }),
  )
}

export function exportFrames(
  mediaId: string,
  body: { formatId?: string; frames: number[]; format: 'png' | 'jpg' | 'pdf'; scale: number },
) {
  return api.post<{ mediaIds: string[] }>(`/media/${mediaId}/design/export`, body)
}

export function deleteFont(id: string) {
  return api.delete(`/figcraft/fonts/${id}`)
}
