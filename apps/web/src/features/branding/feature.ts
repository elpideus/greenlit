import { Palette } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'branding',
  locales: { en, it },
  settings: [
    {
      id: 'branding',
      label: 'section',
      icon: Palette,
      group: 'workspace',
      order: 10,
      permission: 'platform.manage',
      load: () => import('./BrandingSection'),
    },
  ],
})
