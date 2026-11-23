import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'auth',
  locales: { en, it },
  routes: [
    { path: '/login', layout: 'public', load: () => import('./LoginPage') },
    { path: '/setup', layout: 'public', load: () => import('./SetupPage') },
    { path: '/s/:token', layout: 'public', load: () => import('./ShareLanding') },
  ],
})
