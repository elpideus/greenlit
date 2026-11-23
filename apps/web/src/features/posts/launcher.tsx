import type { Media, Post } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { create } from 'zustand'
import { MediaPicker } from '@/components/MediaPicker'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { toast } from '@/ui'
import { setMenuNavigate } from './menus'

/**
 * "Create post" from anywhere (menus, the media panel, the posts page): a store any feature item can call and a
 * host (mounted in `globals`) that creates the draft and opens the composer.
 */
interface LauncherState {
  request: { mediaIds: string[]; projectId: string | null } | null
  picker: { projectId: string | null } | null
  launch: (mediaIds: string[], projectId?: string | null) => void
  pick: (projectId?: string | null) => void
  clear: () => void
  closePicker: () => void
}

export const usePostLauncher = create<LauncherState>((set) => ({
  request: null,
  picker: null,
  launch: (mediaIds, projectId = null) => set({ request: { mediaIds, projectId } }),
  pick: (projectId = null) => set({ picker: { projectId } }),
  clear: () => set({ request: null, picker: null }),
  closePicker: () => set({ picker: null }),
}))

export const launchPost = (mediaIds: string[], projectId?: string | null) =>
  usePostLauncher.getState().launch(mediaIds, projectId)
export const pickAndLaunchPost = (projectId?: string | null) => usePostLauncher.getState().pick(projectId)

export function PostLauncherHost() {
  const t = useT('posts')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { request, picker, clear, launch, closePicker } = usePostLauncher()
  const [busy, setBusy] = useState(false)
  useEffect(() => setMenuNavigate(navigate), [navigate])

  useEffect(() => {
    if (!request || busy) return
    setBusy(true)
    api
      .post<Post>('/posts', {
        projectId: request.projectId,
        media: request.mediaIds.map((mediaId) => ({ mediaId })),
      })
      .then((p) => {
        qc.setQueryData(qk.post(p.id), p)
        void qc.invalidateQueries({ queryKey: qk.posts() })
        navigate(`/posts/${p.id}`)
      })
      .catch((err) => toast.error(err, errorMessage(err)))
      .finally(() => {
        setBusy(false)
        clear()
      })
  }, [request, busy, qc, navigate, clear])

  return (
    <MediaPicker
      open={!!picker}
      onOpenChange={(o) => !o && closePicker()}
      projectId={picker?.projectId ?? undefined}
      title={t('chooseMedia')}
      confirmLabel={t('createPost')}
      kinds={['video', 'image']}
      onPick={(items: Media[]) => {
        if (!items.length) return
        launch(
          items.map((m) => m.id),
          picker?.projectId ?? items[0]?.projectId ?? null,
        )
      }}
    />
  )
}
