import type { Me, Media } from '@greenlit/shared'
import { ScanEye, Send } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import { can } from '@/lib/session'
import { BulkSend } from './BulkSend'
import { Decision } from './Decision'
import en from './locales/en.json'
import it from './locales/it.json'
import { ReviewBadge } from './NavBadge'
import { SendDialogHost } from './SendDialog'
import { openSendForReview } from './store'

/**
 * Review: send media to the people who sign it off, and their decisions — Greenlight, or Ask for changes as a
 * checklist of notes on the frame. The review room is /review; the decision also sits above every viewer's panel.
 */
export default defineFeature({
  id: 'review',
  locales: { en, it },
  routes: [{ path: '/review', load: () => import('./ReviewPage'), permission: 'reviews.read' }],
  nav: [{ id: 'review', label: 'nav', to: '/review', icon: ScanEye, order: 30, permission: 'reviews.read' }],
  slots: {
    'nav.badge.review': [{ id: 'count', component: ReviewBadge }],
    'media.decision': [{ id: 'decision', component: Decision, permission: 'reviews.read' }],
    'media.bulk': [{ id: 'send', order: 30, component: BulkSend, permission: 'reviews.send' }],
  },
  menus: {
    media: [
      {
        id: 'send-for-review',
        order: 30,
        items: ({ items, me }: { items: Media[]; me: Me }) =>
          can(me, 'reviews.send') && items.length
            ? [
                {
                  label:
                    items.length > 1
                      ? i18next.t('review:menuMany', { count: items.length })
                      : i18next.t('review:menu'),
                  icon: Send,
                  onSelect: () => openSendForReview(items.map((m) => m.id)),
                },
              ]
            : [],
      },
    ],
  },
  globals: [SendDialogHost],
})
