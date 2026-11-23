import type { Me, Media, Post, Project } from '@greenlit/shared'
import { CalendarDays, Link2 } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import { can } from '@/lib/session'
import type { MenuEntry } from '@/ui'
import en from './locales/en.json'
import it from './locales/it.json'
import { ShareDialogHost } from './ShareDialog'
import { openShare } from './store'

const t = i18next.t.bind(i18next)

const item = (me: Me, open: () => void): MenuEntry[] =>
  can(me, 'share.create') && !me.viaShareLink ? [{ label: t('share:menu'), icon: Link2, onSelect: open }] : []

export default defineFeature({
  id: 'share',
  locales: { en, it },
  globals: [ShareDialogHost],
  settings: [
    {
      id: 'share-links',
      label: 'section',
      icon: Link2,
      group: 'workspace',
      order: 40,
      permission: 'share.create',
      load: () => import('./ShareLinksSection'),
    },
  ],
  commands: [
    {
      id: 'share.calendar',
      label: 'calendarCommand',
      icon: CalendarDays,
      keywords: ['share', 'link', 'calendar', 'condividi'],
      permission: 'share.create',
      run: () => openShare({ type: 'calendar', id: null, title: '' }),
    },
  ],
  menus: {
    // One item only: a link opens one thing.
    media: [
      {
        id: 'share',
        order: 70,
        items: ({ items, me }: { items: Media[]; me: Me }) =>
          items.length === 1
            ? item(me, () => openShare({ type: 'media', id: items[0]!.id, title: items[0]!.title }))
            : [],
      },
    ],
    project: [
      {
        id: 'share',
        order: 70,
        items: ({ project, me }: { project: Project; me: Me }) =>
          item(me, () => openShare({ type: 'project', id: project.id, title: project.name })),
      },
    ],
    post: [
      {
        id: 'share',
        order: 70,
        items: ({ post, me }: { post: Post; me: Me }) =>
          item(me, () =>
            openShare({ type: 'post', id: post.id, title: post.name || post.title || t('posts:untitled') }),
          ),
      },
    ],
  },
})
