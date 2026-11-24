import type { UserRef } from '@greenlit/shared'
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowUpRight, ChevronDown, Square } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { canStop, isRunning, stopTask, type TaskView } from '@/app/Activity'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useIsPhone } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { useSession } from '@/lib/session'
import { formatDateTime, formatRelative, useTimeZone } from '@/lib/time'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Page,
  PageHeader,
  ProgressBar,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  Tally,
  type Tone,
} from '@/ui'

type Filter = 'all' | 'active' | 'done' | 'failed' | 'cancelled'
const FILTERS: Filter[] = ['all', 'active', 'done', 'failed', 'cancelled']

interface HistoryPage {
  items: TaskView[]
  next: string | null
  counts: Record<Filter, number>
  kinds: { kind: string; count: number }[]
  people: UserRef[]
}

const PAGE = 50

/** Where a task's item opens. */
const linkOf = (task: TaskView) => {
  if (!task.entityId) return null
  switch (task.entityType) {
    case 'media':
      return `/media/${task.entityId}`
    case 'composition':
      return `/edit/${task.entityId}`
    case 'post':
      return `/posts/${task.entityId}`
    case 'project':
      return `/projects/${task.entityId}`
    default:
      return null
  }
}

const toneOf = (state: TaskView['state']): Tone =>
  state === 'queued' ? 'review' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'draft' : 'greenlit'

/** 12 s, 4 min, 1 h 20 min: the same in English and Italian. */
function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/**
 * Every background task, newest first: processing, depth maps, exports, publishing, archival. Filter by state, kind
 * or title; tasks that wait or run can be stopped (by whoever started them, or an admin). Progress follows live.
 */
export default function ActivityPage() {
  const t = useT('activity')
  const tz = useTimeZone()
  const phone = useIsPhone()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as string[]).includes(params.get('state') ?? '')
    ? (params.get('state') as Filter)
    : 'all'
  const kind = params.get('kind') ?? ''
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDeferredValue(search.trim())
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the search writes the q parameter
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) set('q', q)
  }, [q])

  const filters = { state: filter === 'all' ? undefined : filter, kind: kind || undefined, q: q || undefined }
  const key = qk.taskHistory(filters)
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api.get<HistoryPage>('/tasks/history', { ...filters, limit: PAGE, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })

  // Progress several times a second: the rows on the page follow it in place; a new task, or one that changed
  // state, refetches the list (at most every couple of seconds).
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (soon.current && clearTimeout(soon.current)), [])
  useTopic<TaskView>('tasks', (msg) => {
    const task = msg.data
    if (!task?.id) return
    let found = false
    let moved = false
    qc.setQueryData<InfiniteData<HistoryPage>>(key, (d) =>
      d
        ? {
            ...d,
            pages: d.pages.map((p) => ({
              ...p,
              items: p.items.map((x) => {
                if (x.id !== task.id) return x
                found = true
                if (x.state !== task.state) moved = true
                return { ...x, ...task }
              }),
            })),
          }
        : d,
    )
    if ((found && !moved) || soon.current) return
    soon.current = setTimeout(() => {
      soon.current = null
      void qc.invalidateQueries({ queryKey: qk.taskHistory().slice(0, 1) })
    }, 1500)
  })

  const first = list.data?.pages[0]
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const people = useMemo(
    () => new Map(list.data?.pages.flatMap((p) => p.people).map((u) => [u.id, u]) ?? []),
    [list.data],
  )
  const kindLabel = (k: string) => t(`kind.${k}`, { defaultValue: k })
  // A kind or a search narrows the list (and can be cleared); a tab alone just picks the state.
  const narrowed = !!(kind || q)
  const empty = narrowed ? 'emptyFiltered' : filter === 'active' ? 'emptyRunning' : 'empty'

  return (
    <Page width="text">
      <PageHeader
        title={t('title')}
        meta={
          first ? (
            <span className="tabular">
              {t('meta', { count: first.counts.all })}
              {first.counts.active > 0 && ` · ${t('running', { count: first.counts.active })}`}
            </span>
          ) : (
            <span className="opacity-0">—</span>
          )
        }
        className="mb-3"
      />
      <div className="material-bar sticky top-[var(--bar-h)] z-30 -mx-[var(--gutter)] mb-4 px-[var(--gutter)] pt-1 pb-2.5">
        <Tabs
          value={filter}
          onChange={(v) => set('state', v === 'all' ? '' : v)}
          tabs={FILTERS.map((f) => ({ value: f, label: t(`tab.${f}`), count: first?.counts[f] ?? null }))}
          className="mb-2 overflow-x-auto overflow-y-hidden pb-px [scrollbar-width:none]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('search')}
            className={cn('min-w-0 flex-1', phone ? 'basis-full' : 'max-w-[320px]')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (search) setSearch('')
                else e.currentTarget.blur()
              }
            }}
          />
          <Select
            value={kind || 'all'}
            onChange={(v) => set('kind', v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: t('kinds') },
              ...(first?.kinds ?? []).map((k) => ({
                value: k.kind,
                label: kindLabel(k.kind),
                hint: k.count,
              })),
            ]}
            className={phone ? 'flex-1' : 'w-[200px]'}
            align="end"
          />
        </div>
      </div>

      {list.isLoading ? (
        <Card>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 py-3.5">
              <Skeleton className="mt-1 size-2 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
            </div>
          ))}
        </Card>
      ) : list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : !items.length ? (
        <EmptyState
          icon={Activity}
          title={t(empty)}
          body={t(`${empty}Body`)}
          action={
            narrowed ? (
              <Button
                onClick={() => {
                  setSearch('')
                  setParams(new URLSearchParams(), { replace: true })
                }}
              >
                {t('clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card padded={false}>
            {items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                who={task.createdBy ? (people.get(task.createdBy) ?? null) : null}
                kind={kindLabel(task.kind)}
                tz={tz}
              />
            ))}
          </Card>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t('more')}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  )
}

