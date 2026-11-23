import {
  type LinkableType,
  type LinkRelation,
  type Link as LinkT,
  LinkRelation as Relations,
} from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, File as FileIcon, FolderOpen, Link2, Megaphone, Plus, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
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

type Candidate = { type: LinkableType; id: string; title: string; thumbnailUrl: string | null; meta?: string }

function AddLink({
  open,
  onOpenChange,
  from,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  from: { type: LinkableType; id: string }
  onAdded: () => void
}) {
  const t = useT('links')
  const [kind, setKind] = useState<LinkableType>('media')
  const [q, setQ] = useState('')
  const query = useDeferredValue(q)
  const [relation, setRelation] = useState<LinkRelation>('related')
  const [picked, setPicked] = useState<Candidate | null>(null)
  const results = useQuery({
    queryKey: ['links', 'search', kind, query],
    enabled: open,
    queryFn: async (): Promise<Candidate[]> => {
      const needle = query.toLowerCase()
      if (kind === 'media') {
        const r = await api.get<{
          items: { id: string; title: string; thumbnailUrl: string | null; kind: string }[]
        }>('/media', { q: query || undefined, limit: 30 })
        return r.items.map((m) => ({
          type: 'media',
          id: m.id,
          title: m.title,
          thumbnailUrl: m.thumbnailUrl,
          meta: m.kind,
        }))
      }
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
  const list = (results.data ?? []).filter((c) => !(c.type === from.type && c.id === from.id))

  const add = async () => {
    if (!picked) return
    try {
      await api.post('/links', { from, to: { type: picked.type, id: picked.id }, relation })
      toast.done(t('linked', { title: picked.title || t('common:untitled') }))
      onAdded()
      onOpenChange(false)
      setPicked(null)
      setQ('')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('addTitle')}
      width={560}
      footer={
        <>
          <span className="mr-auto flex items-center gap-2">
            <span className="t-label">{t('relation')}</span>
            <Select<LinkRelation>
              size="sm"
              value={relation}
              onChange={setRelation}
              options={Relations.options.map((r) => ({ value: r, label: t(`relations.${r}.forward`) }))}
            />
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" disabled={!picked} onClick={() => void add()}>
            {t('link')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<LinkableType>
          size="sm"
          value={kind}
          onChange={(k) => {
            setKind(k)
            setPicked(null)
          }}
          options={(['media', 'project', 'post', 'composition'] as const).map((k) => ({
            value: k,
            label: t(`types.${k}`),
          }))}
        />
        <SearchInput
          value={q}
          onChange={setQ}
          size="sm"
          className="min-w-0 flex-1"
          autoFocus
          placeholder={t('search')}
        />
      </div>
      <div className="max-h-[46dvh] min-h-48 overflow-y-auto">
        {results.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center t-callout text-ink-3">{t('noResults')}</div>
        ) : (
          list.map((c) => {
            const Icon = ICON[c.type]
            const on = picked?.id === c.id
            return (
              <button
                key={`${c.type}:${c.id}`}
                type="button"
                onClick={() => setPicked(c)}
                onDoubleClick={() => {
                  setPicked(c)
                  void add()
                }}
                className={cn(
                  'press flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left',
                  on ? 'bg-signal-soft' : 'hover:bg-hover',
                )}
              >
                <span className="grid aspect-video w-16 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-stage text-white/40">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Icon size={16} strokeWidth={1.6} />
                  )}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate t-callout',
                    on ? 'font-[550] text-signal' : 'text-ink',
                  )}
                >
                  {c.title || t('common:untitled')}
                </span>
                {c.meta && <span className="t-caption text-ink-3">{t(`common:kind.${c.meta}`)}</span>}
              </button>
            )
          })
        )}
      </div>
    </Dialog>
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
