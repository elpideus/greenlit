import { Activity } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

/** Every background task, past and present, to browse and stop: the page behind the top bar's Activity popup. */
export default defineFeature({
  id: 'activity',
  locales: { en, it },
  routes: [{ path: '/activity', load: () => import('./ActivityPage'), permission: 'activity.read' }],
  commands: [
    {
      id: 'activity.open',
      label: 'palette.open',
      icon: Activity,
      permission: 'activity.read',
      keywords: ['activity', 'tasks', 'jobs', 'background', 'attività', 'processi', 'lavori'],
      run: ({ navigate }) => navigate('/activity'),
    },
  ],
})
