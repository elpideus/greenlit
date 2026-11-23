import type { Media, MediaStatus } from '@greenlit/shared'
import { normalizeTag } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  CircleDot,
  Download,
  EyeOff,
  FolderInput,
  Link2,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { menuEntries } from '@/app/registry'
import { type BulkAction, formatByKey, useBulkMedia } from '@/data/media'
import { useReviewers } from '@/data/people'
import { useProjects } from '@/data/projects'
import { useTags } from '@/data/tags'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { can, useSession } from '@/lib/session'
import { Button, Chip, confirm, Dialog, type MenuEntry, Tally, toast, toneFor } from '@/ui'
import { STATUSES } from './tokens'

/**
 * Everything one can do to media from the library: the right-click / ⋯ menu (with other features' contributions),
 * the bulk bar's actions and the tag dialog.
 */
export function useMediaActions({
  onRename,
  inTrash,
}: {
  onRename?: (id: string) => void
  inTrash?: boolean
}) {
  const t = useT('browser')
  const tc = useT()
  const me = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const bulk = useBulkMedia()
  const { data: projects } = useProjects()
  const reviewers = useReviewers()
  const [tagging, setTagging] = useState<Media[] | null>(null)

  const run = async (ids: string[], action: BulkAction, done: string, undo?: BulkAction) => {
    try {
      await bulk.mutateAsync({ ids, ...action })
      toast.done(
        done,
        undo
          ? { action: { label: t('done.undo'), onClick: () => void bulk.mutateAsync({ ids, ...undo }) } }
          : undefined,
      )
    } catch (err) {
      toast.error(err)
    }
  }

  const trash = (items: Media[]) =>
    run(
      items.map((m) => m.id),
      { action: 'trash' },
      t('done.trashed', { count: items.length }),
      { action: 'restore' },
    )
  const restore = (items: Media[]) =>
    run(
      items.map((m) => m.id),
      { action: 'restore' },
      t('done.restored', { count: items.length }),
    )
  const purge = async (items: Media[]) => {
    const ok = await confirm({
      title: t('confirmPurge.title', { count: items.length, name: items[0]?.title || tc('untitled') }),
      body: t('confirmPurge.body'),
      confirm: t('confirmPurge.confirm'),
      danger: true,
    })
    if (ok)
      await run(
        items.map((m) => m.id),
        { action: 'purge' },
        t('done.purged', { count: items.length }),
      )
  }
  const setStatus = (items: Media[], status: MediaStatus) =>
    run(
      items.map((m) => m.id),
      { action: 'status', status },
      t('done.status', { count: items.length, status: tc(`status.${status}`).toLowerCase() }),
    )
  const move = (items: Media[], projectId: string | null) => {
    const place = projectId ? (projects?.find((p) => p.id === projectId)?.name ?? '') : t('menu.noProject')
    const from = items[0]?.projectId ?? null
    const same = items.every((m) => m.projectId === from)
    return run(
      items.map((m) => m.id),
      { action: 'move', projectId },
      t('done.moved', { count: items.length, place }),
      same ? { action: 'move', projectId: from } : undefined,
    )
  }
  const hide = (items: Media[], userId: string, hidden: boolean) =>
    run(
      items.map((m) => m.id),
      { action: hidden ? 'hide' : 'unhide', userIds: [userId] },
      t('done.hidden'),
    )

  const download = (items: Media[]) => {
    for (const m of items) {
      const f = formatByKey(m, null)
      if (!f) continue
      const a = document.createElement('a')
      a.href = f.urls.download
      a.download = f.filename
      document.body.append(a)
      a.click()
      a.remove()
    }
  }

  const copyLink = async (items: Media[]) => {
    const text = items.map((m) => `${location.origin}/media/${m.id}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.done(t('menu.linkCopied'))
    } catch (err) {
      toast.error(err)
    }
  }

  /** The menu for one or many media items. */
  const menu = (items: Media[]): MenuEntry[] => {
    if (!items.length) return []
    const one = items.length === 1 ? items[0]! : null
    const edit = can(me, 'media.edit') && !me.viaShareLink
    const own: { order: number; items: MenuEntry[] }[] = []
    if (inTrash) {
      own.push({
        order: 0,
        items: can(me, 'media.delete')
          ? [
              {
                label: one ? t('menu.restore') : t('menu.restoreMany', { count: items.length }),
                icon: RotateCcw,
                onSelect: () => void restore(items),
              },
              {
                label: one ? t('menu.purge') : t('menu.purgeMany', { count: items.length }),
                icon: Trash2,
                danger: true,
                onSelect: () => void purge(items),
              },
            ]
          : [],
      })
      return menuEntries('media-trash', { items, me }, own)
    }
    own.push({
      order: 0,
      items: [
        one && {
          label: t('menu.open'),
          icon: ArrowUpRight,
          shortcut: 'enter',
          onSelect: () => navigate(`/media/${one.id}`),
        },
        one &&
          edit &&
          onRename && {
            label: t('menu.rename'),
            icon: Pencil,
            shortcut: 'F2',
            onSelect: () => onRename(one.id),
          },
      ],
    })
    const workflow: MenuEntry[] = []
    if (can(me, 'media.status'))
      workflow.push({
        label: t('menu.status'),
        icon: CircleDot,
        items: STATUSES.map((s) => ({
          label: (
            <span className="flex items-center gap-2">
              <Tally tone={toneFor(s)} size={7} />
              {tc(`status.${s}`)}
            </span>
          ),
          checked: items.every((m) => m.status === s),
          onSelect: () => void setStatus(items, s),
        })),
      })
    if (edit) {
      workflow.push({
        label: t('menu.move'),
        icon: FolderInput,
        items: [
          {
            label: t('menu.noProject'),
            checked: items.every((m) => !m.projectId),
            onSelect: () => void move(items, null),
          },
          'separator',
          ...(projects ?? []).map((p) => ({
            label: p.name,
            checked: items.every((m) => m.projectId === p.id),
            onSelect: () => void move(items, p.id),
          })),
        ],
      })
      workflow.push({ label: t('menu.addTag'), icon: Tag, onSelect: () => setTagging(items) })
    }
    own.push({ order: 20, items: workflow })
    own.push({
      order: 80,
      items: [
        {
          label: one ? t('menu.download') : t('menu.downloadMany', { count: items.length }),
          icon: Download,
          onSelect: () => download(items),
        },
        { label: t('menu.copyLink'), icon: Link2, onSelect: () => void copyLink(items) },
      ],
    })
    if (me.role === 'admin')
      own.push({
        order: 85,
        items: [
          {
            label: t('menu.hideFrom'),
            icon: EyeOff,
            items: reviewers.length
              ? reviewers.map((r) => {
                  const hidden = items.every((m) => (m.hiddenFrom ?? []).includes(r.id))
                  return {
                    label: r.displayName,
                    checked: hidden,
                    keepOpen: false,
                    onSelect: () => void hide(items, r.id, !hidden),
                  }
                })
              : [{ label: t('menu.noReviewers'), disabled: true }],
          },
        ],
      })
    if (can(me, 'media.delete'))
      own.push({
        order: 100,
        items: [
          {
            label: one ? t('menu.trash') : t('menu.trashMany', { count: items.length }),
            icon: Trash2,
            danger: true,
            shortcut: 'mod+backspace',
            onSelect: () => void trash(items),
          },
        ],
      })
    return menuEntries('media', { items, me }, own)
  }

  const rename = async (m: Media, title: string) => {
    try {
      const next = await api.patch<Media>(`/media/${m.id}`, { title })
      qc.setQueryData(qk.mediaItem(m.id), next)
      void qc.invalidateQueries({ queryKey: qk.media() })
    } catch (err) {
      toast.error(err)
    }
  }

  const tagDialog = (
    <TagDialog
      items={tagging}
      onClose={() => setTagging(null)}
      onAdd={(tags) =>
        run(
          (tagging ?? []).map((m) => m.id),
          { action: 'tag', tags },
          t('done.tagged', { count: tagging?.length ?? 0 }),
        )
      }
    />
  )

  return {
    menu,
    trash,
    restore,
    purge,
    setStatus,
    move,
    download,
    rename,
    openTags: setTagging,
    tagDialog,
    busy: bulk.isPending,
  }
}

function TagDialog({
  items,
  onClose,
  onAdd,
}: {
  items: Media[] | null
  onClose: () => void
  onAdd: (tags: string[]) => Promise<void>
}) {
  const t = useT('browser')
  const tc = useT()
  const [draft, setDraft] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { data: all } = useTags()
  const add = (raw: string) => {
    const tag = normalizeTag(raw).toLowerCase()
    if (tag && !tags.includes(tag)) setTags([...tags, tag])
    setDraft('')
  }
  const suggestions = (all ?? [])
    .filter(
      (x) =>
        draft && x.name.toLowerCase().includes(draft.toLowerCase()) && !tags.includes(x.name.toLowerCase()),
    )
    .slice(0, 6)
  const close = () => {
    setTags([])
    setDraft('')
    onClose()
  }
  return (
    <Dialog
      open={!!items}
      onOpenChange={(o) => !o && close()}
      title={t('tagDialog.title', { count: items?.length ?? 1 })}
      description={t('tagDialog.hint')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!tags.length && !draft.trim()}
            onClick={async () => {
              const final = draft.trim() ? [...tags, normalizeTag(draft).toLowerCase()] : tags
              setBusy(true)
              try {
                await onAdd(final)
                close()
              } catch (err) {
                toast.error(errorMessage(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('tagDialog.add')}
          </Button>
        </>
      }
    >
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-control bg-well px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]">
        {tags.map((tg) => (
          <Chip key={tg} onRemove={() => setTags(tags.filter((x) => x !== tg))}>
            #{tg}
          </Chip>
        ))}
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && tags.length) setTags(tags.slice(0, -1))
          }}
          placeholder={tags.length ? '' : t('tagDialog.placeholder')}
          className="h-7 min-w-[140px] flex-1 bg-transparent t-callout text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <Chip key={s.name} onClick={() => add(s.name)}>
              #{s.name} <span className="ml-1 t-meta text-ink-4">{s.count}</span>
            </Chip>
          ))}
        </div>
      )}
    </Dialog>
  )
}
