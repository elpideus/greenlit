import { Images, Trash2 } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'
import { PaletteResults } from './PaletteResults'

export default defineFeature({
  id: 'library',
  locales: { en, it },
  nav: [
    {
      id: 'library',
      label: 'nav',
      to: '/library',
      icon: Images,
      order: 10,
      permission: 'media.read',
      match: ['/media'],
    },
  ],
  routes: [{ path: '/library', load: () => import('./LibraryPage'), permission: 'media.read' }],
  commands: [
    {
      id: 'library.trash',
      label: 'palette.trash',
      icon: Trash2,
      permission: 'media.delete',
      keywords: ['deleted', 'bin', 'cestino'],
      run: ({ navigate }) => navigate('/library?trash=1'),
    },
  ],
  slots: {
    'palette.results': [
      { id: 'library.results', order: 10, component: PaletteResults, permission: 'media.read' },
    ],
  },
})
