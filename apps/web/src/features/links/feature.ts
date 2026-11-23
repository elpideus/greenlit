import { Link2 } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { CompositionLinks, MediaLinks, PostLinks } from './LinksPanel'
import en from './locales/en.json'
import it from './locales/it.json'

/** Links between items (source clips, edits, renders, posts): a Links tab wherever an item is open. */
export default defineFeature({
  id: 'links',
  locales: { en, it },
  slots: {
    'media.panels': [
      { id: 'links', order: 40, label: 'tab', icon: Link2, permission: 'links.read', component: MediaLinks },
    ],
    'post.panels': [
      { id: 'links', order: 40, label: 'tab', icon: Link2, permission: 'links.read', component: PostLinks },
    ],
    'composition.panels': [
      {
        id: 'links',
        order: 40,
        label: 'tab',
        icon: Link2,
        permission: 'links.read',
        component: CompositionLinks,
      },
    ],
  },
})
