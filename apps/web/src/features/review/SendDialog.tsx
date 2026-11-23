import type { Media } from '@greenlit/shared'
import { useQueries } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MediaThumb } from '@/components/MediaThumb'
import { PeoplePicker } from '@/components/PeoplePicker'
import { useDirectory } from '@/data/people'
import { api } from '@/lib/api'
import { useStoredState } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useTimeZone, zonedToInstant } from '@/lib/time'
import { Button, Dialog, Field, Input, Textarea, toast } from '@/ui'
import { useSendForReview } from './api'
import { useSendDialog } from './store'

/** "Send for review": who decides, what to look at, by when. Mounted once; opened with `openSendForReview(ids)`. */
export function SendDialogHost() {
  const t = useT('review')
  const tz = useTimeZone()
  const { ids, close } = useSendDialog()
  const send = useSendForReview()
  const { data: people } = useDirectory()
  const [last, setLast] = useStoredState<string[]>('review.lastReviewers', [])
  const [to, setTo] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [due, setDue] = useState('')
  const items = useQueries({
    queries: (ids ?? [])
      .slice(0, 6)
      .map((id) => ({ queryKey: qk.mediaItem(id), queryFn: () => api.get<Media>(`/media/${id}`) })),
  })

  useEffect(() => {
    if (!ids) return
    const known = new Set((people ?? []).map((p) => p.id))
    setTo(last.filter((id) => known.has(id)))
    setMessage('')
    setDue('')
  }, [ids])

  const names = (people ?? []).filter((p) => to.includes(p.id)).map((p) => p.displayName)
  const submit = async () => {
    if (!ids || !to.length) return
    let dueAt: string | null = null
    if (due) {
      const [y, m, d] = due.split('-').map(Number)
      dueAt = zonedToInstant({ year: y!, month: m! - 1, day: d!, hour: 18, minute: 0 }, tz).toISOString()
    }
    try {
      await send.mutateAsync({ mediaIds: ids, reviewerIds: to, message: message.trim(), dueAt })
      setLast(to)
      toast.done(
        ids.length > 1
          ? t('send.sentMany', { count: ids.length, names: names.join(', ') })
          : t('send.sent', { names: names.join(', ') }),
      )
      close()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Dialog
      open={!!ids}
      onOpenChange={(o) => !o && close()}
      title={ids && ids.length > 1 ? t('send.titleMany', { count: ids.length }) : t('send.title')}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Send}
            disabled={!to.length}
            loading={send.isPending}
            onClick={() => void submit()}
            kbd="mod+enter"
          >
            {t('send.send')}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        role="presentation"
      >
        {items.length > 0 && (
          <div className="flex gap-2">
            {items.map((q, i) =>
              q.data ? (
                <MediaThumb
                  key={q.data.id}
                  media={q.data}
                  className="aspect-video w-[84px]"
                  showDuration={false}
                />
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                <div key={i} className="skeleton aspect-video w-[84px] rounded-tile" />
              ),
            )}
            {ids && ids.length > 6 && (
              <div className="grid aspect-video w-[84px] place-items-center rounded-tile bg-hover t-meta text-ink-3">
                +{ids.length - 6}
              </div>
            )}
          </div>
        )}
        <Field label={t('send.to')}>
          {() => <PeoplePicker value={to} onChange={setTo} placeholder={t('send.toPlaceholder')} />}
        </Field>
        <Field label={t('send.message')}>
          {(id) => (
            <Textarea
              id={id}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('send.messagePlaceholder')}
              rows={3}
            />
          )}
        </Field>
        <Field label={t('send.due')}>
          {(id) => (
            <Input
              id={id}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-48 [color-scheme:inherit]"
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
