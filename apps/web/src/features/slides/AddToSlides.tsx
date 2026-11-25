import type { Media } from '@greenlit/shared'
import { GalleryHorizontalEnd, Plus } from 'lucide-react'
import { create } from 'zustand'
import { MediaThumb } from '@/components/MediaThumb'
import { useMediaList } from '@/data/media'
import { useT } from '@/lib/i18n'
import { Button, Dialog, EmptyState, Skeleton } from '@/ui'
import { addToSlides, groupAsSlides, pagesOf } from './actions'

export const useAddToSlides = create<{
  items: Media[] | null
  show: (items: Media[]) => void
  close: () => void
}>((set) => ({
  items: null,
  show: (items) => set({ items }),
  close: () => set({ items: null }),
}))

/** Mounted once: "Add to Slides…" lists the Slides items of the pictures' project, or starts a new one. */
export function AddToSlidesHost() {
  const t = useT('slides')
  const { items, close } = useAddToSlides()
  const open = !!items
  const projectId = items?.[0]?.projectId ?? null
  const list = useMediaList(
    { kind: 'slides', projectId: projectId ?? 'none', sort: 'recent', limit: 120 },
    { enabled: open },
  )
  const sets = list.data?.pages.flatMap((p) => p.items) ?? []
  const pages = pagesOf(items ?? [])
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      width={520}
      title={t('addTitle', { count: pages.length })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common:cancel')}
          </Button>
          <Button
            icon={Plus}
            onClick={() => {
              const chosen = items ?? []
              close()
              void groupAsSlides(chosen)
            }}
          >
            {t('newSlides')}
          </Button>
        </>
      }
    >
      <div className="-mx-2 flex max-h-[52vh] flex-col overflow-y-auto">
        {list.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="m-2 h-14" />)
        ) : sets.length ? (
          sets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                close()
                void addToSlides(s, pages)
              }}
              className="press flex items-center gap-3 rounded-[10px] p-2 text-left hover:bg-hover"
            >
              <MediaThumb media={s} showDuration={false} className="h-12 w-[76px] shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate t-callout text-ink">{s.title || t('common:untitled')}</span>
                <span className="t-meta text-ink-3">{t('slideCount', { count: s.slides?.length ?? 0 })}</span>
              </span>
            </button>
          ))
        ) : (
          <EmptyState compact icon={GalleryHorizontalEnd} title={t('noSlides')} body={t('noSlidesBody')} />
        )}
      </div>
    </Dialog>
  )
}
