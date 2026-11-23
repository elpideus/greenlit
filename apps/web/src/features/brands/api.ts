import type { BrandKit, BrandSectionType, UpdateBrandKitInput } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { toast } from '@/ui'

export const kitKey = (projectId: string) => ['brands', projectId] as const

export function useKit(projectId: string) {
  useLiveQuery(
    `project:${projectId}`,
    [kitKey(projectId)],
    ['brand.updated', 'media.updated', 'media.deleted', 'project.updated'],
  )
  return useQuery({
    queryKey: kitKey(projectId),
    queryFn: ({ signal }) => api.get<BrandKit>(`/brands/${projectId}`, undefined, signal),
  })
}

export function useKitActions(projectId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: kitKey(projectId) })
    void qc.invalidateQueries({ queryKey: qk.projects })
  }
  const update = useMutation({
    mutationFn: (patch: UpdateBrandKitInput) => api.patch<BrandKit>(`/brands/${projectId}`, patch),
    onMutate: (patch) => {
      const was = qc.getQueryData<BrandKit>(kitKey(projectId))
      if (was)
        qc.setQueryData<BrandKit>(kitKey(projectId), {
          ...was,
          ...(patch.guide !== undefined ? { guide: patch.guide } : {}),
          ...(patch.colors ? { colors: patch.colors } : {}),
        })
      return { was }
    },
    onError: (err, _patch, c) => {
      if (c?.was) qc.setQueryData(kitKey(projectId), c.was)
      toast.error(err)
    },
    onSuccess: (kit) => {
      qc.setQueryData(kitKey(projectId), kit)
      void qc.invalidateQueries({ queryKey: qk.projects })
    },
  })
  const move = async (mediaId: string, section: BrandSectionType, group?: string) => {
    try {
      await api.patch(`/brands/${projectId}/assets/${mediaId}`, { section, group })
      refresh()
    } catch (err) {
      toast.error(err)
    }
  }
  const readColors = async (mediaId: string) => {
    try {
      const kit = await api.post<BrandKit>(`/brands/${projectId}/assets/${mediaId}/colors`, {})
      qc.setQueryData(kitKey(projectId), kit)
      return kit
    } catch (err) {
      toast.error(err)
      return null
    }
  }
  return { update, move, readColors, refresh }
}
