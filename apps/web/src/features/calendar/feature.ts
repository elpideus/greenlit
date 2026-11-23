import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'calendar',
  locales: { en, it },
  routes: [{ path: '/calendar', load: () => import('./CalendarPage'), permission: 'calendar.read' }],
})
