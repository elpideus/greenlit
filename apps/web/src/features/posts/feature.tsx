import { Send } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import { PostLauncherHost, pickAndLaunchPost } from './launcher'
import en from './locales/en.json'
import it from './locales/it.json'
import { mediaMenuItems } from './menus'
import { PostsPaletteResults } from './PaletteResults'
import { MediaPostsPanel, ProjectPostsTab } from './panels'
import { PreviewOverlay, PreviewTool } from './viewerPreview'

const t = i18next.t.bind(i18next)

export default defineFeature({
  id: 'posts',
  locales: { en, it },
  nav: [
    {
      id: 'posts',
      label: 'nav',
      to: '/posts',
      icon: Send,
      order: 40,
      permission: 'posts.read',
      match: ['/calendar'],
    },
  ],
  routes: [
    { path: '/posts', load: () => import('./PostsPage'), permission: 'posts.read' },
    {
      path: '/posts/:id',
      layout: 'full',
      load: () => import('./composer/ComposerPage'),
      permission: 'posts.read',
    },
  ],
  commands: [
    {
      id: 'posts.new',
      label: 'newPost',
      icon: Send,
      keywords: ['publish', 'instagram', 'tiktok', 'youtube', 'facebook', 'pubblica'],
      permission: 'posts.edit',
      run: () => pickAndLaunchPost(null),
    },
  ],
  slots: {
    'media.panels': [
      {
        id: 'posts',
        label: 'Posts',
        icon: Send,
        order: 60,
        component: MediaPostsPanel,
        permission: 'posts.read',
      },
    ],
    'project.tabs': [
      {
        id: 'posts',
        label: 'Posts',
        icon: Send,
        order: 40,
        component: ProjectPostsTab,
        permission: 'posts.read',
      },
    ],
    'palette.results': [{ id: 'posts', order: 40, component: PostsPaletteResults, permission: 'posts.read' }],
    'media.viewer.tools': [
      {
        id: 'preview',
        order: 40,
        component: PreviewTool,
        when: (p: { media: { kind: string } }) => p.media.kind === 'video' || p.media.kind === 'image',
      },
    ],
    'media.viewer.overlay': [{ id: 'preview', order: 90, component: PreviewOverlay }],
  },
  menus: {
    media: [{ id: 'posts', order: 40, items: (ctx) => mediaMenuItems(ctx, t) }],
  },
  globals: [PostLauncherHost],
})
