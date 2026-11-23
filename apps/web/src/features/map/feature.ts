import { Map as MapIcon } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'map',
  locales: { en, it },
  nav: [{ id: 'map', label: 'nav', to: '/map', icon: MapIcon, order: 50, permission: 'places.read' }],
  routes: [{ path: '/map', load: () => import('./MapPage'), permission: 'places.read' }],
  commands: [
    {
      id: 'map.globe',
      label: 'globe',
      icon: MapIcon,
      keywords: ['globe', 'world', 'earth', 'map'],
      permission: 'places.read',
      run: ({ navigate }) => navigate('/map?view=globe'),
    },
  ],
})
