import { History } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { CompositionHistory, MediaHistory, PostHistory } from './HistoryPanel'
import en from './locales/en.json'
import it from './locales/it.json'

/** Version history: a History tab wherever an item is open (viewer, editor, post composer). */
export default defineFeature({
  id: 'history',
  locales: { en, it },
  slots: {
    'media.panels': [
      {
        id: 'history',
        order: 30,
        label: 'tab',
        icon: History,
        permission: 'history.read',
        component: MediaHistory,
      },
    ],
    'post.panels': [
      {
        id: 'history',
        order: 30,
        label: 'tab',
        icon: History,
        permission: 'history.read',
        component: PostHistory,
      },
    ],
    'composition.panels': [
      {
        id: 'history',
        order: 30,
        label: 'tab',
        icon: History,
        permission: 'history.read',
        component: CompositionHistory,
      },
    ],
  },
})
