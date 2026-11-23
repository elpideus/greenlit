import type { ReviewRequest } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { useCan } from '@/lib/session'

const refreshAll = (qc: ReturnType<typeof useQueryClient>, mediaIds: string[] = []) => {
  void qc.invalidateQueries({ queryKey: ['reviews'] })
  void qc.invalidateQueries({ queryKey: qk.media() })
  for (const id of mediaIds) void qc.invalidateQueries({ queryKey: qk.mediaItem(id) })
}

/** What waits for my decision. */
export function useInbox() {
  const allowed = useCan('reviews.decide')
  useLiveQuery('reviews', [qk.inbox])
  return useQuery({
    queryKey: qk.inbox,
    queryFn: () => api.get<ReviewRequest[]>('/reviews/inbox'),
    enabled: allowed,
  })
}

export function useReviews(status: 'open' | 'closed' | 'all', mediaId?: string) {
  const allowed = useCan('reviews.read')
  useLiveQuery(mediaId ? `media:${mediaId}` : 'reviews', [qk.reviews({ status, mediaId })])
  return useQuery({
    queryKey: qk.reviews({ status, mediaId }),
    queryFn: () => api.get<ReviewRequest[]>('/reviews', { status, mediaId }),
    enabled: allowed,
  })
}

export function useDecide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      decision,
      note,
    }: {
      id: string
      decision: 'approved' | 'changes_requested'
      note?: string
      mediaId: string
    }) => api.post<ReviewRequest>(`/reviews/${id}/decide`, { decision, note: note ?? '' }),
    onSuccess: (_r, v) => refreshAll(qc, [v.mediaId]),
  })
}

export function useCancelReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; mediaId: string }) =>
      api.post<ReviewRequest>(`/reviews/${id}/cancel`, {}),
    onSuccess: (_r, v) => refreshAll(qc, [v.mediaId]),
  })
}

export function useSendForReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      mediaIds: string[]
      reviewerIds: string[]
      message: string
      dueAt: string | null
    }) => api.post<ReviewRequest[]>('/reviews', input),
    onSuccess: (_r, v) => refreshAll(qc, v.mediaIds),
  })
}

type NoteLite = {
  id: string
  author: { id: string; displayName: string; avatarUrl: string | null }
  body: string
  status: 'open' | 'done'
  time: number | null
  parentId: string | null
  createdAt: string
  pin: unknown
}

/** The item's notes (same cache as the Notes panel), for the change checklist and counts. */
export function useMediaNotes(mediaId: string) {
  return useQuery({
    queryKey: qk.comments('media', mediaId),
    queryFn: () => api.get<NoteLite[]>('/comments', { targetType: 'media', targetId: mediaId }),
  })
}

export function useAddNote(mediaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { body: string; time: number | null; formatId: string | null }) =>
      api.post<NoteLite>('/comments', { targetType: 'media', targetId: mediaId, ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments('media', mediaId) }),
  })
}
