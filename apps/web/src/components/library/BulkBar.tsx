import type { Media } from '@greenlit/shared'
import { CircleDot, Download, FolderInput, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Slot } from '@/app/Slot'
import { useProjects } from '@/data/projects'
import { useIsPhone } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import { Button, IconButton, Menu, Tally, toneFor } from '@/ui'
import type { useMediaActions } from './actions'
import { STATUSES } from './tokens'

/** Floats up from the bottom while anything is selected; acts on the whole selection. */
export function BulkBar({
  items,
  total,
  onSelectAll,
  onClear,
  actions,
  inTrash,
}: {
  items: Media[]
  total: number
  onSelectAll: () => void
  onClear: () => void
  actions: ReturnType<typeof useMediaActions>
  inTrash?: boolean
}) {
  const t = useT('browser')
  const tc = useT()
  const me = useSession()
  const phone = useIsPhone()
  const { data: projects } = useProjects()
  const ids = items.map((m) => m.id)
  const edit = can(me, 'media.edit') && !me.viaShareLink
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line-strong" />

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ y: 28, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
          transition={spring.sheet}
          className="fixed left-1/2 z-40 -translate-x-1/2"
          style={{ bottom: phone ? 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 12px)' : 24 }}
        >
          <div className="floating no-scrollbar flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto py-1.5 pr-1.5 pl-3.5">
            <span className="shrink-0 t-callout font-[550] text-ink tabular">
              {t('selection.selected', { count: items.length })}
            </span>
            {items.length < total && (
              <Button size="sm" variant="quiet" onClick={onSelectAll} className="shrink-0">
                {t('selection.selectAll')}
              </Button>
            )}
            {sep}
            {inTrash ? (
              can(me, 'media.delete') && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={() => void actions.restore(items)}
                  >
                    {t('menu.restore')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    icon={Trash2}
                    onClick={() => void actions.purge(items)}
                  >
                    {t('menu.purge')}
                  </Button>
                </>
              )
            ) : (
              <>
                {can(me, 'media.status') && (
                  <Menu
                    side="top"
                    trigger={
                      <Button size="sm" variant="ghost" icon={CircleDot}>
                        {!phone && t('menu.status')}
                      </Button>
                    }
                    items={STATUSES.map((s) => ({
                      label: (
                        <span className="flex items-center gap-2">
                          <Tally tone={toneFor(s)} size={7} />
                          {tc(`status.${s}`)}
                        </span>
                      ),
                      checked: items.every((m) => m.status === s),
                      onSelect: () => void actions.setStatus(items, s),
                    }))}
                  />
                )}
                {edit && (
                  <Menu
                    side="top"
                    trigger={
                      <Button size="sm" variant="ghost" icon={FolderInput}>
                        {!phone && t('menu.move')}
                      </Button>
                    }
                    items={[
                      { label: t('menu.noProject'), onSelect: () => void actions.move(items, null) },
                      'separator',
                      ...(projects ?? []).map((p) => ({
                        label: p.name,
                        checked: items.every((m) => m.projectId === p.id),
                        onSelect: () => void actions.move(items, p.id),
                      })),
                    ]}
                  />
                )}
                {edit && (
                  <Button size="sm" variant="ghost" icon={Tag} onClick={() => actions.openTags(items)}>
                    {!phone && t('menu.addTag').replace('…', '')}
                  </Button>
                )}
                <IconButton
                  size="sm"
                  icon={Download}
                  label={t('menu.downloadMany', { count: items.length })}
                  tooltip="top"
                  onClick={() => actions.download(items)}
                />
                <Slot name="media.bulk" props={{ ids, items, clear: onClear }} />
                {can(me, 'media.delete') && (
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    label={t('menu.trashMany', { count: items.length })}
                    tooltip="top"
                    onClick={() => void actions.trash(items)}
                    className="text-cut hover-device:hover:bg-cut-soft hover-device:hover:text-cut"
                  />
                )}
              </>
            )}
            {sep}
            <IconButton
              size="sm"
              icon={X}
              label={t('selection.clear')}
              shortcut="escape"
              tooltip="top"
              onClick={onClear}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
