import type { Me, Media, Post } from '@greenlit/shared'
import type { TFunction } from 'i18next'
import { Copy, ExternalLink, Send, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { qk, queryClient } from '@/lib/query'
import { can } from '@/lib/session'
import { confirm, type MenuEntry, toast } from '@/ui'
import { duplicatePost } from './api'
import { launchPost } from './launcher'

/** Navigation for menu items (they run outside React); set by the launcher host. */
let navigate: ((to: string) => void) | null = null
export function setMenuNavigate(fn: (to: string) => void) {
  navigate = fn
}
export const go = (to: string) => (navigate ? navigate(to) : location.assign(to))

const onPlatform = (p: Post) =>
  p.targets.some((t) => t.remoteUrl && (t.state === 'scheduled' || t.state === 'published'))

/** The posts feature's own items on a post's menu (others add theirs through `menus.post`). */
export function postMenuOwnItems(post: Post, me: Me, t: TFunction): { order: number; items: MenuEntry[] }[] {
  const editable = can(me, 'posts.edit')
  const remote = post.targets.find((x) => x.remoteUrl && x.state === 'published')
  return [
    {
      order: 0,
      items: [
        { label: t('posts:menu.open'), icon: SquareArrowOutUpRight, onSelect: () => go(`/posts/${post.id}`) },
        remote?.remoteUrl
          ? {
              label: t('posts:composer.openOnPlatform', {
                where: remote.platform[0]!.toUpperCase() + remote.platform.slice(1),
              }),
              icon: ExternalLink,
              onSelect: () => void window.open(remote.remoteUrl!, '_blank', 'noopener'),
            }
          : null,
      ],
    },
    {
      order: 30,
      items: [
        editable && {
          label: t('posts:menu.duplicate'),
          icon: Copy,
          onSelect: () =>
            void duplicatePost(post)
              .then((p) => {
                void queryClient.invalidateQueries({ queryKey: qk.posts() })
                toast.done(t('posts:menu.duplicated'))
                go(`/posts/${p.id}`)
              })
              .catch((e) => toast.error(e)),
        },
      ],
    },
    {
      order: 100,
      items: [
        editable && {
          label: t('posts:menu.delete'),
          icon: Trash2,
          danger: true,
          disabled: onPlatform(post),
          hint: onPlatform(post) ? t('posts:state.published') : undefined,
          onSelect: async () => {
            const name = post.name || post.title || t('posts:untitled')
            const ok = await confirm({
              title: t('posts:menu.deleteConfirm', { name }),
              body: t('posts:menu.deleteBody'),
              confirm: t('common:delete'),
              danger: true,
            })
            if (!ok) return
            try {
              await api.delete(`/posts/${post.id}`)
              void queryClient.invalidateQueries({ queryKey: qk.posts() })
              void queryClient.invalidateQueries({ queryKey: ['calendar'] })
              toast.done(t('posts:menu.deleted'))
              if (location.pathname.startsWith(`/posts/${post.id}`)) go('/posts')
            } catch (e) {
              toast.error(e, errorMessage(e))
            }
          },
        },
      ],
    },
  ]
}

/** "Create post" on media (one item or a selection). */
export function mediaMenuItems({ items, me }: { items: Media[]; me: Me }, t: TFunction): MenuEntry[] {
  if (!can(me, 'posts.edit')) return []
  // A Slides item is one carousel: the post gets its pages.
  const usable = items.filter((m) => m.kind === 'video' || m.kind === 'image' || m.kind === 'slides')
  if (!usable.length) return []
  return [
    {
      label:
        usable.length > 1
          ? t('posts:menu.createPostMany', { count: usable.length })
          : t('posts:menu.createPost'),
      icon: Send,
      onSelect: () =>
        launchPost(
          usable.map((m) => m.id),
          usable[0]?.projectId ?? null,
        ),
    },
  ]
}
