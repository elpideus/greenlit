import type { Media } from '@greenlit/shared'
import { Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useViewer } from '@/components/viewer/store'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { useSession } from '@/lib/session'
import { Button, Checkbox, Dialog, Textarea, toast } from '@/ui'
import { useAddNote, useDecide, useMediaNotes } from './api'

/**
 * "Ask for changes" is a checklist, never an empty complaint: the reviewer's open notes on this item (each pinned to
 * the frame), plus any change typed here. It cannot be sent with nothing ticked.
 */
export function AskForChanges({
  open,
  onOpenChange,
  media,
  requestId,
  editorName,
  onSent,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  media: Media
  requestId: string
  editorName: string
  onSent?: () => void
}) {
  const t = useT('review')
  const me = useSession()
  const { data: notes } = useMediaNotes(media.id)
  const add = useAddNote(media.id)
  const decide = useDecide()
  const time = useViewer((s) => s.time)
  const fps = useViewer((s) => s.fps)
  const formatId = useViewer((s) => s.formatId)
  const timed = media.kind === 'video' || media.kind === 'audio'
  const mine = (notes ?? [])
    .filter((n) => !n.parentId && n.status === 'open' && n.author.id === me.id)
    .sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9) || a.createdAt.localeCompare(b.createdAt))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) {
      setChecked(new Set(mine.map((n) => n.id)))
      setMessage('')
    }
  }, [open])

  const tc = (s: number) => formatTimecode(s, fps).replace(/:\d+$/, '')

  const addChange = async () => {
    const body = draft.trim()
    if (!body) return
    try {
      const n = await add.mutateAsync({ body, time: timed ? time : null, formatId })
      setChecked((c) => new Set([...c, n.id]))
      setDraft('')
    } catch (err) {
      toast.error(err)
    }
  }

  const picked = mine.filter((n) => checked.has(n.id))
  const send = async () => {
    if (!picked.length) return
    const list = picked
      .map((n) => `• ${n.time !== null && timed ? `${tc(n.time)} — ` : ''}${n.body}`)
      .join('\n')
    const note = message.trim() ? `${message.trim()}\n\n${list}` : list
    try {
      await decide.mutateAsync({ id: requestId, decision: 'changes_requested', note, mediaId: media.id })
      toast.done(t('decision.changesToast', { count: picked.length, name: editorName }))
      onOpenChange(false)
      onSent?.()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('ask.title')}
      description={t('ask.body', { name: editorName })}
      width={520}
      footer={
        <>
          {!picked.length && <span className="mr-auto t-caption text-ink-3">{t('ask.needOne')}</span>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="review"
            disabled={!picked.length}
            loading={decide.isPending}
            onClick={() => void send()}
            className="bg-review text-[#1b1302] shadow-none hover-device:hover:bg-[color-mix(in_oklab,var(--review),white_10%)]"
          >
            {t('ask.send', { count: picked.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 t-label">{t('ask.yours')}</div>
          <div className="overflow-hidden rounded-panel bg-well shadow-[inset_0_0_0_1px_var(--line)]">
            <AnimatePresence initial={false}>
              {mine.map((n) => {
                const on = checked.has(n.id)
                return (
                  <motion.label
                    key={n.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.22, ease }}
                    className="flex cursor-default items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0"
                  >
                    <Checkbox
                      checked={on}
                      onChange={(v) =>
                        setChecked((c) => {
                          const next = new Set(c)
                          v ? next.add(n.id) : next.delete(n.id)
                          return next
                        })
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn('t-body text-ink', !on && 'text-ink-3 line-through decoration-ink-4')}
                      >
                        {n.body}
                      </span>
                    </span>
                    {n.time !== null && timed && (
                      <span className="mt-0.5 shrink-0 rounded-[5px] bg-hover px-1.5 py-px t-meta text-ink-2">
                        {tc(n.time)}
                      </span>
                    )}
                  </motion.label>
                )
              })}
            </AnimatePresence>
            {mine.length === 0 && <div className="px-3 py-3 t-callout text-ink-3">{t('ask.none')}</div>}
            <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
              <Plus size={14} className="shrink-0 text-ink-3" />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addChange()
                  }
                }}
                placeholder={t('ask.add')}
                className="h-8 min-w-0 flex-1 bg-transparent t-callout text-ink outline-none placeholder:text-ink-3"
              />
              {draft && timed && (
                <span className="shrink-0 t-caption text-ink-3">{t('ask.addHint', { time: tc(time) })}</span>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 t-label">{t('ask.message')}</div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('ask.messagePlaceholder')}
            rows={2}
          />
        </div>
      </div>
    </Dialog>
  )
}
