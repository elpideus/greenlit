import {
  type LinkableType,
  type LinkRelation,
  type Link as LinkT,
  type Media,
  LinkRelation as Relations,
} from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Clapperboard,
  File as FileIcon,
  FolderOpen,
  LayoutGrid,
  Link2,
  List,
  Megaphone,
  Plus,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MediaThumb } from '@/components/MediaThumb'
import { useMediaList } from '@/data/media'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useStoredState } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useLiveQuery } from '@/lib/realtime'
import { useCan } from '@/lib/session'
import {
  Button,
  Dialog,
  IconButton,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Spinner,
  toast,
  useContextMenu,
} from '@/ui'

const ICON = { media: FileIcon, project: FolderOpen, post: Megaphone, composition: Clapperboard }
export const hrefFor = (type: string, id: string) =>
  type === 'media'
    ? `/media/${id}`
    : type === 'project'
      ? `/projects/${id}`
      : type === 'post'
        ? `/posts/${id}`
        : `/edit/${id}`

/** Everything linked to an item, both directions, in plain words ("Made from", "Used in"). */
export function LinksPanel({ type, id }: { type: LinkableType; id: string }) {
  const t = useT('links')
  const qc = useQueryClient()
  const canManage = useCan('links.manage')
  const [adding, setAdding] = useState(false)
  useLiveQuery(`${type}:${id}`, [qk.links(type, id)], ['links.updated'])
  const { data, isLoading } = useQuery({
    queryKey: qk.links(type, id),
    queryFn: () => api.get<LinkT[]>('/links', { type, id }),
  })

  const groups = useMemo(() => {
    const map = new Map<string, { link: LinkT; other: LinkT['from'] }[]>()
    for (const l of data ?? []) {
      const forward = l.from.type === type && l.from.id === id
      const label = t(`relations.${l.relation}.${forward ? 'forward' : 'inverse'}`)
      const list = map.get(label) ?? []
      list.push({ link: l, other: forward ? l.to : l.from })
      map.set(label, list)
    }
    return [...map.entries()]
  }, [data, type, id, t])

  const linked = useMemo(
    () => new Set((data ?? []).map((l) => keyOf(l.from.type === type && l.from.id === id ? l.to : l.from))),
    [data, type, id],
  )

  const remove = async (l: LinkT) => {
    try {
      await api.delete(`/links/${l.id}`)
      toast.done(t('removed'))
      void qc.invalidateQueries({ queryKey: qk.links(type, id) })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-10">
      {isLoading ? (
        <div className="flex flex-col gap-2 p-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-3 grid size-11 place-items-center rounded-panel bg-hover text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <Link2 size={20} strokeWidth={1.6} />
          </div>
          <div className="t-headline text-ink">{t('empty')}</div>
          <div className="mt-1 t-callout text-ink-3">{t('emptyBody')}</div>
          {canManage && (
            <Button className="mt-5" size="sm" icon={Plus} onClick={() => setAdding(true)}>
              {t('add')}
            </Button>
          )}
        </div>
      ) : (
        <>
          {groups.map(([label, items]) => (
            <section key={label} className="mb-4">
              <div className="px-2 pb-1.5 t-micro text-ink-3">{label}</div>
              {items.map(({ link, other }, i) => (
                <motion.div key={link.id} {...stagger(i)}>
                  <LinkRow
                    link={link}
                    other={other}
                    canManage={canManage}
                    onRemove={() => void remove(link)}
                  />
                </motion.div>
              ))}
            </section>
          ))}
          {canManage && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)} className="ml-1">
              {t('add')}
            </Button>
          )}
        </>
      )}
      <AddLink
        open={adding}
        onOpenChange={setAdding}
        from={{ type, id }}
        linked={linked}
        onAdded={() => void qc.invalidateQueries({ queryKey: qk.links(type, id) })}
      />
    </div>
  )
}

