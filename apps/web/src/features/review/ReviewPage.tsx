import type { Media, ReviewRequest } from '@greenlit/shared'
import { useQueries } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { MediaThumb } from '@/components/MediaThumb'
import { browseState } from '@/components/viewer/browse'
import { Viewer } from '@/components/viewer/Viewer'
import { useMediaList } from '@/data/media'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useSession } from '@/lib/session'
import { formatDate, formatRelative, useTimeZone } from '@/lib/time'
import { Avatar, AvatarStack, Badge, EmptyState, Segmented, Signal, Skeleton, Tally, toneFor } from '@/ui'
import { useInbox, useReviews } from './api'
import { useReviewRoom } from './store'

type Filter = 'waiting' | 'changes' | 'greenlit' | 'decided'
interface Row {
  media: Media | undefined
  mediaId: string
  request: ReviewRequest | null
}

/**
 * The review room: what waits for a decision on the left, the full viewer (frame, notes, decision) on the right.
 * After a decision the next item opens by itself.
 */
export default function ReviewPage() {
  const t = useT('review')
  const me = useSession()
  const tz = useTimeZone()
  const phone = useIsPhone()
  const navigate = useNavigate()
  const admin = me.role === 'admin'
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useStoredState<Filter>(`review.filter.${me.role}`, 'waiting')
  const inbox = useInbox()
  const openReqs = useReviews('open')
  const closed = useReviews('closed')
  const changes = useMediaList(
    { status: 'changes_requested', sort: 'recent', limit: 100 },
    { enabled: filter === 'changes' },
  )
  const greenlit = useMediaList(
    { status: 'approved', sort: 'recent', limit: 100 },
    { enabled: filter === 'greenlit' },
  )

  const requests: ReviewRequest[] = useMemo(() => {
    if (filter === 'waiting') return (admin ? openReqs.data : inbox.data) ?? []
    if (filter === 'decided')
      return (closed.data ?? []).filter((r) => r.decisions.some((d) => d.reviewer.id === me.id))
    return []
  }, [filter, admin, openReqs.data, inbox.data, closed.data, me.id])

  const mediaQueries = useQueries({
    queries: requests.map((r) => ({
      queryKey: qk.mediaItem(r.mediaId),
      queryFn: () => api.get<Media>(`/media/${r.mediaId}`),
      staleTime: 30_000,
    })),
  })

  const rows: Row[] = useMemo(() => {
    if (filter === 'changes' || filter === 'greenlit') {
      const list = (filter === 'changes' ? changes.data : greenlit.data)?.pages.flatMap((p) => p.items) ?? []
      const latest = new Map<string, ReviewRequest>()
      for (const r of closed.data ?? []) if (!latest.has(r.mediaId)) latest.set(r.mediaId, r)
      return list.map((m) => ({ media: m, mediaId: m.id, request: latest.get(m.id) ?? null }))
    }
    // one row per item (several requests for the same item: the newest)
    const seen = new Set<string>()
    return requests
      .filter((r) => {
        if (seen.has(r.mediaId)) return false
        seen.add(r.mediaId)
        return true
      })
      .map((r) => ({
        request: r,
        mediaId: r.mediaId,
        media: mediaQueries.find((q) => q.data?.id === r.mediaId)?.data,
      }))
  }, [filter, requests, mediaQueries, changes.data, greenlit.data, closed.data])

  const loading =
    filter === 'waiting'
      ? admin
        ? openReqs.isLoading
        : inbox.isLoading
      : filter === 'changes'
        ? changes.isLoading
        : filter === 'greenlit'
          ? greenlit.isLoading
          : closed.isLoading

  const selected = params.get('item')
  const select = (id: string | null) => {
    const next = new URLSearchParams()
    if (id) next.set('item', id)
    setParams(next, { replace: true })
  }

  // open the first item; after a decision, move to the next one
  useEffect(() => {
    if (phone || loading) return
    if (!selected && rows[0]) select(rows[0].mediaId)
  }, [rows, loading, phone])
  useEffect(() => {
    useReviewRoom.getState().set({
      advance: () => {
        const i = rows.findIndex((r) => r.mediaId === selected)
        const next = rows[i + 1] ?? rows[i - 1]
        if (next && next.mediaId !== selected) select(next.mediaId)
      },
    })
    return () => useReviewRoom.getState().set({ advance: null })
  }, [rows, selected])

  const filters = admin
    ? ([
        { value: 'waiting', label: t('waiting') },
        { value: 'changes', label: t('changes') },
        { value: 'greenlit', label: t('greenlit') },
      ] as const)
    : ([
        { value: 'waiting', label: t('waiting') },
        { value: 'decided', label: t('decided') },
      ] as const)
  const current: Filter = filters.some((f) => f.value === filter) ? filter : 'waiting'

  const empty = {
    waiting: admin
      ? [t('emptyAdminTitle'), t('emptyAdminBody')]
      : [t('emptyWaitingTitle'), t('emptyWaitingBody')],
    changes: [t('emptyChangesTitle'), t('emptyChangesBody')],
    greenlit: [t('emptyGreenlitTitle'), t('emptyGreenlitBody')],
    decided: [t('emptyDecidedTitle'), t('emptyDecidedBody')],
  }[current]

  const queue = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-5 pb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="t-title-2 text-ink">{admin ? t('title') : t('waitingForYou')}</h1>
          {current === 'waiting' && rows.length > 0 && (
            <span className="t-meta text-ink-3">{rows.length}</span>
          )}
        </div>
        <Segmented<Filter>
          size="sm"
          value={current}
          onChange={setFilter}
          options={[...filters]}
          className="mt-3"
          stretch
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex flex-col gap-1 px-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 py-2">
                <Skeleton className="aspect-video w-[104px] rounded-[7px]" />
                <div className="flex-1 pt-1">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 pt-14 text-center">
            <Signal tone={current === 'waiting' && !admin ? 'greenlit' : 'draft'} size={44} />
            <div className="mt-5 t-headline text-ink">{empty[0]}</div>
            <div className="mt-1.5 t-callout text-ink-3">{empty[1]}</div>
          </div>
        ) : (
          rows.map((row, i) => (
            <motion.div key={row.mediaId} {...stagger(i)}>
              <QueueRow
                row={row}
                active={row.mediaId === selected}
                onOpen={() =>
                  phone
                    ? navigate(`/media/${row.mediaId}`, {
                        state: browseState({ ids: rows.map((r) => r.mediaId) }),
                      })
                    : select(row.mediaId)
                }
                tz={tz}
              />
            </motion.div>
          ))
        )}
      </div>
    </div>
  )

  if (phone) return <div className="min-h-[calc(100dvh-var(--bar-h)-var(--tabbar-h))]">{queue}</div>

  return (
    <div className="flex h-[calc(100dvh-var(--bar-h))] min-h-0 border-t border-line">
      <aside className="w-[340px] shrink-0 border-r border-line bg-canvas">{queue}</aside>
      <div className="min-w-0 flex-1">
        {selected ? (
          <Viewer key={selected} mediaId={selected} embedded />
        ) : (
          <div className="force-dark grid h-full place-items-center bg-stage">
            <EmptyState compact title={t('pick')} />
          </div>
        )}
      </div>
    </div>
  )
}

