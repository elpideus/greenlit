import type { Comment, CommentTargetType, CreateCommentInput } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

export type Note = Omit<Comment, 'replies'> & { replies?: Note[] }

export function useNotes(targetType: CommentTargetType, targetId: string | null | undefined) {
  useLiveQuery(targetId ? `${targetType}:${targetId}` : null, [qk.comments(targetType, targetId ?? '')])
  return useQuery({
    queryKey: qk.comments(targetType, targetId ?? ''),
    queryFn: () => api.get<Note[]>('/comments', { targetType, targetId: targetId! }),
    enabled: !!targetId,
  })
}

export function useNoteActions(targetType: CommentTargetType, targetId: string) {
  const qc = useQueryClient()
  const key = qk.comments(targetType, targetId)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    if (targetType === 'media') void qc.invalidateQueries({ queryKey: qk.mediaItem(targetId) })
  }
  const create = useMutation({
    mutationFn: (input: Partial<CreateCommentInput> & { body: string }) =>
      api.post<Note>('/comments', { targetType, targetId, ...input }),
    onSuccess: refresh,
  })
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.patch<Note>(`/comments/${id}`, { body }),
    onSuccess: refresh,
  })
  const resolve = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.post<Note>(`/comments/${id}/resolve`, { done }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Note[]>(key)
      if (prev)
        qc.setQueryData(
          key,
          prev.map((n) => (n.id === id ? { ...n, status: done ? 'done' : 'open' } : n)),
        )
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`),
    onSuccess: refresh,
  })
  return { create, edit, resolve, remove }
}
