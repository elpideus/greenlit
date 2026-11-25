import { type Media, SLIDE_KINDS, SLIDES_MAX, slidesOrder } from '@greenlit/shared'
import { api } from '@/lib/api'
import { i18next } from '@/lib/i18n'
import { qk, queryClient } from '@/lib/query'
import { toast } from '@/ui'

const t = i18next.getFixedT(null, 'slides')

/** Pictures and videos: what a Slides item's pages can be. */
export const pagesOf = (items: Media[]) => items.filter((m) => SLIDE_KINDS.includes(m.kind))

const refresh = (m?: Media) => {
  if (m) queryClient.setQueryData(qk.mediaItem(m.id), m)
  void queryClient.invalidateQueries({ queryKey: qk.media() })
  void queryClient.invalidateQueries({ queryKey: qk.projects })
}

/** Groups the pictures and videos among `items` as one Slides item, numbered pages in their order. */
export async function groupAsSlides(items: Media[], after?: (slides: Media) => void) {
  const pages = slidesOrder(pagesOf(items))
  if (pages.length > SLIDES_MAX) return toast.info(t('tooMany', { max: SLIDES_MAX }))
  try {
    const m = await api.post<Media>('/media/slides', { mediaIds: pages.map((p) => p.id) })
    refresh(m)
    after?.(m)
    toast.done(t('grouped', { title: m.title, count: pages.length }), {
      action: { label: t('undo'), onClick: () => void ungroup(m, { quiet: true }) },
    })
  } catch (err) {
    toast.error(err)
  }
}

/** Adds pictures and videos at the end of a Slides item. */
export async function addToSlides(set: Media, items: Media[]) {
  const before = (set.slides ?? []).map((p) => p.mediaId)
  const fresh = slidesOrder(pagesOf(items)).filter((m) => !before.includes(m.id))
  if (!fresh.length) return toast.info(t('alreadyIn', { title: set.title }))
  if (before.length + fresh.length > SLIDES_MAX) return toast.info(t('tooMany', { max: SLIDES_MAX }))
  try {
    const m = await api.put<Media>(`/media/${set.id}/slides`, {
      mediaIds: [...before, ...fresh.map((f) => f.id)],
    })
    refresh(m)
    toast.done(t('added', { title: set.title, count: fresh.length }), {
      action: {
        label: t('undo'),
        onClick: async () => refresh(await api.put<Media>(`/media/${set.id}/slides`, { mediaIds: before })),
      },
    })
  } catch (err) {
    toast.error(err)
  }
}

/** Takes a Slides item apart: its pages come back to the library; Undo groups them again. */
export async function ungroup(set: Media, opts: { quiet?: boolean } = {}) {
  try {
    const ids = await api.delete<{ mediaIds: string[] }>(`/media/${set.id}/slides`)
    queryClient.removeQueries({ queryKey: qk.mediaItem(set.id) })
    refresh()
    if (opts.quiet) return
    toast.done(t('ungrouped', { title: set.title, count: ids.mediaIds.length }), {
      action: {
        label: t('undo'),
        onClick: async () =>
          refresh(
            await api.post<Media>('/media/slides', {
              mediaIds: ids.mediaIds,
              title: set.title,
              projectId: set.projectId,
            }),
          ),
      },
    })
  } catch (err) {
    toast.error(err)
  }
}
