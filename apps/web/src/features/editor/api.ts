import type { Asset, Composition, Op, OutputFormat } from '@greenlit/composition'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

/** An editing project as the API returns it. */
export interface CompositionView {
  id: string
  projectId: string | null
  name: string
  revision: number
  document: Composition
  outputMediaId: string | null
  posterUrl: string | null
  createdBy: { id: string; displayName: string; avatarUrl: string | null } | null
  createdAt: string
  updatedAt: string
}

export type FormatPreset = 'landscape' | 'vertical' | 'square' | 'portrait'

export const PRESETS: { id: FormatPreset; format: OutputFormat; label: string }[] = [
  { id: 'landscape', format: { id: 'main', name: '16:9', width: 1920, height: 1080 }, label: 'Landscape' },
  { id: 'vertical', format: { id: 'vertical', name: '9:16', width: 1080, height: 1920 }, label: 'Vertical' },
  { id: 'square', format: { id: 'square', name: '1:1', width: 1080, height: 1080 }, label: 'Square' },
  { id: 'portrait', format: { id: 'portrait', name: '4:5', width: 1080, height: 1350 }, label: 'Portrait' },
]

export function useCompositions(projectId?: string | null) {
  useLiveQuery(
    projectId ? `project:${projectId}` : null,
    [qk.compositions(projectId ?? undefined)],
    ['composition.created', 'composition.updated', 'composition.deleted'],
  )
  return useQuery({
    queryKey: qk.compositions(projectId ?? undefined),
    queryFn: () => api.get<CompositionView[]>('/compositions', { projectId: projectId ?? undefined }),
  })
}

export function useCompositionMeta(id: string | undefined) {
  return useQuery({
    queryKey: qk.composition(id ?? ''),
    queryFn: () => api.get<CompositionView>(`/compositions/${id}`),
    enabled: !!id,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
}

export function useCompositionActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['compositions'] })
  return {
    create: useMutation({
      mutationFn: (body: {
        projectId: string | null
        name: string
        formats?: (FormatPreset | OutputFormat)[]
        fps?: number
        duration?: number
      }) => api.post<CompositionView>('/compositions', body),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api.patch<CompositionView>(`/compositions/${id}`, { name }),
      onSuccess: refresh,
    }),
    duplicate: useMutation({
      mutationFn: (id: string) => api.post<CompositionView>(`/compositions/${id}/duplicate`),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/compositions/${id}`),
      onSuccess: refresh,
    }),
  }
}

export const compositionApi = {
  get: (id: string) => api.get<CompositionView>(`/compositions/${id}`),
  apply: (id: string, ops: Op[], baseRevision: number, clientId: string) =>
    api.post<{ revision: number }>(`/compositions/${id}/ops`, { ops, baseRevision, clientId }),
  since: (id: string, since: number) =>
    api.get<{ revision: number; ops: Op[]; clientId: string | null }[]>(`/compositions/${id}/ops`, { since }),
  assets: (id: string, media: { mediaId: string; formatKey?: string }[]) =>
    api.post<Asset[]>(`/compositions/${id}/assets`, { media }),
  render: (id: string, formats: string[]) =>
    api.post<{ taskId: string | null }>(`/compositions/${id}/render`, { formats }),
  autoReframe: (id: string, clipId: string, formatId: string, axis: 'x' | 'y' | 'both' = 'x') =>
    api.post<{ revision: number; samples: number }>(`/compositions/${id}/clips/${clipId}/auto-reframe`, {
      formatId,
      axis,
    }),
  frameUrl: (id: string, t: number, formatId?: string) =>
    api.url(`/compositions/${id}/frame.jpg`, { t, format: formatId }),
}