function TaskRow({ task, who, kind, tz }: { task: TaskView; who: UserRef | null; kind: string; tz: string }) {
  const t = useT('activity')
  const me = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const running = isRunning(task)
  const link = linkOf(task)
  const took = Date.parse(task.updatedAt) - Date.parse(task.createdAt)
  const result =
    task.result === null || task.result === undefined ? null : JSON.stringify(task.result, null, 2)
  const meta = [
    kind,
    task.createdBy ? t('by', { name: who?.displayName ?? '—' }) : t('byGreenlit'),
    formatRelative(task.createdAt, tz),
    running
      ? task.state === 'running' && t('for', { time: duration(Date.now() - Date.parse(task.createdAt)) })
      : task.state === 'done' && t('took', { time: duration(took) }),
  ].filter(Boolean)

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="press -m-1 flex min-w-0 flex-1 items-start gap-3 rounded-control p-1 text-left hover-device:hover:bg-hover"
        >
          <Tally tone={toneOf(task.state)} size={8} pulse={running} className="mt-1.5" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate t-callout font-[550] text-ink">{task.title}</span>
              <span className="shrink-0 t-meta text-ink-3">
                {task.state === 'running' ? `${Math.round(task.progress * 100)}%` : t(`state.${task.state}`)}
              </span>
            </span>
            <span className="mt-0.5 block t-caption text-ink-3">{meta.join(' · ')}</span>
            {task.state === 'failed' && task.error ? (
              <span className={cn('mt-1 block t-caption text-cut', !open && 'truncate')}>{task.error}</span>
            ) : (
              // A finished task's message is its last progress report ("Making the preview"): not shown.
              task.message &&
              task.state !== 'done' && (
                <span className={cn('mt-1 block t-caption text-ink-2', !open && 'truncate')}>
                  {task.message}
                </span>
              )
            )}
            {running && (
              <ProgressBar value={task.state === 'queued' ? null : task.progress} className="mt-2" />
            )}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.9}
            className={cn('mt-1 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {link && (
          <IconButton size="sm" icon={ArrowUpRight} label={t('open')} onClick={() => navigate(link)} />
        )}
        {canStop(me, task) && (
          <IconButton
            size="sm"
            icon={Square}
            label={t('stop')}
            disabled={stopping}
            onClick={async () => {
              setStopping(true)
              await stopTask(task)
              setStopping(false)
            }}
          />
        )}
      </div>
      {open && (
        <dl className="mt-2.5 ml-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 t-caption">
          <dt className="text-ink-3">{t('started')}</dt>
          <dd className="text-ink-2">{formatDateTime(task.createdAt, tz)}</dd>
          <dt className="text-ink-3">{t('updated')}</dt>
          <dd className="text-ink-2">{formatDateTime(task.updatedAt, tz)}</dd>
          <dt className="text-ink-3">{t('id')}</dt>
          <dd className="select-all break-all font-mono text-ink-2">{task.id}</dd>
          {result && (
            <>
              <dt className="text-ink-3">{t('result')}</dt>
              <dd>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control bg-well p-2 font-mono text-ink-2">
                  {result}
                </pre>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
