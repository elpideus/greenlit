import { Tags } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'
import { TagsButton } from './TagsButton'

export default defineFeature({
  id: 'tags',
  locales: { en, it },
  routes: [{ path: '/library/tags', load: () => import('./TagsPage'), permission: 'media.read' }],
  commands: [
    {
      id: 'tags.browse',
      label: 'palette.browse',
      icon: Tags,
      permission: 'media.read',
      keywords: ['tags', 'hashtag', 'rename', 'merge', 'etichette', 'rinomina', 'unisci'],
      run: ({ navigate }) => navigate('/library/tags'),
    },
  ],
  slots: {
    'library.toolbar': [
      {
        id: 'tags.browse',
        order: 10,
        component: TagsButton,
        permission: 'media.read',
        when: (p: { projectId: string | null }) => p.projectId === null,
      },
    ],
  },
})
