import type { Media, ReviewRequest } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Ellipsis, RotateCcw, Send, Undo2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { can, useSession } from '@/lib/session'
import { formatDate, formatRelative, useTimeZone } from '@/lib/time'
import { Button, IconButton, Menu, Signal, toast, toneFor } from '@/ui'
import { AskForChanges } from './AskForChanges'
import { useCancelReview, useDecide, useMediaNotes, useReviews } from './api'
import { openSendForReview, useReviewRoom } from './store'

const names = (xs: { displayName: string }[]) => xs.map((x) => x.displayName.split(' ')[0]).join(', ')

/**
 * The decision, above the viewer's panel: the signal lit for the item's state, who it waits for, and the one or two
 * actions that move it (Greenlight / Ask for changes for the reviewer; Send for review / Greenlight for the admin).
 */
export function Decision({ media }: { media: Media }) {
  const t = useT('review')
  const me = useSession()
  const tz = useTimeZone()
  const qc = useQueryClient()
  const { data: reviews } = useReviews('all', media.id)
  const { data: notes } = useMediaNotes(media.id)
  const decide = useDecide()
  const cancel = useCancelReview()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const admin = me.role === 'admin'

  const open = reviews?.find((r) => r.status === 'open') ?? null
  const latest = reviews?.[0] ?? null
  const myTurn =
    !!open &&
    open.reviewers.some((r) => r.id === me.id) &&
    !open.decisions.some((d) => d.reviewer.id === me.id)
  const pending = open
    ? open.reviewers.filter((r) => !open.decisions.some((d) => d.reviewer.id === r.id))
    : []
  const openNotes = (notes ?? []).filter((n) => !n.parentId && n.status === 'open').length
  const tone = toneFor(media.status)

  const afterDecision = () => setTimeout(() => useReviewRoom.getState().advance?.(), 750)

  const greenlight = async () => {
    setBusy(true)
    try {
      if (open) await decide.mutateAsync({ id: open.id, decision: 'approved', mediaId: media.id })
      else {
        await api.patch(`/media/${media.id}`, { status: 'approved' })
        void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
        void qc.invalidateQueries({ queryKey: qk.media() })
      }
      const who = open?.requestedBy.id !== me.id ? open?.requestedBy.displayName : null
      toast.done(t('decision.greenlitToast', { title: media.title || t('common:untitled') }), {
        description: who ? t('decision.greenlitToastBody', { name: who }) : undefined,
      })
      afterDecision()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: Media['status']) => {
    await api.patch(`/media/${media.id}`, { status })
    void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
    void qc.invalidateQueries({ queryKey: qk.media() })
  }

  let headline: string
  let meta: string | null = null
  let quote: string | null = null
  if (media.status === 'approved') {
    const approvers =
      latest?.status === 'approved'
        ? latest.decisions.filter((d) => d.decision === 'approved').map((d) => d.reviewer)
        : []
    headline = approvers.length
      ? t('decision.greenlitBy', { name: names(approvers) })
      : t('decision.greenlitDirect')
    const at = latest?.status === 'approved' ? latest.decisions.at(-1)?.at : null
    meta = at ? formatRelative(at, tz) : null
  } else if (media.status === 'changes_requested') {
    const d = latest?.decisions.find((x) => x.decision === 'changes_requested')
    headline = d
      ? t('decision.changesBy', { name: d.reviewer.displayName.split(' ')[0] })
      : t('common:status.changes_requested')
    // the changes sent are the request's bullet lines; the open notes say how many are still to do
    const sent = (d?.note ?? '').split('\n').filter((l) => l.startsWith('• ')).length
    meta = openNotes
      ? t('decision.changesOpen', { count: sent ? Math.min(sent, openNotes) : openNotes })
      : t('decision.allDone')
    quote = d?.note || null
  } else if (open) {
    headline = myTurn
      ? t('decision.waitingForYou')
      : t('decision.waitingFor', { names: names(pending.length ? pending : open.reviewers) })
    meta = [
      t('decision.sentBy', {
        name: open.requestedBy.id === me.id ? t('common:you') : open.requestedBy.displayName,
        when: formatRelative(open.createdAt, tz),
      }),
      open.dueAt
        ? t('due', { date: formatDate(open.dueAt, tz, { weekday: 'short', day: 'numeric', month: 'short' }) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ')
    quote = open.message || null
  } else {
    headline = t('decision.draft')
    meta = t('decision.draftBody')
  }

  const moreItems = [
    admin && open && { label: t('decision.decideForAll'), icon: Send, onSelect: () => void greenlight() },
    admin &&
      open && {
        label: t('decision.withdraw'),
        icon: Undo2,
        onSelect: () =>
          cancel
            .mutateAsync({ id: open.id, mediaId: media.id })
            .then(() => toast.done(t('decision.withdrawn'))),
      },
    admin &&
      !open &&
      media.status !== 'draft' && {
        label: t('decision.sendAgain'),
        icon: Send,
        onSelect: () => openSendForReview([media.id]),
      },
    can(me, 'media.status') &&
      !open &&
      media.status !== 'draft' && {
        label: t('decision.backToDraft'),
        icon: RotateCcw,
        onSelect: () => void setStatus('draft'),
      },
  ]
  const showMore = moreItems.some(Boolean)

  return (
    <div className="border-b border-line px-5 pt-4 pb-4">
      <div className="flex items-start gap-3.5">
        <Signal tone={tone} size={36} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <motion.div
            key={headline}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease }}
            className="t-headline text-ink"
          >
            {headline}
          </motion.div>
          {meta && (
            <div
              className={cn(
                'mt-0.5 t-caption',
                media.status === 'changes_requested' && openNotes ? 'text-review' : 'text-ink-3',
              )}
            >
              {meta}
            </div>
          )}
        </div>
        {showMore && (
          <Menu
            align="end"
            trigger={<IconButton icon={Ellipsis} label={t('common:more')} size="sm" />}
            items={moreItems}
          />
        )}
      </div>
      {quote && <Quote text={quote} />}
      {(myTurn || (admin && !open && media.status !== 'approved')) && (
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {myTurn ? (
            <Button variant="review" onClick={() => setAsking(true)}>
              {t('decision.askChanges')}
            </Button>
          ) : (
            <Button icon={Send} onClick={() => openSendForReview([media.id])}>
              {media.status === 'changes_requested' ? t('decision.sendAgain') : t('decision.sendForReview')}
            </Button>
          )}
          <Button variant="primary" loading={busy} onClick={() => void greenlight()}>
            {t('decision.greenlight')}
          </Button>
        </div>
      )}
      {open && myTurn && (
        <AskForChanges
          open={asking}
          onOpenChange={setAsking}
          media={media}
          requestId={open.id}
          editorName={open.requestedBy.displayName.split(' ')[0]!}
          onSent={afterDecision}
        />
      )}
    </div>
  )
}

function Quote({ text }: { text: string }) {
  const [more, setMore] = useState(false)
  const long = text.length > 160 || text.split('\n').length > 3
  return (
    <button
      type="button"
      onClick={() => long && setMore((m) => !m)}
      className={cn(
        'mt-3 block w-full rounded-[10px] bg-hover px-3 py-2 text-left t-callout text-ink-2 whitespace-pre-wrap',
        !more && long && 'line-clamp-3',
      )}
    >
      {text}
    </button>
  )
}

export type { ReviewRequest }
