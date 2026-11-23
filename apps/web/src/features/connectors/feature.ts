import { Link2, Smartphone } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'connectors',
  locales: { en, it },
  settings: [
    // `/settings/accounts` is the address the server's notifications link to.
    {
      id: 'accounts',
      label: 'section',
      icon: Link2,
      group: 'publishing',
      order: 0,
      permission: 'connectors.read',
      load: () => import('./AccountsSection'),
    },
    {
      id: 'device',
      label: 'device.section',
      icon: Smartphone,
      group: 'publishing',
      order: 10,
      permission: 'android.manage',
      load: () => import('./DeviceSection'),
    },
  ],
})
