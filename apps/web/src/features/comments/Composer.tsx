import type { CommentTargetType, Media } from '@greenlit/shared'
import { ArrowUp, Clock, FileIcon, Image as ImageIcon, Paperclip, PenLine, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { MediaPicker } from '@/components/MediaPicker'
import { useViewer } from '@/components/viewer/store'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import { shortcutLabel } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { filesFromClipboard, upload } from '@/lib/uploads'
import { Chip, IconButton, Menu, ProgressRing, Textarea, toast } from '@/ui'
import { useNoteActions } from './api'
import { useNotesUi } from './store'

type Attachment =
  | { kind: 'media'; mediaId: string; title: string; thumb: string | null }
  | {
      kind: 'file'
      key: string
      id: string | null
      name: string
      mime: string
      preview: string | null
      progress: number
    }

/**
 * Writing a note. On a picture or video, clicking the frame first pins it (the chip shows where and when); a video
 * note without a pin still carries the current moment unless that chip is removed. Attach library media, files from
 * the device, or paste pictures. ⌘↵ sends.
 */
export function Composer({
  targetType,
  targetId,
  formatId,
  timed,
  pinnable,
  parentId,
  autoFocus,
  onSent,
  compact,
}: {
  targetType: CommentTargetType
  targetId: string
  formatId?: string | null
  timed?: boolean
  pinnable?: boolean
  parentId?: string
  autoFocus?: boolean
  onSent?: (id: string) => void
  compact?: boolean
}) {
  const t = useT('comments')
  const { create } = useNoteActions(targetType, targetId)
  const [body, setBody] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [withTime, setWithTime] = useState(true)
  const [picking, setPicking] = useState(false)
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const draft = useViewer((s) => (pinnable ? s.draft : null))
  const time = useViewer((s) => Math.floor(s.time))
  const fps = useViewer((s) => s.fps)
  const setViewer = useViewer((s) => s.set)
  const focus = useNotesUi((s) => s.focus)
  const drawing = useNotesUi((s) => s.drawing)
  const setUi = useNotesUi((s) => s.set)

  useEffect(() => {
    if (focus && pinnable && !parentId) area.current?.focus()
  }, [focus])

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      setAtts((a) => [
        ...a,
        {
          kind: 'file',
          key,
          id: null,
          name: file.name || 'Pasted picture',
          mime: file.type,
          preview,
          progress: 0,
        },
      ])
      void upload(file, { purpose: 'comment.attachment', label: file.name || 'Pasted picture' })
        .then((res) => {
          const id = (res as { id: string }).id
          setAtts((a) => a.map((x) => (x.kind === 'file' && x.key === key ? { ...x, id, progress: 1 } : x)))
        })
        .catch((err) => {
          toast.error(err)
          setAtts((a) => a.filter((x) => !(x.kind === 'file' && x.key === key)))
        })
    }
  }

  const uploading = atts.some((a) => a.kind === 'file' && !a.id)
  const canSend = (body.trim().length > 0 || atts.length > 0) && !uploading && !create.isPending

  const send = async () => {
    if (!canSend) return
    const pin = draft ? { point: draft.point, region: draft.region, strokes: draft.strokes } : null
    const noteTime = draft ? draft.time : timed && withTime && !parentId ? useViewer.getState().time : null
    try {
      const note = await create.mutateAsync({
        body: body.trim() || atts.map((a) => (a.kind === 'media' ? a.title : a.name)).join(', '),
        parentId: parentId ?? null,
        formatId: formatId ?? null,
        pin: parentId ? null : pin,
        time: parentId ? null : noteTime,
        frame: parentId || noteTime === null ? null : Math.round(noteTime * (fps || 30)),
        attachments: atts.map((a) =>
          a.kind === 'media'
            ? { kind: 'media' as const, mediaId: a.mediaId, formatId: null }
            : { kind: 'file' as const, id: a.id! },
        ),
      })
      setBody('')
      setAtts([])
      setWithTime(true)
      if (!parentId) {
        setViewer({ draft: null, activeNote: note.id })
        setUi({ drawing: false })
      }
      onSent?.(note.id)
    } catch (err) {
      toast.error(err)
    }
  }

  const pinLabel = draft
    ? [
        draft.time !== null ? formatTimecode(draft.time, fps).replace(/:\d+$/, '') : null,
        draft.strokes.length ? t('drawing') : draft.region ? t('area') : t('pinned'),
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div className={cn(compact ? '' : 'border-t border-line bg-panel px-4 pt-3 pb-4')}>
      <div
        className={cn(
          'rounded-[12px] bg-well shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-150',
          focused && 'shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
        )}
      >
        <AnimatePresence initial={false}>
          {(pinLabel || (timed && !parentId) || atts.length > 0) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
                {pinLabel ? (
                  <Chip active icon={Clock} onRemove={() => setViewer({ draft: null })}>
                    {pinLabel}
                  </Chip>
                ) : timed && !parentId ? (
                  withTime ? (
                    <Chip icon={Clock} onRemove={() => setWithTime(false)}>
                      {t('at', { time: formatTimecode(time, fps).replace(/:\d+$/, '') })}
                    </Chip>
                  ) : (
                    <Chip icon={Clock} onClick={() => setWithTime(true)}>
                      {t('noTime')}
                    </Chip>
                  )
                ) : null}
                {atts.map((a, i) => (
                  <span
                    key={a.kind === 'media' ? a.mediaId : a.key}
                    className="relative inline-flex h-6 items-center gap-1.5 rounded-tag bg-hover pr-1 pl-1 t-caption text-ink-2"
                  >
                    {a.kind === 'media' ? (
                      a.thumb ? (
                        <img src={a.thumb} alt="" className="size-4 rounded-[3px] object-cover" />
                      ) : (
                        <ImageIcon size={12} />
                      )
                    ) : a.preview ? (
                      <img src={a.preview} alt="" className="size-4 rounded-[3px] object-cover" />
                    ) : (
                      <FileIcon size={12} />
                    )}
                    <span className="max-w-[140px] truncate">{a.kind === 'media' ? a.title : a.name}</span>
                    {a.kind === 'file' && !a.id ? (
                      <ProgressRing
                        value={0.5}
                        size={12}
                        className="animate-[gl-spin_1s_linear_infinite] text-signal"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}
                        className="press grid size-4 place-items-center rounded-[3px] text-ink-3 hover:bg-press hover:text-ink"
                        aria-label="Remove"
                      >
                        <X size={11} strokeWidth={2.2} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <Textarea
          ref={area}
          value={body}
          autoFocus={autoFocus}
          rows={compact ? 1 : 2}
          maxRows={10}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            const files = filesFromClipboard(e)
            if (files.length) {
              e.preventDefault()
              addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
            if (e.key === 'Escape' && draft) setViewer({ draft: null })
          }}
          placeholder={parentId ? t('placeholderReply') : draft ? t('placeholderPin') : t('placeholder')}
          className="bg-transparent shadow-none hover-device:hover:shadow-none focus:bg-transparent focus:shadow-none"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <Menu
            side="top"
            align="start"
            trigger={<IconButton icon={Paperclip} label={t('attach')} size="sm" tooltip="top" />}
            items={[
              { label: t('fromLibrary'), icon: ImageIcon, onSelect: () => setPicking(true) },
              { label: t('fromDevice'), icon: Upload, onSelect: () => fileInput.current?.click() },
            ]}
          />
          {pinnable && !parentId && (
            <IconButton
              icon={PenLine}
              label={t('draw')}
              size="sm"
              tooltip="top"
              active={drawing || undefined}
              onClick={() => setUi({ drawing: !drawing })}
            />
          )}
          <span className="flex-1 truncate px-1 t-caption text-ink-4">
            {pinnable && !parentId && !draft && !body
              ? t('pinHint')
              : focused
                ? t('sendHint', { key: shortcutLabel('mod+enter') })
                : ''}
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={t('send')}
            className="press grid size-7 place-items-center rounded-full bg-signal text-signal-ink transition-opacity duration-150 disabled:opacity-25"
          >
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        onPick={(items: Media[]) =>
          setAtts((a) => [
            ...a,
            ...items.map((m) => ({
              kind: 'media' as const,
              mediaId: m.id,
              title: m.title || 'Untitled',
              thumb: m.thumbnailUrl,
            })),
          ])
        }
        title={t('fromLibrary').replace('…', '')}
      />
    </div>
  )
}
