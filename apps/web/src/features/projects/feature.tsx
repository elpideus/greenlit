import { FolderKanban, FolderPlus } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import en from './locales/en.json'
import it from './locales/it.json'

export default defineFeature({
  id: 'projects',
  locales: { en, it },
  nav: [
    {
      id: 'projects',
      label: 'nav',
      to: '/projects',
      icon: FolderKanban,
      order: 20,
      permission: 'projects.read',
    },
  ],
  routes: [
    { path: '/projects', load: () => import('./ProjectsPage'), permission: 'projects.read' },
    { path: '/projects/:id', load: () => import('./ProjectPage'), permission: 'projects.read' },
  ],
  commands: [
    {
      id: 'projects.new',
      label: 'new',
      icon: FolderPlus,
      permission: 'projects.manage',
      keywords: ['create', 'project', 'nuovo'],
      run: ({ navigate }) => navigate('/projects?new=1'),
    },
  ],
})
