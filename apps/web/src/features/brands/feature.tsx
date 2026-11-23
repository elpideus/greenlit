import type { Project } from '@greenlit/shared'
import { SwatchBook } from 'lucide-react'
import { lazy } from 'react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

const KitTab = lazy(() => import('./KitTab'))

export default defineFeature({
  id: 'brands',
  locales: { en, it },
  slots: {
    // A brand kit opens on its kit: logos, colours, type... before the plain list of its files.
    'project.tabs': [
      {
        id: 'kit',
        label: 'tab',
        icon: SwatchBook,
        order: -10,
        when: ({ project }: { project: Project }) => project.kind === 'brand',
        component: KitTab,
      },
    ],
  },
  commands: [
    {
      id: 'brands.new',
      label: 'new',
      icon: SwatchBook,
      permission: 'projects.manage',
      keywords: ['brand', 'kit', 'logo', 'marchio', 'nuovo'],
      run: ({ navigate }) => navigate('/projects?new=brand'),
    },
  ],
})
