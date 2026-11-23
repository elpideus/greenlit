import type { MediaFormat } from '@greenlit/shared'
import { lazy } from 'react'
import { defineFeature } from '@/app/feature'
import { textPreview } from './kinds'
import en from './locales/en.json'
import it from './locales/it.json'

const DocumentStage = lazy(() => import('./DocumentStage'))

/** Text files in the viewer: code with syntax highlighting (Python and 30 more), Markdown and HTML pages. */
export default defineFeature({
  id: 'documents',
  locales: { en, it },
  slots: {
    'media.viewer.stage': [
      {
        id: 'text',
        order: 50,
        component: DocumentStage,
        when: ({ format }: { format: MediaFormat }) =>
          format.kind !== 'image' && format.kind !== 'design' && !!textPreview(format),
      },
    ],
  },
})