function LinkRow({
  link,
  other,
  canManage,
  onRemove,
}: {
  link: LinkT
  other: LinkT['from']
  canManage: boolean
  onRemove: () => void
}) {
  const t = useT('links')
  const navigate = useNavigate()
  const Icon = ICON[other.type]
  const ctx = useContextMenu(() => [
    { label: t('common:open'), onSelect: () => navigate(hrefFor(other.type, other.id)) },
    canManage && 'separator',
    canManage && { label: t('remove'), icon: X, danger: true, onSelect: onRemove },
  ])
  return (
    <div {...ctx} className="group flex items-center gap-1 rounded-[10px] pr-1 hover:bg-hover">
      <button
        type="button"
        onClick={() => navigate(hrefFor(other.type, other.id))}
        className="press flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
      >
        <span className="relative grid aspect-video w-16 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-stage text-white/40">
          {other.thumbnailUrl ? (
            <img src={other.thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <Icon size={16} strokeWidth={1.6} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate t-callout text-ink">{other.title || t('common:untitled')}</span>
          <span className="block truncate t-caption text-ink-3">
            {t(`types.${other.type}`)}
            {link.note ? ` · ${link.note}` : ''}
            {link.auto ? ` · ${t('auto')}` : ''}
          </span>
        </span>
      </button>
      {canManage && (
        <IconButton
          icon={X}
          label={t('remove')}
          size="xs"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  )
}

type Candidate = {
  type: LinkableType
  id: string
  title: string
  thumbnailUrl: string | null
  meta?: string
  media?: Media
}
const keyOf = (c: { type: string; id: string }) => `${c.type}:${c.id}`

/**
 * Pick what to link, almost full window: media (the library's own list, so brand kits' files stay in their kit,
 * loaded as you scroll), projects, posts or edits, in a grid or a list. Several at once (click to add or take out,
 * Shift-click for a run), across the tabs; what is linked already is marked and left out.
 */
function AddLink({
  open,
  onOpenChange,
  from,
  linked,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  from: { type: LinkableType; id: string }
  /** `type:id` of what this item is linked to already. */
  linked: Set<string>
  onAdded: () => void
}) {
  const t = useT('links')
  const [kind, setKind] = useState<LinkableType>('media')
  const [q, setQ] = useState('')
  const query = useDeferredValue(q)
  const [relation, setRelation] = useState<LinkRelation>('related')
  const [view, setView] = useStoredState<'grid' | 'list'>('links.view', 'grid')
  const [picked, setPicked] = useState<Map<string, Candidate>>(new Map())
  const [busy, setBusy] = useState(false)
  const anchor = useRef<number | null>(null)

  const media = useMediaList(
    { q: query || undefined, sort: 'recent', projectKind: 'project' },
    { enabled: open && kind === 'media' },
  )
  const others = useQuery({
    queryKey: ['links', 'search', kind, query],
    enabled: open && kind !== 'media',
    queryFn: async (): Promise<Candidate[]> => {
      const needle = query.toLowerCase()
      if (kind === 'project') {
        const r = await api.get<{ id: string; name: string; coverUrl: string | null }[]>('/projects')
        return r
          .filter((p) => p.name.toLowerCase().includes(needle))
          .map((p) => ({ type: 'project', id: p.id, title: p.name, thumbnailUrl: p.coverUrl }))
      }
      if (kind === 'post') {
        const r =
          await api.get<
            { id: string; name: string; caption: string; media: { thumbnailUrl: string | null }[] }[]
          >('/posts')
        return r
          .filter((p) => `${p.name} ${p.caption}`.toLowerCase().includes(needle))
          .map((p) => ({
            type: 'post',
            id: p.id,
            title: p.name || p.caption.slice(0, 60),
            thumbnailUrl: p.media[0]?.thumbnailUrl ?? null,
          }))
      }
      const r = await api.get<{ id: string; name: string; posterUrl?: string | null }[]>('/compositions')
      return r
        .filter((c) => c.name.toLowerCase().includes(needle))
        .map((c) => ({ type: 'composition', id: c.id, title: c.name, thumbnailUrl: c.posterUrl ?? null }))
    },
  })
  const list = useMemo<Candidate[]>(() => {
    const all: Candidate[] =
      kind === 'media'
        ? (media.data?.pages.flatMap((p) => p.items) ?? []).map((m) => ({
            type: 'media',
            id: m.id,
            title: m.title,
            thumbnailUrl: m.thumbnailUrl,
            meta: m.kind,
            media: m,
          }))
        : (others.data ?? [])
    return all.filter((c) => !(c.type === from.type && c.id === from.id))
  }, [kind, media.data, others.data, from.type, from.id])
  const loading = kind === 'media' ? media.isLoading : others.isLoading

  // A new tab or search starts a new Shift-click run (the picks themselves stay).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listed values are the triggers
  useEffect(() => {
    anchor.current = null
  }, [kind, query])

  // More media as the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = media
  useEffect(() => {
    const el = end.current
    if (!el || kind !== 'media' || !hasNextPage) return
    const io = new IntersectionObserver(
      ([e]) => e?.isIntersecting && !isFetchingNextPage && void fetchNextPage(),
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [kind, hasNextPage, isFetchingNextPage, fetchNextPage])

  const toggle = (c: Candidate, i: number, e: React.MouseEvent) => {
    setPicked((prev) => {
      const next = new Map(prev)
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current]
        for (const x of list.slice(a, b + 1)) if (!linked.has(keyOf(x))) next.set(keyOf(x), x)
      } else if (next.has(keyOf(c))) next.delete(keyOf(c))
      else next.set(keyOf(c), c)
      return next
    })
    if (!e.shiftKey) anchor.current = i
  }

  const close = () => {
    onOpenChange(false)
    setPicked(new Map())
    setQ('')
  }
  const add = async () => {
    const chosen = [...picked.values()]
    if (!chosen.length || busy) return
    setBusy(true)
    const results = await Promise.allSettled(
      chosen.map((c) => api.post('/links', { from, to: { type: c.type, id: c.id }, relation })),
    )
    setBusy(false)
    const done = chosen.filter((_, i) => results[i]!.status === 'fulfilled')
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (done.length === 1) toast.done(t('linked', { title: done[0]!.title || t('common:untitled') }))
    else if (done.length) toast.done(t('linkedMany', { count: done.length }))
    if (done.length) onAdded()
    if (failed) {
      toast.error(failed.reason)
      // keep what didn't link picked, to try again
      setPicked(new Map(chosen.filter((_, i) => results[i]!.status === 'rejected').map((c) => [keyOf(c), c])))
      return
    }
    close()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={t('addTitle')}
      width={1480}
      className="h-[calc(100dvh-48px)] max-h-none"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2">
            <span className="t-label max-sm:hidden">{t('relation')}</span>
            <Select<LinkRelation>
              size="sm"
              value={relation}
              onChange={setRelation}
              options={Relations.options.map((r) => ({ value: r, label: t(`relations.${r}.forward`) }))}
            />
          </span>
          {picked.size > 0 && (
            <span className="flex items-center gap-1 t-callout text-ink-2">
              {t('selected', { count: picked.size })}
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Map())}>
                {t('clear')}
              </Button>
            </span>
          )}
          <Button variant="ghost" onClick={close}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" disabled={!picked.size || busy} onClick={() => void add()}>
            {picked.size > 1 ? t('linkCount', { count: picked.size }) : t('link')}
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented<LinkableType>
            size="sm"
            value={kind}
            onChange={setKind}
            options={(['media', 'project', 'post', 'composition'] as const).map((k) => ({
              value: k,
              label: t(`types.${k}`),
            }))}
          />
          <SearchInput
            value={q}
            onChange={setQ}
            size="sm"
            className="min-w-[200px] flex-1"
            autoFocus
            placeholder={t('search')}
          />
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', icon: LayoutGrid, title: t('view.grid') },
              { value: 'list', icon: List, title: t('view.list') },
            ]}
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {loading ? (
            view === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(180px,40%),1fr))] gap-x-3 gap-y-4">
                {Array.from({ length: 18 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  <Skeleton key={i} className="aspect-video rounded-tile" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            )
          ) : list.length === 0 ? (
            <div className="py-12 text-center t-callout text-ink-3">{t('noResults')}</div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(180px,40%),1fr))] gap-x-3 gap-y-4 p-0.5">
              {list.map((c, i) => (
                <Pick
                  key={keyOf(c)}
                  c={c}
                  grid
                  on={picked.has(keyOf(c))}
                  done={linked.has(keyOf(c))}
                  onClick={(e) => toggle(c, i, e)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {list.map((c, i) => (
                <Pick
                  key={keyOf(c)}
                  c={c}
                  on={picked.has(keyOf(c))}
                  done={linked.has(keyOf(c))}
                  onClick={(e) => toggle(c, i, e)}
                />
              ))}
            </div>
          )}
          <div ref={end} className="h-px" />
          {isFetchingNextPage && (
            <div className="grid place-items-center py-4">
              <Spinner />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** One thing to pick: a tile in the grid, a row in the list; ticked when picked, marked when linked already. */
function Pick({
  c,
  grid,
  on,
  done,
  onClick,
}: {
  c: Candidate
  grid?: boolean
  on: boolean
  done: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const t = useT('links')
  const Icon = ICON[c.type]
  const thumb = (cls: string) =>
    c.media ? (
      <MediaThumb media={c.media} className={cls} scrub={grid} showDuration={grid} />
    ) : (
      <span className={cn('grid place-items-center overflow-hidden bg-stage text-white/40', cls)}>
        {c.thumbnailUrl ? (
          <img src={c.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <Icon size={grid ? 22 : 16} strokeWidth={1.6} />
        )}
      </span>
    )
  const tick = (
    <span
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full transition-all duration-150',
        on
          ? 'bg-signal text-signal-ink'
          : grid
            ? 'bg-black/40 text-transparent opacity-0 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.7)] group-hover:opacity-100'
            : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]',
      )}
    >
      <Check size={12} strokeWidth={3} />
    </span>
  )
  const meta = [c.meta ? t(`common:kind.${c.meta}`) : null, done ? t('already') : null]
    .filter(Boolean)
    .join(' · ')
  if (grid)
    return (
      <button
        type="button"
        disabled={done}
        aria-pressed={on}
        onClick={onClick}
        className="press group min-w-0 text-left disabled:cursor-default disabled:opacity-45"
      >
        <div
          className={cn(
            'relative rounded-tile transition-shadow duration-150',
            on && 'shadow-[0_0_0_2px_var(--signal)]',
          )}
        >
          {thumb('aspect-video rounded-tile')}
          {!done && <span className="absolute top-1.5 left-1.5">{tick}</span>}
        </div>
        <div className={cn('mt-1.5 truncate t-caption', on ? 'font-[550] text-signal' : 'text-ink-2')}>
          {c.title || t('common:untitled')}
        </div>
        {meta && <div className="truncate t-micro text-ink-3">{meta}</div>}
      </button>
    )
  return (
    <button
      type="button"
      disabled={done}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'press flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left disabled:cursor-default disabled:opacity-45',
        on ? 'bg-signal-soft' : 'hover:bg-hover',
      )}
    >
      {done ? <span className="size-5 shrink-0" /> : tick}
      {thumb('aspect-video w-16 shrink-0 rounded-[6px]')}
      <span className={cn('min-w-0 flex-1 truncate t-callout', on ? 'font-[550] text-signal' : 'text-ink')}>
        {c.title || t('common:untitled')}
      </span>
      {meta && <span className="t-caption text-ink-3">{meta}</span>}
    </button>
  )
}

export function MediaLinks({ media }: { media: { id: string } }) {
  return <LinksPanel type="media" id={media.id} />
}
export function PostLinks({ post }: { post: { id: string } }) {
  return <LinksPanel type="post" id={post.id} />
}
export function CompositionLinks({ composition }: { composition: { id: string } }) {
  return <LinksPanel type="composition" id={composition.id} />
}
