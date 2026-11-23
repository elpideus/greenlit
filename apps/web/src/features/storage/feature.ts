import { HardDrive } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'storage',
  locales: { en, it },
  settings: [
    {
      id: 'storage',
      label: 'section',
      icon: HardDrive,
      group: 'system',
      order: 0,
      permission: 'storage.manage',
      load: () => import('./StorageSection'),
    },
  ],
})
