import type { CommentAttachment, CommentTargetType } from '@greenlit/shared'
import {
  Check,
  Copy,
  CornerDownRight,
  Download,
  Ellipsis,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { useViewer } from '@/components/viewer/store'
import { cn } from '@/lib/cn'
import { formatBytes, formatTimecode } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Button,
  confirm,
  IconButton,
  Menu,
  type MenuEntry,
  Textarea,
  toast,
  useContextMenu,
} from '@/ui'
import { type Note, useNoteActions } from './api'
import { Composer } from './Composer'

/** Text with links made clickable; line breaks kept. */
function Body({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = []
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index))
    parts.push(
      <a
        key={m.index}
        href={m[0]}
        target="_blank"
        rel="noreferrer"
        className="text-signal underline decoration-signal/40 underline-offset-2 hover:decoration-signal"
      >
        {m[0].replace(/^https?:\/\//, '')}
      </a>,
    )
    last = m.index! + m[0].length
  }
  parts.push(text.slice(last))
  return <div className={cn('t-body break-words whitespace-pre-wrap', className)}>{parts}</div>
}

function Attachments({ items }: { items: CommentAttachment[] }) {
  if (!items.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) =>
        a.kind === 'media' ? (
          <Link
            key={`m${a.mediaId}`}
            to={`/media/${a.mediaId}`}
            className="press group flex w-[132px] flex-col overflow-hidden rounded-[9px] bg-well shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
          >
            <div className="aspect-video bg-stage">
              {a.thumbnailUrl && <img src={a.thumbnailUrl} alt="" className="size-full object-cover" />}
            </div>
            <div className="truncate px-2 py-1.5 t-caption text-ink-2 group-hover:text-ink">
              {a.title || 'Untitled'}
            </div>
          </Link>
        ) : a.thumbnailUrl || a.mime.startsWith('image/') ? (
          <a
            key={`f${a.id}`}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="press block overflow-hidden rounded-[9px] bg-stage shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <img src={a.thumbnailUrl ?? a.url} alt={a.name} className="h-[88px] max-w-[180px] object-cover" />
          </a>
        ) : (
          <a
            key={`f${a.id}`}
            href={`${a.url}?download=1&name=${encodeURIComponent(a.name)}`}
            className="press flex h-10 max-w-[240px] items-center gap-2 rounded-[9px] bg-well px-2.5 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
          >
            <Download size={14} className="shrink-0 text-ink-3" />
            <span className="min-w-0">
              <span className="block truncate t-caption text-ink">{a.name}</span>
              <span className="block t-meta text-[10.5px] text-ink-3">{formatBytes(a.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  )
}

/** The round "done" lamp: an empty ring that lights green when the request is done. */
function DoneLamp({
  done,
  onToggle,
  disabled,
  label,
}: {
  done: boolean
  onToggle: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={label}
      title={label}
      className={cn(
        'press relative grid size-[18px] shrink-0 place-items-center rounded-full transition-[box-shadow,background-color] duration-200',
        done ? 'bg-signal text-signal-ink' : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--ink-3)]',
        !disabled &&
          !done &&
          'hover-device:hover:text-ink-3 hover-device:hover:shadow-[inset_0_0_0_1.5px_var(--ink-2)]',
        disabled && 'cursor-default',
      )}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={String(done)}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring.lamp}
        >
          <Check size={11} strokeWidth={3.2} />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

export const NoteCard = forwardRef<
  HTMLDivElement,
  {
    note: Note
    index: number | null
    targetType: CommentTargetType
    targetId: string
    timed: boolean
    formatLabel?: string | null
    active?: boolean
  }
>(function NoteCard({ note, index, targetType, targetId, timed, formatLabel, active }, ref) {
  const t = useT('comments')
  const me = useSession()
  const tz = useTimeZone()
  const { edit, resolve, remove } = useNoteActions(targetType, targetId)
  const fps = useViewer((s) => s.fps)
  const set = useViewer((s) => s.set)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const done = note.status === 'done'
  const mine = note.author.id === me.id
  const canResolve = can(me, 'comments.resolve')
  const canModify = mine || can(me, 'comments.moderate')
  const replies = note.replies ?? []

  const activate = () => {
    set({ activeNote: note.id })
    if (note.time !== null) {
      const s = useViewer.getState()
      s.controls?.pause()
      s.controls?.seek(note.time)
    }
  }

  const items = (): MenuEntry[] => [
    canModify && { label: t('edit'), icon: Pencil, onSelect: () => setEditing(true) },
    canResolve && {
      label: done ? t('reopen') : t('markDone'),
      icon: done ? RotateCcw : Check,
      onSelect: () => resolve.mutate({ id: note.id, done: !done }),
    },
    { label: t('reply'), icon: CornerDownRight, onSelect: () => setReplying(true) },
    'separator',
    {
      label: t('copyLink'),
      icon: Copy,
      onSelect: async () => {
        const url = new URL(location.href)
        url.searchParams.set('tab', 'comments')
        url.searchParams.set('comment', note.id)
        if (note.time !== null) url.searchParams.set('t', String(Math.round(note.time * 100) / 100))
        await navigator.clipboard.writeText(url.toString())
        toast.done(t('linkCopied'))
      },
    },
    canModify && 'separator',
    canModify && {
      label: t('delete'),
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        if (
          await confirm({
            title: t('deleteConfirm'),
            body: t('deleteBody'),
            confirm: t('delete'),
            danger: true,
          })
        )
          remove.mutate(note.id)
      },
    },
  ]
  const ctx = useContextMenu(items)

  return (
    <div
      ref={ref}
      {...ctx}
      onMouseEnter={() => set({ hoverNote: note.id })}
      onMouseLeave={() => set({ hoverNote: null })}
      onClick={(e) => {
        // a click on the card (not on its buttons, links or editors) goes to the note's moment and pin
        if ((e.target as HTMLElement).closest('button, a, textarea, input, [role="menu"]')) return
        if (window.getSelection()?.toString()) return
        activate()
      }}
      onKeyDown={undefined}
      role="presentation"
      className={cn(
        'group relative rounded-[12px] px-3 py-3 transition-[background-color,box-shadow] duration-200',
        active
          ? 'bg-hover shadow-[inset_0_0_0_1px_var(--line-strong)]'
          : 'hover-device:hover:bg-[color-mix(in_oklab,var(--hover)_60%,transparent)]',
      )}
    >
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-2 pt-0.5">
          <Avatar user={note.author} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate t-callout font-[550] text-ink">
              {mine ? t('you') : note.author.displayName}
            </span>
            <span className="shrink-0 t-caption text-ink-4">{formatRelative(note.createdAt, tz)}</span>
            {note.editedAt && <span className="t-caption text-ink-4">· {t('edited')}</span>}
            <span className="flex-1" />
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100">
              <IconButton
                icon={CornerDownRight}
                label={t('reply')}
                size="xs"
                onClick={() => setReplying(true)}
              />
              <Menu
                align="end"
                trigger={<IconButton icon={Ellipsis} label={t('common:more')} size="xs" tooltip={false} />}
                items={items()}
              />
            </span>
            <DoneLamp
              done={done}
              disabled={!canResolve}
              onToggle={() => resolve.mutate({ id: note.id, done: !done })}
              label={done ? t('reopen') : t('markDone')}
            />
          </div>

          {(note.time !== null || note.pin || formatLabel) && (
            <button type="button" onClick={activate} className="press mt-1.5 flex items-center gap-1.5">
              {index !== null && (
                <span
                  className={cn(
                    'grid size-[18px] place-items-center rounded-full t-micro text-[10px] tabular',
                    done ? 'bg-signal text-signal-ink' : 'bg-review text-[#1b1302]',
                  )}
                >
                  {index}
                </span>
              )}
              {note.time !== null && timed && (
                <span className="rounded-[5px] bg-hover px-1.5 py-px t-meta text-[11px] text-ink-2 hover:text-ink">
                  {formatTimecode(note.time, fps).replace(/:\d+$/, '')}
                </span>
              )}
              {note.pin && !index && <MapPin size={12} className="text-ink-3" />}
              {formatLabel && (
                <span className="t-caption text-ink-3">{t('onFormat', { format: formatLabel })}</span>
              )}
            </button>
          )}

          {editing ? (
            <div className="mt-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={2} />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('common:cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!draft.trim()}
                  onClick={async () => {
                    await edit.mutateAsync({ id: note.id, body: draft.trim() })
                    setEditing(false)
                  }}
                >
                  {t('common:save')}
                </Button>
              </div>
            </div>
          ) : (
            <Body text={note.body} className={cn('mt-1.5 text-ink', done && 'text-ink-3')} />
          )}
          <Attachments items={note.attachments} />
          {done && note.resolvedBy && (
            <div className="mt-1.5 t-caption text-ok">
              {t('doneBy', { name: note.resolvedBy.id === me.id ? t('you') : note.resolvedBy.displayName })}
            </div>
          )}

          {replies.length > 0 && (
            <div className="mt-3 flex flex-col gap-3 border-l border-line pl-3">
              {replies.map((r) => (
                <div key={r.id} className="flex gap-2.5">
                  <Avatar user={r.author} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="t-caption font-[550] text-ink">
                        {r.author.id === me.id ? t('you') : r.author.displayName}
                      </span>
                      <span className="t-caption text-ink-4">{formatRelative(r.createdAt, tz)}</span>
                    </div>
                    <Body text={r.body} className="mt-0.5 text-[13.5px] text-ink-2" />
                    <Attachments items={r.attachments} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {replying && (
            <div
              className="mt-3"
              onKeyDown={(e) => e.key === 'Escape' && setReplying(false)}
              role="presentation"
            >
              <Composer
                targetType={targetType}
                targetId={targetId}
                parentId={note.id}
                compact
                autoFocus
                onSent={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
