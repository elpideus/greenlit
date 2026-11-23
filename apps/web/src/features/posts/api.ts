import type {
  CalendarEntry,
  MusicTrack,
  Placement,
  Post,
  SavePostInput,
  SoundWaveform,
} from '@greenlit/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'

export type PostsQuery = { projectId?: string; mediaId?: string; status?: string }

export function usePosts(query: PostsQuery = {}, opts: { enabled?: boolean } = {}) {
  useLiveQuery(query.projectId ? `project:${query.projectId}` : 'calendar', [qk.posts()], ['post.updated'])
  return useQuery({
    queryKey: qk.posts(query),
    queryFn: () => api.get<Post[]>('/posts', query),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  })
}

export function usePost(id: string | null | undefined) {
  useLiveQuery(id ? `post:${id}` : null, [qk.post(id ?? ''), ['posts', 'check', id ?? '']])
  return useQuery({
    queryKey: qk.post(id ?? ''),
    queryFn: () => api.get<Post>(`/posts/${id}`),
    enabled: !!id,
  })
}

export interface CheckResult {
  targetId: string
  issues: { level: 'error' | 'warning' | 'info'; code: string; message: string }[]
}

/** What each platform will say about the post (limits, shape, caption length). */
export function usePostCheck(id: string | null | undefined, revision: string) {
  return useQuery({
    queryKey: ['posts', 'check', id ?? '', revision],
    queryFn: () => api.get<CheckResult[]>(`/posts/${id}/check`),
    enabled: !!id,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

export function useCreatePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SavePostInput) => api.post<Post>('/posts', input),
    onSuccess: (p) => {
      qc.setQueryData(qk.post(p.id), p)
      void qc.invalidateQueries({ queryKey: qk.posts() })
    },
  })
}

export async function savePost(id: string, input: SavePostInput) {
  return api.patch<Post>(`/posts/${id}`, input)
}

export function useDeletePost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/posts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.posts() }),
  })
}

/** Publish now or schedule (each target at its own time). The caller confirms first. */
export function publishPost(id: string, targetIds?: string[]) {
  return api.post<{ tasks: string[] }>(`/posts/${id}/publish`, { targetIds })
}

export function rescheduleTarget(postId: string, targetId: string, scheduleAt: string) {
  return api.post(`/posts/${postId}/targets/${targetId}/reschedule`, { scheduleAt })
}

export function removeTarget(postId: string, targetId: string) {
  return api.post(`/posts/${postId}/targets/${targetId}/remove`, {})
}

/** Copies a post's content into a new draft (nothing on the platforms is copied). */
export async function duplicatePost(p: Post) {
  return api.post<Post>('/posts', {
    projectId: p.projectId,
    name: p.name ? `${p.name} (copy)` : '',
    caption: p.caption,
    title: p.title,
    hashtags: p.hashtags,
    translations: p.translations,
    media: p.media.map((m) => ({ mediaId: m.mediaId })),
    targets: p.targets
      .filter((t) => t.enabled && t.state !== 'removed')
      .map((t) => ({
        accountId: t.accountId,
        placement: t.placement,
        title: t.title,
        caption: t.caption,
        hashtags: t.hashtags,
        tags: t.tags,
        firstComment: t.firstComment,
        location: t.location,
        thumbnail: t.thumbnail,
        translations: t.translations,
        music: t.music,
        audio: t.audio,
        options: t.options,
        formats: t.formats,
        versions: t.versions,
        audioTracks: t.audioTracks,
      })),
  })
}

export function useMusicSearch(accountId: string | null, q: string, placement: Placement, enabled: boolean) {
  return useQuery({
    queryKey: ['music', accountId, placement, q],
    queryFn: ({ signal }) =>
      api.get<MusicTrack[]>(`/connectors/accounts/${accountId}/music`, { q, placement }, signal),
    enabled: enabled && !!accountId,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function soundAudioUrl(accountId: string, trackId: string, previewUrl?: string | null) {
  return api.url(`/connectors/accounts/${accountId}/sounds/${encodeURIComponent(trackId)}/audio`, {
    u: previewUrl ?? undefined,
  })
}

export function useSoundWaveform(
  accountId: string | null,
  trackId: string | null,
  previewUrl?: string | null,
) {
  return useQuery({
    queryKey: ['music', 'wave', accountId, trackId],
    queryFn: () =>
      api.get<SoundWaveform>(
        `/connectors/accounts/${accountId}/sounds/${encodeURIComponent(trackId!)}/waveform`,
        {
          u: previewUrl ?? undefined,
        },
      ),
    enabled: !!accountId && !!trackId,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

export function useCalendar(
  from: string,
  to: string,
  filter: { platform?: string; accountId?: string } = {},
) {
  useLiveQuery('calendar', [['calendar']])
  return useQuery({
    queryKey: [...qk.calendar(from, to), filter],
    queryFn: () => api.get<CalendarEntry[]>('/calendar', { from, to, ...filter }),
    placeholderData: keepPreviousData,
  })
}
