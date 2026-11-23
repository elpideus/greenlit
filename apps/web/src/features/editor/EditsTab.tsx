import type { Project } from '@greenlit/shared'
import { Clapperboard, Copy, ExternalLink, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { menuEntries } from '@/app/registry'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { useCan, useSession } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import {
  Button,
  confirm,
  EmptyState,
  IconButton,
  InlineEdit,
  openContextMenu,
  Skeleton,
  toast,
  useContextMenu,
} from '@/ui'
import { type CompositionView, useCompositionActions, useCompositions } from './api'
import { AspectBox } from './components/AspectBox'
import { openNewEdit } from './NewEdit'

/** A project's editing projects ("Edits" tab on the project page). */
export function EditsTab({ project }: { project: Project }) {
  const t = useT('editor')
  const canEdit = useCan('compositions.edit')
  const { data, isLoading } = useCompositions(project.id)
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="t-callout text-ink-3">{data ? t('edits.count', { count: data.length }) : ''}</div>
        {canEdit && (
          <Button variant="secondary" icon={Plus} onClick={() => openNewEdit({ projectId: project.id })}>
            {t('edits.new')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Grid>
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i}>
              <Skeleton className="aspect-video rounded-tile" />
              <Skeleton className="mt-2.5 h-3.5 w-1/2" />
            </div>
          ))}
        </Grid>
      ) : !data?.length ? (
        <EmptyState
          icon={Clapperboard}
          title={t('edits.empty')}
          body={t('edits.emptyBody')}
          action={
            canEdit ? (
              <Button variant="primary" icon={Plus} onClick={() => openNewEdit({ projectId: project.id })}>
                {t('edits.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Grid>
          {data.map((c, i) => (
            <motion.div key={c.id} {...stagger(i)}>
              <EditCard c={c} />
            </motion.div>
          ))}
        </Grid>
      )}
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-6">{children}</div>
  )
}

export function useCompositionMenu(c: CompositionView, onRename: () => void) {
  const t = useT('editor')
  const me = useSession()
  const navigate = useNavigate()
  const canEdit = useCan('compositions.edit')
  const { duplicate, remove } = useCompositionActions()
  return () =>
    menuEntries('composition', { composition: c, me }, [
      {
        order: 0,
        items: [
          { label: t('edits.open'), icon: ExternalLink, onSelect: () => navigate(`/edit/${c.id}`) },
          canEdit && { label: t('common:rename'), icon: Pencil, onSelect: onRename },
        ],
      },
      {
        order: 80,
        items: [
          canEdit && {
            label: t('edits.duplicate'),
            icon: Copy,
            onSelect: async () => {
              try {
                await duplicate.mutateAsync(c.id)
                toast.done(t('edits.duplicated', { name: c.name }))
              } catch (err) {
                toast.error(err)
              }
            },
          },
        ],
      },
      {
        order: 100,
        items: [
          canEdit && {
            label: t('common:delete'),
            icon: Trash2,
            danger: true,
            onSelect: async () => {
              if (
                !(await confirm({
                  title: t('edits.deleteConfirm', { name: c.name }),
                  body: t('edits.deleteBody'),
                  confirm: t('common:delete'),
                  danger: true,
                }))
              )
                return
              try {
                await remove.mutateAsync(c.id)
                toast.done(t('edits.deleted', { name: c.name }))
              } catch (err) {
                toast.error(err)
              }
            },
          },
        ],
      },
    ])
}

function EditCard({ c }: { c: CompositionView }) {
  const t = useT('editor')
  const tz = useTimeZone()
  const navigate = useNavigate()
  const canEdit = useCan('compositions.edit')
  const { rename } = useCompositionActions()
  const [renaming, setRenaming] = useState(false)
  const items = useCompositionMenu(c, () => setRenaming(true))
  const menu = useContextMenu(items)
  const doc = c.document
  const clips = doc.tracks.reduce((n, tr) => n + tr.clips.length, 0)
  return (
    <div {...menu} className="group">
      <button
        type="button"
        onClick={() => navigate(`/edit/${c.id}`)}
        className="press relative block aspect-video w-full overflow-hidden rounded-tile bg-stage text-left shadow-[inset_0_0_0_1px_var(--line)]"
      >
        {c.posterUrl ? (
          <img
            src={c.posterUrl}
            alt=""
            className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025]"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[#5c605d]">
            <Clapperboard size={22} strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-2 pt-8">
          <span className="flex items-center gap-1">
            {doc.formats.map((f) => (
              <span
                key={f.id}
                className="force-dark flex items-center gap-1 rounded-[5px] bg-black/50 px-1.5 py-0.5 t-meta text-[10.5px] text-white/90 backdrop-blur-md"
              >
                <AspectBox w={f.width} h={f.height} size={10} active />
                {f.name}
              </span>
            ))}
          </span>
          <span className="force-dark rounded-[5px] bg-black/55 px-1.5 py-px t-meta text-[11px] text-white/95 backdrop-blur-md">
            {formatDuration(doc.duration)}
          </span>
        </div>
        <span className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            size="sm"
            variant="overlay"
            icon={MoreHorizontal}
            label={t('common:more')}
            tooltip={false}
            onClick={(e) => {
              e.stopPropagation()
              openContextMenu(e.clientX, e.clientY, items())
            }}
          />
        </span>
      </button>
      <div className="mt-2 flex items-center gap-2">
        <InlineEdit
          value={c.name}
          editing={renaming}
          onEditingChange={setRenaming}
          disabled={!canEdit}
          onSave={(name) => rename.mutate({ id: c.id, name })}
          className={cn('min-w-0 flex-1 t-callout font-[550] text-ink')}
        />
      </div>
      <div className="mt-0.5 t-caption text-ink-3">
        {t('edits.updated', { when: formatRelative(c.updatedAt, tz) })} · {t('edits.clips', { count: clips })}
      </div>
    </div>
  )
}
