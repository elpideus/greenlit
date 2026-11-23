import { TerminalSquare } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'developer',
  locales: { en, it },
  settings: [
    {
      id: 'api',
      label: 'section',
      icon: TerminalSquare,
      group: 'system',
      order: 10,
      load: () => import('./DeveloperSection'),
    },
  ],
})