function QueueRow({
  row,
  active,
  onOpen,
  tz,
}: {
  row: Row
  active: boolean
  onOpen: () => void
  tz: string
}) {
  const t = useT('review')
  const { media, request } = row
  const overdue =
    request?.dueAt && request.status === 'open' && new Date(request.dueAt).getTime() < Date.now()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'press group flex w-full gap-3 rounded-[10px] px-2 py-2 text-left transition-colors duration-150',
        active
          ? 'bg-hover shadow-[inset_0_0_0_1px_var(--line-strong)]'
          : 'hover-device:hover:bg-[color-mix(in_oklab,var(--hover)_60%,transparent)]',
      )}
    >
      {media ? (
        <MediaThumb media={media} className="aspect-video w-[104px] shrink-0 rounded-[7px]" scrub />
      ) : (
        <Skeleton className="aspect-video w-[104px] shrink-0 rounded-[7px]" />
      )}
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex items-center gap-1.5">
          {media && <Tally tone={toneFor(media.status)} size={7} />}
          <span className="truncate t-callout font-[550] text-ink">
            {media?.title || t('common:untitled')}
          </span>
        </span>
        {request && (
          <span className="mt-1 flex items-center gap-1.5 t-caption text-ink-3">
            {request.status === 'open' ? (
              <>
                <Avatar user={request.requestedBy} size={14} />
                <span className="truncate">
                  {t('from', { name: request.requestedBy.displayName.split(' ')[0] })} ·{' '}
                  {formatRelative(request.createdAt, tz)}
                </span>
              </>
            ) : (
              <>
                <AvatarStack users={request.reviewers} size={14} />
                <span className="truncate">
                  {formatRelative(request.decisions.at(-1)?.at ?? request.createdAt, tz)}
                </span>
              </>
            )}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {request?.dueAt && request.status === 'open' && (
            <Badge tone={overdue ? 'cut' : 'neutral'}>
              {overdue
                ? t('overdue')
                : t('due', { date: formatDate(request.dueAt, tz, { weekday: 'short', day: 'numeric' }) })}
            </Badge>
          )}
          {media && media.openCommentCount > 0 && <Badge tone="review">{media.openCommentCount}</Badge>}
        </span>
      </span>
    </button>
  )
}
