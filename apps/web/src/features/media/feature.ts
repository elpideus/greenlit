import { Info } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { InfoPanel } from './InfoPanel'
import en from './locales/en.json'
import it from './locales/it.json'

/**
 * The media viewer: /media/:id full window, and `Viewer` embedded by the review room. Other features add the panel's
 * tabs (`media.panels`), the decision (`media.decision`), layers on the frame (`media.viewer.overlay`), top-bar tools
 * (`media.viewer.tools`), Info sections (`media.info.sections`) and scrubber markers (`media.scrubber.markers`).
 */
export default defineFeature({
  id: 'media',
  locales: { en, it },
  routes: [
    { path: '/media/:id', layout: 'full', permission: 'media.read', load: () => import('./MediaPage') },
  ],
  slots: {
    'media.panels': [{ id: 'info', order: 20, label: 'info.tab', icon: Info, component: InfoPanel }],
  },
})
