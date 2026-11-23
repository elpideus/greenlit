import { Users } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'people',
  locales: { en, it },
  settings: [
    {
      id: 'people',
      label: 'section',
      icon: Users,
      group: 'workspace',
      order: 20,
      permission: 'users.manage',
      load: () => import('./PeopleSection'),
    },
  ],
})
