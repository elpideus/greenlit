import type { Project } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowUpRight, ImageIcon, Palette, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { menuEntries } from '@/app/registry'
import { MediaPicker } from '@/components/MediaPicker'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { can, useSession } from '@/lib/session'
import { confirm, type MenuEntry, toast } from '@/ui'
import { PROJECT_COLORS } from './colors'

/** The project menu (right-click and ⋯) with other features' contributions, and its dialogs. */
export function useProjectActions(opts: { onRename?: (id: string) => void; afterDelete?: () => void } = {}) {
  const t = useT('projects')
  const me = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [coverFor, setCoverFor] = useState<Project | null>(null)

  const patch = async (p: Project, body: Record<string, unknown>, done?: string) => {
    try {
      const next = await api.patch<Project>(`/projects/${p.id}`, body)
      qc.setQueryData(qk.project(p.id), next)
      void qc.invalidateQueries({ queryKey: qk.projects })
      if (done) toast.done(done)
      return next
    } catch (err) {
      toast.error(err)
    }
  }

  const remove = async (p: Project) => {
    const ok = await confirm({
      title: t('confirmDelete.title', { name: p.name }),
      body: t(p.kind === 'brand' ? 'confirmDelete.kitBody' : 'confirmDelete.body'),
      confirm: t(p.kind === 'brand' ? 'confirmDelete.kitConfirm' : 'confirmDelete.confirm'),
      danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/projects/${p.id}`)
      void qc.invalidateQueries({ queryKey: qk.projects })
      void qc.invalidateQueries({ queryKey: qk.media() })
      toast.done(t('done.deleted', { name: p.name }))
      opts.afterDelete?.()
    } catch (err) {
      toast.error(err)
    }
  }

  const menu = (p: Project): MenuEntry[] => {
    const manage = can(me, 'projects.manage') && !me.viaShareLink
    return menuEntries('project', { project: p, me }, [
      {
        order: 0,
        items: [
          { label: t('menu.open'), icon: ArrowUpRight, onSelect: () => navigate(`/projects/${p.id}`) },
          manage &&
            opts.onRename && { label: t('menu.rename'), icon: Pencil, onSelect: () => opts.onRename?.(p.id) },
        ],
      },
      {
        order: 30,
        items: manage
          ? [
              { label: t('menu.cover'), icon: ImageIcon, onSelect: () => setCoverFor(p) },
              {
                label: t('menu.color'),
                icon: Palette,
                items: PROJECT_COLORS.map((c) => ({
                  label: (
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{
                          background: c.value ?? 'transparent',
                          boxShadow: c.value ? undefined : 'inset 0 0 0 1.5px var(--ink-3)',
                        }}
                      />
                      {t(c.label)}
                    </span>
                  ),
                  checked: (p.color ?? null) === c.value,
                  onSelect: () => void patch(p, { color: c.value }),
                })),
              },
            ]
          : [],
      },
      {
        order: 90,
        items: manage
          ? [
              p.archivedAt
                ? {
                    label: t('menu.unarchive'),
                    icon: ArchiveRestore,
                    onSelect: () =>
                      void patch(p, { archived: false }, t('done.unarchived', { name: p.name })),
                  }
                : {
                    label: t('menu.archive'),
                    icon: Archive,
                    onSelect: () => void patch(p, { archived: true }, t('done.archived', { name: p.name })),
                  },
            ]
          : [],
      },
      {
        order: 100,
        items: manage
          ? [{ label: t('menu.delete'), icon: Trash2, danger: true, onSelect: () => void remove(p) }]
          : [],
      },
    ])
  }

  const dialogs = (
    <MediaPicker
      open={!!coverFor}
      onOpenChange={(o) => !o && setCoverFor(null)}
      multiple={false}
      kinds={['image', 'video']}
      projectId={coverFor?.id ?? null}
      title={t('pickCover')}
      confirmLabel={t('useAsCover')}
      onPick={(items) => {
        const m = items[0]
        if (coverFor && m) void patch(coverFor, { coverMediaId: m.id }, t('done.cover'))
      }}
    />
  )

  return { menu, patch, remove, setCover: setCoverFor, dialogs }
}
