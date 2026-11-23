import type { Revision } from '@greenlit/shared'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, ChevronDown, Ellipsis, History as HistoryIcon, RotateCcw, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { useCan } from '@/lib/session'
import { formatDateTime, formatRelative, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Badge,
  Button,
  confirm,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Skeleton,
  Textarea,
  toast,
  useContextMenu,
} from '@/ui'

const PAGE = 40
/** Bookkeeping fields that say nothing to a person. */
const HIDDEN = new Set(['blobIds', 'deletedAt', 'position', 'updatedAt', 'createdAt', 'revision'])

/**
 * Every version of an item, newest first: who changed what and where from (Claude through MCP, a platform sync,
 * the API…). Versions can be named, annotated, compared with now, and restored (restoring is itself a new version).
 */
export function HistoryPanel({ type, id }: { type: string; id: string }) {
  const t = useT('history')
  const qc = useQueryClient()
  useLiveQuery(`${type}:${id}`, [qk.history(type, id)], ['revision.created', 'revision.updated'])
  const list = useInfiniteQuery({
    queryKey: qk.history(type, id),
    queryFn: ({ pageParam }) =>
      api.get<Revision[]>(`/history/${type}/${id}`, { limit: PAGE, before: pageParam ?? undefined }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === PAGE ? (last.at(-1)?.seq ?? null) : null),
  })
  const revisions = list.data?.pages.flat() ?? []
  const latest = revisions[0]?.seq ?? 0
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.history(type, id) })
    void qc.invalidateQueries({
      queryKey: [
        type === 'media'
          ? 'media'
          : type === 'post'
            ? 'posts'
            : type === 'composition'
              ? 'compositions'
              : type,
      ],
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-10">
      {list.isLoading ? (
        <div className="flex flex-col gap-4 p-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-6 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : revisions.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-3 grid size-11 place-items-center rounded-panel bg-hover text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <HistoryIcon size={20} strokeWidth={1.6} />
          </div>
          <div className="t-headline text-ink">{t('empty')}</div>
          <div className="mt-1 t-callout text-ink-3">{t('emptyBody')}</div>
        </div>
      ) : (
        <ol className="relative">
          <span className="absolute top-3 bottom-3 left-[23px] w-px bg-line" aria-hidden />
          {revisions.map((r) => (
            <RevisionRow
              key={r.id}
              type={type}
              id={id}
              rev={r}
              current={r.seq === latest}
              onChanged={refresh}
            />
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button
            size="sm"
            variant="ghost"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}

function SourceAvatar({ rev }: { rev: Revision }) {
  if (rev.source === 'mcp')
    return (
      <span
        className="grid size-6 place-items-center rounded-full bg-[#D97757] text-white shadow-[0_0_0_3px_var(--panel)]"
        title="Claude"
      >
        <Sparkles size={12} strokeWidth={2} />
      </span>
    )
  if (!rev.author)
    return (
      <span className="grid size-6 place-items-center rounded-full bg-raised text-ink-3 shadow-[0_0_0_3px_var(--panel),inset_0_0_0_1px_var(--line-strong)]">
        <HistoryIcon size={12} />
      </span>
    )
  return (
    <span className="rounded-full shadow-[0_0_0_3px_var(--panel)]">
      <Avatar user={rev.author} size={24} />
    </span>
  )
}

function RevisionRow({
  type,
  id,
  rev,
  current,
  onChanged,
}: {
  type: string
  id: string
  rev: Revision
  current: boolean
  onChanged: () => void
}) {
  const t = useT('history')
  const tz = useTimeZone()
  const canLabel = useCan('history.label')
  const canRestore = useCan('history.restore')
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const who = rev.source === 'mcp' ? t('claude') : (rev.author?.displayName ?? t('system'))
  const via = rev.source !== 'web' && rev.source !== 'mcp' ? t(`via.${rev.source}`) : ''

  const restore = async () => {
    if (
      !(await confirm({
        title: t('restoreConfirm', { n: rev.seq }),
        body: t('restoreBody'),
        confirm: t('restore'),
      }))
    )
      return
    try {
      await api.post(`/history/${type}/${id}/${rev.seq}/restore`)
      toast.done(t('restored', { n: rev.seq }))
      onChanged()
    } catch (err) {
      toast.error(err)
    }
  }
  const items = () =>
    [
      canLabel && {
        label: rev.name ? t('rename') : t('name'),
        icon: Bookmark,
        onSelect: () => setNaming(true),
      },
      { label: open ? t('hide') : t('show'), icon: ChevronDown, onSelect: () => setOpen((o) => !o) },
      canRestore && !current && 'separator',
      canRestore && !current && { label: t('restore'), icon: RotateCcw, onSelect: () => void restore() },
    ] as const
  const ctx = useContextMenu(() => [...items()])

  return (
    <li {...ctx} className="group relative">
      <div className={cn('relative flex gap-3 rounded-[10px] px-3 py-2.5', open && 'bg-hover')}>
        <div className="relative z-[1] pt-0.5">
          <SourceAvatar rev={rev} />
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          {rev.name && (
            <div className="mb-0.5 flex items-center gap-1.5 t-callout font-[600] text-ink">
              <Bookmark size={12} className="text-signal" fill="currentColor" />
              {rev.name}
            </div>
          )}
          <div className="t-callout text-ink-2">
            <span className="font-[550] text-ink">{who}</span>{' '}
            {via && <span className="text-ink-3">{via} · </span>}
            {rev.summary}
          </div>
          {rev.seq > 1 && rev.changed.filter((c) => !HIDDEN.has(c)).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {rev.changed
                .filter((c) => !HIDDEN.has(c))
                .map((c) => (
                  <span key={c} className="rounded-tag bg-hover px-1.5 py-px t-micro text-ink-3">
                    {t(`fields.${c}`, { defaultValue: c })}
                  </span>
                ))}
            </div>
          )}
          {rev.note && <div className="mt-1.5 t-caption text-ink-2 italic">{rev.note}</div>}
          <div
            className="mt-1 flex items-center gap-2 t-meta text-ink-4"
            title={formatDateTime(rev.createdAt, tz)}
          >
            v{rev.seq} · {formatRelative(rev.createdAt, tz)}
            {current && <Badge tone="signal">{t('current')}</Badge>}
          </div>
        </button>
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100">
          <Menu
            align="end"
            trigger={<IconButton icon={Ellipsis} label={t('common:more')} size="xs" tooltip={false} />}
            items={[...items()]}
          />
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <Compare type={type} id={id} rev={rev} current={current} />
            {canRestore && !current && (
              <div className="flex justify-end px-3 pb-3">
                <Button size="sm" icon={RotateCcw} onClick={() => void restore()}>
                  {t('restore')}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <NameDialog open={naming} onOpenChange={setNaming} type={type} id={id} rev={rev} onSaved={onChanged} />
    </li>
  )
}

function Compare({ type, id, rev, current }: { type: string; id: string; rev: Revision; current: boolean }) {
  const t = useT('history')
  const then = useQuery({
    queryKey: [...qk.history(type, id), 'seq', rev.seq],
    queryFn: () => api.get<Revision>(`/history/${type}/${id}/${rev.seq}`),
  })
  const latestSeq = useQuery({
    queryKey: [...qk.history(type, id), 'latest'],
    queryFn: async () => {
      const [head] = await api.get<Revision[]>(`/history/${type}/${id}`, { limit: 1 })
      return head ? api.get<Revision>(`/history/${type}/${id}/${head.seq}`) : null
    },
    enabled: !current,
  })
  if (then.isLoading) return <Skeleton className="mx-3 mb-3 h-16" />
  const a = then.data?.data ?? {}
  const b = latestSeq.data?.data ?? {}
  const keys = (rev.changed.length && rev.seq > 1 ? rev.changed : Object.keys(a)).filter(
    (k) => k in a && !HIDDEN.has(k),
  )
  return (
    <div className="mx-3 mb-3 flex flex-col gap-2.5 rounded-[10px] bg-well p-3 shadow-[inset_0_0_0_1px_var(--line)]">
      {keys.map((k) => {
        const differs = !current && JSON.stringify(a[k]) !== JSON.stringify(b[k])
        return (
          <div key={k}>
            <div className="t-micro text-ink-3">{t(`fields.${k}`, { defaultValue: k })}</div>
            <div className="mt-0.5 t-callout text-ink">{show(a[k])}</div>
            {differs && (
              <div className="mt-1 flex gap-1.5 t-caption text-ink-3">
                <span className="shrink-0">{t('now')}:</span>
                <span className="min-w-0 truncate">{show(b[k])}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function show(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-ink-4">—</span>
  if (typeof v === 'string') return <span className="line-clamp-4 whitespace-pre-wrap">{v}</span>
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string'))
      return v.length ? v.join(', ') : <span className="text-ink-4">—</span>
    const labels = v
      .map((x) =>
        x && typeof x === 'object'
          ? ((x as Record<string, unknown>).label ??
            (x as Record<string, unknown>).name ??
            (x as Record<string, unknown>).key)
          : null,
      )
      .filter(Boolean)
    return labels.length ? labels.join(', ') : `${v.length}`
  }
  return <span className="t-meta text-ink-3">{JSON.stringify(v).slice(0, 120)}</span>
}

function NameDialog({
  open,
  onOpenChange,
  type,
  id,
  rev,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  type: string
  id: string
  rev: Revision
  onSaved: () => void
}) {
  const t = useT('history')
  const [name, setName] = useState(rev.name ?? '')
  const [note, setNote] = useState(rev.note ?? '')
  const save = async () => {
    try {
      await api.patch(`/history/${type}/${id}/${rev.seq}`, {
        name: name.trim() || null,
        note: note.trim() || null,
      })
      toast.done(t('saved', { n: rev.seq }))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('nameTitle')}
      description={`v${rev.seq} · ${rev.summary}`}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('common:save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('nameTitle')}>
          {(fid) => (
            <Input
              id={fid}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          )}
        </Field>
        <Field label={t('note')}>
          {(fid) => (
            <Textarea
              id={fid}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

export function MediaHistory({ media }: { media: { id: string } }) {
  return <HistoryPanel type="media" id={media.id} />
}
export function PostHistory({ post }: { post: { id: string } }) {
  return <HistoryPanel type="post" id={post.id} />
}
export function CompositionHistory({ composition }: { composition: { id: string } }) {
  return <HistoryPanel type="composition" id={composition.id} />
}
