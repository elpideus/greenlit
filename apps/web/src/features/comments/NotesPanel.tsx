import type { CommentTargetType, Media, MediaFormat } from '@greenlit/shared'
import { MessageSquareDashed } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewer } from '@/components/viewer/store'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { useCan } from '@/lib/session'
import { EmptyState, Segmented, Skeleton } from '@/ui'
import { type Note, useNotes } from './api'
import { Composer } from './Composer'
import { NoteCard } from './NoteCard'

/** Notes in reading order: by moment for timed media (untimed last), otherwise oldest first. */
export function orderNotes(notes: Note[], timed: boolean) {
  return [...notes].sort((a, b) => {
    if (timed) {
      const ta = a.time ?? Number.POSITIVE_INFINITY
      const tb = b.time ?? Number.POSITIVE_INFINITY
      if (ta !== tb) return ta - tb
    }
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** Stable numbers for pinned notes (shown on the card and on the frame). */
export function pinNumbers(notes: Note[], timed: boolean) {
  const map = new Map<string, number>()
  let n = 0
  for (const note of orderNotes(notes, timed)) if (note.pin) map.set(note.id, ++n)
  return map
}

type Filter = 'open' | 'done' | 'all'

export function NotesPanel({
  targetType,
  targetId,
  format,
  formats,
  timed = false,
  pinnable = false,
}: {
  targetType: CommentTargetType
  targetId: string
  format?: MediaFormat | null
  formats?: MediaFormat[]
  timed?: boolean
  pinnable?: boolean
}) {
  const t = useT('comments')
  const canWrite = useCan('comments.create')
  const { data: notes, isLoading } = useNotes(targetType, targetId)
  const active = useViewer((s) => s.activeNote)
  const [filter, setFilter] = useState<Filter | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLDivElement>())

  const all = notes ?? []
  const openCount = all.filter((n) => n.status === 'open').length
  const doneCount = all.length - openCount
  const current: Filter = filter ?? (openCount > 0 || all.length === 0 ? 'open' : 'all')
  const numbers = useMemo(() => pinNumbers(all, timed), [all, timed])
  const shown = orderNotes(
    all.filter((n) => current === 'all' || n.status === current),
    timed,
  )

  // the active note comes into view (and its filter with it)
  useEffect(() => {
    if (!active) return
    const note = all.find((n) => n.id === active)
    if (note && current !== 'all' && note.status !== current) setFilter('all')
    requestAnimationFrame(() =>
      cards.current.get(active)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    )
  }, [active, notes])

  const formatLabel = (id: string | null) => {
    if (!id || !formats || formats.length < 2 || id === format?.id) return null
    return formats.find((f) => f.id === id)?.label ?? null
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {all.length > 0 && (
        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
          <Segmented<Filter>
            size="sm"
            value={current}
            onChange={setFilter}
            options={[
              {
                value: 'open',
                label: t('open'),
                badge: openCount ? (
                  <span className="t-meta text-[10.5px] text-ink-3">{openCount}</span>
                ) : undefined,
              },
              {
                value: 'done',
                label: t('done'),
                badge: doneCount ? (
                  <span className="t-meta text-[10.5px] text-ink-3">{doneCount}</span>
                ) : undefined,
              },
              { value: 'all', label: t('all') },
            ]}
          />
        </div>
      )}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex flex-col gap-4 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="mt-2 h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            compact
            icon={MessageSquareDashed}
            title={t('emptyTitle')}
            body={pinnable ? (timed ? t('emptyVideo') : t('emptyPicture')) : t('emptyOther')}
            className="py-14"
          />
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center t-callout text-ink-3">{t('emptyFilter')}</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <AnimatePresence initial={false}>
              {shown.map((n) => (
                <motion.div
                  key={n.id}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.26, ease }}
                >
                  <NoteCard
                    ref={(el) => {
                      if (el) cards.current.set(n.id, el)
                      else cards.current.delete(n.id)
                    }}
                    note={n}
                    index={numbers.get(n.id) ?? null}
                    targetType={targetType}
                    targetId={targetId}
                    timed={timed}
                    formatLabel={formatLabel(n.formatId)}
                    active={active === n.id}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      {canWrite && (
        <div className="shrink-0">
          <Composer
            targetType={targetType}
            targetId={targetId}
            formatId={format?.id ?? null}
            timed={timed}
            pinnable={pinnable}
          />
        </div>
      )}
    </div>
  )
}

/** The Notes tab of the viewer. */
export function MediaNotes({ media, format }: { media: Media; format: MediaFormat }) {
  const timed = format.kind === 'video' || format.kind === 'audio'
  const pinnable = format.kind === 'video' || format.kind === 'image'
  return (
    <NotesPanel
      targetType="media"
      targetId={media.id}
      format={format}
      formats={media.formats}
      timed={timed}
      pinnable={pinnable}
    />
  )
}

export function CompositionNotes({ composition }: { composition: { id: string } }) {
  return <NotesPanel targetType="composition" targetId={composition.id} />
}

export function PostNotes({ post }: { post: { id: string } }) {
  return <NotesPanel targetType="post" targetId={post.id} />
}
