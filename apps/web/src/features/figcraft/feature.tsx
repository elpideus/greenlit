import { FIGCRAFT_MIME } from '@greenlit/shared'
import { Type } from 'lucide-react'
import { lazy } from 'react'
import { defineFeature } from '@/app/feature'
import { DesignTools } from './DesignTools'
import en from './locales/en.json'
import it from './locales/it.json'

const DesignStage = lazy(() => import('./DesignStage').then((m) => ({ default: m.DesignStage })))
const DesignSection = lazy(() => import('./DesignSection').then((m) => ({ default: m.DesignSection })))

const isDesign = (p: { format?: { mime: string } }) => p.format?.mime === FIGCRAFT_MIME

/**
 * FigCraft designs (`.figcraft`): the viewer shows the file live in FigCraft (the official browser build, served by
 * the server's figcraft module), with View / Edit and Save in the top bar; the Info tab lists pages, frames and fonts
 * and exports frames as pictures; Settings → Design fonts keeps the brand fonts designs need.
 */
export default defineFeature({
  id: 'figcraft',
  locales: { en, it },
  slots: {
    'media.viewer.stage': [{ id: 'figcraft', component: DesignStage, when: isDesign }],
    'media.viewer.tools': [{ id: 'figcraft', order: 5, component: DesignTools, when: isDesign }],
    'media.info.sections': [
      {
        id: 'figcraft',
        order: 10,
        component: DesignSection,
        when: (p: { media: { kind: string } }) => p.media.kind === 'design',
      },
    ],
  },
  settings: [
    {
      id: 'design-fonts',
      label: 'fonts.section',
      icon: Type,
      group: 'workspace',
      order: 40,
      permission: 'designs.fonts',
      load: () => import('./FontsSection'),
    },
  ],
})
