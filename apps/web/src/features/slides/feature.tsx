import type { Me, Media } from '@greenlit/shared'
import { GalleryHorizontalEnd, Ungroup } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next, useT } from '@/lib/i18n'
import { can, useSession } from '@/lib/session'
import { Button, type MenuEntry } from '@/ui'
import { AddToSlidesHost, useAddToSlides } from './AddToSlides'
import { groupAsSlides, pagesOf, ungroup } from './actions'
import { InSlidesSection } from './InSlides'
import en from './locales/en.json'
import it from './locales/it.json'

const t = i18next.getFixedT(null, 'slides')
const editor = (me: Me) => can(me, 'media.edit') && !me.viaShareLink

/**
 * Slides: a carousel's pages grouped as one library item (kind `slides`), so a post's photos don't fill the library
 * one by one. Grouping, adding and ungrouping live here; the viewer shows a Slides item page by page
 * (components/viewer/SlidesStrip) and posts given one get its pages.
 */
export default defineFeature({
  id: 'slides',
  locales: { en, it },
  globals: [AddToSlidesHost],
  slots: {
    'media.bulk': [{ id: 'slides', order: 30, component: BulkGroup, permission: 'media.edit' }],
    'media.info.sections': [
      {
        id: 'slides',
        order: 5,
        component: InSlidesSection,
        when: (p: { media: Media }) => !!p.media.inSlides,
      },
    ],
  },
  menus: {
    media: [{ id: 'slides', order: 32, items: mediaMenuItems }],
  },
})

function mediaMenuItems({ items, me }: { items: Media[]; me: Me }): MenuEntry[] {
  if (!editor(me)) return []
  const [only] = items
  if (items.length === 1 && only?.kind === 'slides')
    return [{ label: t('ungroup'), icon: Ungroup, onSelect: () => void ungroup(only) }]
  const pages = pagesOf(items)
  if (!pages.length || pages.length < items.length) return []
  return [
    pages.length > 1 && {
      label: t('group', { count: pages.length }),
      icon: GalleryHorizontalEnd,
      onSelect: () => void groupAsSlides(pages),
    },
    { label: t('addTo'), icon: GalleryHorizontalEnd, onSelect: () => useAddToSlides.getState().show(pages) },
  ]
}

/** In the library's bulk bar: group the selected pictures and videos as Slides. */
function BulkGroup({ items, clear }: { ids: string[]; items: Media[]; clear: () => void }) {
  const tr = useT('slides')
  const me = useSession()
  const pages = pagesOf(items)
  if (!editor(me) || pages.length < 2 || pages.length < items.length) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={GalleryHorizontalEnd}
      onClick={() => void groupAsSlides(pages, clear)}
    >
      {tr('groupShort')}
    </Button>
  )
}
