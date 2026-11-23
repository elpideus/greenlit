import { Settings2, UserRound } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'settings',
  locales: { en, it },
  routes: [{ path: '/settings/:section?', load: () => import('./SettingsPage') }],
  settings: [
    {
      id: 'profile',
      label: 'profile.section',
      icon: UserRound,
      group: 'you',
      order: 0,
      load: () => import('./sections/ProfileSection'),
    },
    {
      id: 'general',
      label: 'general.section',
      icon: Settings2,
      group: 'workspace',
      order: 0,
      permission: 'platform.manage',
      load: () => import('./sections/GeneralSection'),
    },
  ],
})
