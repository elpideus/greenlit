import { normalizeTag, type TagCount, tagKey } from '@greenlit/shared'
import {
  ChevronLeft,
  Images,
  Merge,
  MoreHorizontal,
  Pencil,
  SearchX,
  SquareCheck,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toggleToken } from '@/components/library'
import { useAllTags } from '@/data/tags'
import { cn } from '@/lib/cn'
import { useIsPhone, useMediaQuery, useStoredState } from '@/lib/dom'
import { isTypingTarget } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { spring, stagger } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import {
  Button,
  Checkbox,
  confirm,
  EmptyState,
  ErrorState,
  IconButton,
  InlineEdit,
  Menu,
  type MenuEntry,
  Page,
  PageHeader,
  SearchInput,
  Segmented,
  Skeleton,
  toast,
  useContextMenu,
} from '@/ui'
import { useTagOps } from './api'
import { MergeDialog } from './MergeDialog'

type Sort = 'count' | 'name'

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** The letter a tag files under in the A–Z index ('' = digits and symbols). */
const initial = (name: string) => {
  const c = fold(name).charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : ''
}

/** A library link showing the items with this tag. */
const libraryFor = (name: string) =>
  `/library?q=${encodeURIComponent(toggleToken('', { key: 'tag', value: name }))}`

/**
 * Every tag in the library with how many items carry it. Click selects (shift / ⌘ to add), double-click shows the
 * items, double-click the name or F2 renames; renaming onto an existing tag merges them. Rename, merge and delete
 * apply to every item that carries the tag, trash included, and each item records the change in its history.
 */
export default function TagsPage() {
  const t = useT('tags')
  const me = useSession()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const coarse = useMediaQuery('(hover: none)')
  const manage = can(me, 'tags.manage') && !me.viaShareLink
  const { data, isLoading, error, refetch } = useAllTags()
  const ops = useTagOps()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useStoredState<Sort>('tags.sort', 'count')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [merging, setMerging] = useState<TagCount[] | null>(null)

  const all = data ?? []
  const byKey = useMemo(() => new Map(all.map((tg) => [tagKey(tg.name), tg])), [all])
  const visible = useMemo(() => {
    const q = fold(query.trim().replace(/^#/, ''))
    const list = q ? all.filter((tg) => fold(tg.name).includes(q)) : all.slice()
    return list.sort(
      sort === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    )
  }, [all, query, sort])
  const order = useMemo(() => visible.map((tg) => tagKey(tg.name)), [visible])
  const groups = useMemo(() => {
    if (sort !== 'name') return [{ letter: null as string | null, items: visible }]
    const out: { letter: string | null; items: TagCount[] }[] = []
    for (const tg of visible) {
      const letter = initial(tg.name)
      if (out.at(-1)?.letter !== letter) out.push({ letter, items: [] })
      out.at(-1)!.items.push(tg)
    }
    // Digits and symbols file at the end, under "Other".
    return [...out.filter((g) => g.letter !== ''), ...out.filter((g) => g.letter === '')]
  }, [visible, sort])

  // Tags that were renamed or deleted leave the selection.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((k) => byKey.has(k)))
      return next.size === s.size ? s : next
    })
  }, [byKey])

  const selectedTags = useMemo(
    () => order.filter((k) => selected.has(k)).map((k) => byKey.get(k)!),
    [order, selected, byKey],
  )
  /** The tags an action on `tg` applies to: the selection when `tg` is part of it. */
  const targetsOf = useCallback(
    (tg: TagCount) => (selected.has(tagKey(tg.name)) && selected.size > 1 ? selectedTags : [tg]),
    [selected, selectedTags],
  )

  // ── selection ───────────────────────────────────────────────────────
  const clear = useCallback(() => setSelected(new Set()), [])
  const toggle = useCallback((key: string) => {
    setAnchor(key)
    setSelected((s) => {
      const next = new Set(s)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])
  const click = (key: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (e.shiftKey && anchor && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(key)].sort((x, y) => x - y)
      setSelected(new Set(order.slice(a!, b! + 1)))
      return
    }
    if (e.metaKey || e.ctrlKey) return toggle(key)
    setAnchor(key)
    setSelected(new Set([key]))
  }

  // ── actions ─────────────────────────────────────────────────────────
  const show = useCallback((tg: TagCount) => navigate(libraryFor(tg.name)), [navigate])

  const rename = useCallback(
    async (tg: TagCount, raw: string) => {
      setRenaming(null)
      const name = normalizeTag(raw).toLowerCase()
      if (!name || name === tg.name) return
      const existing = byKey.get(tagKey(name))
      const merge = !!existing && tagKey(existing.name) !== tagKey(tg.name)
      if (
        merge &&
        !(await confirm({
          title: t('mergeConfirm', { from: tg.name, to: existing.name }),
          body: t('mergeConfirmBody', { from: tg.name, to: existing.name }),
          confirm: t('merge'),
        }))
      )
        return
      try {
        const count = await ops.rename([tg.name], merge ? existing.name : name)
        if (merge) toast.done(t('merged', { name: existing.name, count }))
        else
          toast.done(t('renamed', { name, count }), {
            action: {
              label: t('undo'),
              onClick: () => void ops.rename([name], tg.name).catch((err) => toast.error(err)),
            },
          })
      } catch (err) {
        toast.error(err)
      }
    },
    [byKey, ops, t],
  )

  const merge = useCallback(
    async (from: TagCount[], to: string) => {
      setMerging(null)
      try {
        const name = byKey.get(tagKey(to))?.name ?? to
        const count = await ops.rename(
          from.map((f) => f.name),
          name,
        )
        clear()
        toast.done(t('merged', { name, count }))
      } catch (err) {
        toast.error(err)
      }
    },
    [byKey, ops, clear, t],
  )

  const remove = useCallback(
    async (tags: TagCount[]) => {
      const one = tags.length === 1 ? tags[0]! : null
      const ok = await confirm({
        title: one ? t('deleteConfirm', { name: one.name }) : t('deleteConfirmMany', { count: tags.length }),
        body: one ? t('deleteBody', { count: one.count }) : t('deleteBodyMany'),
        confirm: one ? t('delete') : t('deleteMany', { count: tags.length }),
        danger: true,
      })
      if (!ok) return
      try {
        const count = await ops.remove(tags.map((x) => x.name))
        clear()
        toast.done(
          one ? t('deleted', { name: one.name, count }) : t('deletedMany', { tags: tags.length, count }),
        )
      } catch (err) {
        toast.error(err)
      }
    },
    [ops, clear, t],
  )

  const menuFor = useCallback(
    (tg: TagCount): MenuEntry[] => {
      const targets = targetsOf(tg)
      const many = targets.length > 1
      const key = tagKey(tg.name)
      return [
        !many && { label: t('show', { count: tg.count }), icon: Images, onSelect: () => show(tg) },
        manage &&
          !many && { label: t('rename'), icon: Pencil, shortcut: 'F2', onSelect: () => setRenaming(key) },
        manage && {
          label: many ? t('mergeMany', { count: targets.length }) : t('mergeInto'),
          icon: Merge,
          onSelect: () => setMerging(targets),
        },
        manage &&
          coarse && {
            label: selected.has(key) ? t('deselect') : t('select'),
            icon: SquareCheck,
            onSelect: () => toggle(key),
          },
        manage && 'separator',
        manage && {
          label: many ? t('deleteMany', { count: targets.length }) : t('delete'),
          icon: Trash2,
          danger: true,
          onSelect: () => void remove(targets),
        },
      ]
    },
    [targetsOf, manage, coarse, selected, show, toggle, remove, t],
  )

  // ── keyboard ────────────────────────────────────────────────────────
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role=dialog][data-open],[role=menu]')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape' && selected.size) return clear()
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        search.current?.focus()
        return
      }
      if (!manage) return
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(order))
        return
      }
      if (e.key === 'F2' && selectedTags.length === 1) {
        e.preventDefault()
        setRenaming(tagKey(selectedTags[0]!.name))
        return
      }
      if (e.key === 'Enter' && selectedTags.length === 1) return show(selectedTags[0]!)
      if ((e.key === 'Delete' || (mod && e.key === 'Backspace')) && selectedTags.length) {
        e.preventDefault()
        void remove(selectedTags)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, selectedTags, order, manage, clear, show, remove])

  // ── render ──────────────────────────────────────────────────────────
  const body = () => {
    if (isLoading)
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-6 gap-y-1">
          {Array.from({ length: 30 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i} className="flex h-10 items-center gap-2.5 px-2.5">
              <Skeleton
                className="h-3.5"
                style={{ width: `${38 + ((i * 37) % 45)}%`, animationDelay: `${i * 30}ms` }}
              />
              <span className="flex-1" />
              <Skeleton className="h-3 w-6" />
            </div>
          ))}
        </div>
      )
    if (error) return <ErrorState title={t('loadError')} error={error} retry={() => void refetch()} />
    if (!all.length)
      return (
        <EmptyState
          icon={Tags}
          title={t('empty.title')}
          body={t('empty.body')}
          action={<Button onClick={() => navigate('/library')}>{t('empty.action')}</Button>}
        />
      )
    if (!visible.length)
      return (
        <EmptyState
          icon={SearchX}
          title={t('empty.noMatch', { q: query.trim() })}
          body={t('empty.noMatchBody')}
          action={<Button onClick={() => setQuery('')}>{t('empty.clearSearch')}</Button>}
        />
      )
    let index = 0
    return (
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.letter ?? 'all'}>
            {g.letter !== null && (
              <h2 className="mb-1.5 border-b border-line px-2.5 pb-1.5 t-headline text-ink-2">
                {g.letter || t('other')}
              </h2>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-6">
              {g.items.map((tg) => {
                const key = tagKey(tg.name)
                return (
                  <TagRow
                    key={key}
                    tag={tg}
                    index={index++}
                    selected={selected.has(key)}
                    selecting={selected.size > 0}
                    manage={manage}
                    coarse={coarse}
                    renaming={renaming === key}
                    menu={() => menuFor(tg)}
                    onClick={(e) => {
                      if (!manage || (coarse && !selected.size)) return show(tg)
                      if (coarse) return toggle(key)
                      click(key, e)
                    }}
                    onOpen={() => show(tg)}
                    onToggle={() => toggle(key)}
                    onStartRename={() => setRenaming(key)}
                    onRename={(v) => (v === null ? setRenaming(null) : void rename(tg, v))}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <Page>
      <button
        type="button"
        onClick={() => navigate('/library')}
        className="press -ml-1 mb-2 inline-flex h-7 items-center gap-0.5 rounded-control pr-2 pl-0.5 t-callout text-ink-3 hover:bg-hover hover:text-ink"
      >
        <ChevronLeft size={16} />
        {t('back')}
      </button>
      <PageHeader
        title={t('title')}
        meta={
          data ? (
            <span className="tabular">
              {visible.length < all.length
                ? t('metaFiltered', { shown: visible.length, total: t('meta', { count: all.length }) })
                : t('meta', { count: all.length })}
            </span>
          ) : (
            <span className="opacity-0">—</span>
          )
        }
        className="mb-3"
      />
      <div className="material-bar sticky top-[var(--bar-h)] z-30 -mx-[var(--gutter)] mb-4 px-[var(--gutter)] py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            ref={search}
            value={query}
            onChange={setQuery}
            placeholder={t('search')}
            className={cn('min-w-0 flex-1', phone ? 'basis-full' : 'max-w-[360px]')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) setQuery('')
                else e.currentTarget.blur()
              }
              if (e.key === 'Enter' && visible.length === 1) show(visible[0]!)
            }}
          />
          <span className="flex-1" />
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'count', label: t('sort.count') },
              { value: 'name', label: t('sort.name') },
            ]}
          />
        </div>
      </div>

      {body()}

      {manage && (
        <TagsBulkBar
          tags={selectedTags}
          total={visible.length}
          onSelectAll={() => setSelected(new Set(order))}
          onClear={clear}
          onMerge={() => setMerging(selectedTags)}
          onDelete={() => void remove(selectedTags)}
        />
      )}
      {merging && (
        <MergeDialog
          from={merging}
          all={all}
          open
          onOpenChange={(o) => !o && setMerging(null)}
          onMerge={(to) => void merge(merging, to)}
        />
      )}
    </Page>
  )
}

function TagRow({
  tag,
  index,
  selected,
  selecting,
  manage,
  coarse,
  renaming,
  menu,
  onClick,
  onOpen,
  onToggle,
  onStartRename,
  onRename,
}: {
  tag: TagCount
  index: number
  selected: boolean
  selecting: boolean
  manage: boolean
  coarse: boolean
  renaming: boolean
  menu: () => MenuEntry[]
  onClick: (e: React.MouseEvent) => void
  onOpen: () => void
  onToggle: () => void
  onStartRename: () => void
  onRename: (v: string | null) => void
}) {
  const t = useT('tags')
  const tc = useT()
  const context = useContextMenu(menu)
  return (
    <motion.div
      {...(index < 12 ? stagger(index) : {})}
      {...context}
      aria-selected={manage ? selected : undefined}
      onClick={onClick}
      onDoubleClick={onOpen}
      className={cn(
        'group relative flex h-10 min-w-0 cursor-default items-center gap-2.5 rounded-control px-2.5 select-none',
        'transition-colors duration-150',
        selected
          ? 'bg-signal-soft'
          : 'hover-device:hover:bg-[color-mix(in_oklab,var(--hover),transparent_20%)]',
      )}
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <span
          className={cn(
            't-callout text-ink-4 transition-opacity duration-150',
            manage && !coarse && (selecting || selected ? 'opacity-0' : 'group-hover:opacity-0'),
          )}
        >
          #
        </span>
        {manage && !coarse && (
          <span
            role="presentation"
            className={cn(
              'absolute inset-0 grid place-items-center transition-opacity duration-150',
              selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Checkbox checked={selected} onChange={onToggle} label={tag.name} size={15} />
          </span>
        )}
      </span>
      <InlineEdit
        value={tag.name}
        editing={renaming}
        disabled={!manage}
        tooltip={null}
        onEditingChange={(e) => (e ? onStartRename() : onRename(null))}
        onSave={(v) => onRename(v)}
        className={cn('t-callout', selected ? 'text-ink' : 'text-ink-2 group-hover:text-ink')}
      />
      <span className="flex-1" />
      <span
        className={cn('shrink-0 t-meta tabular', selected ? 'text-ink-2' : 'text-ink-3')}
        title={t('items', { count: tag.count })}
      >
        {tag.count}
      </span>
      <span
        role="presentation"
        className={cn(
          '-mr-1.5 shrink-0 transition-opacity duration-150',
          coarse ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100',
        )}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Menu
          align="end"
          trigger={<IconButton icon={MoreHorizontal} label={tc('more')} size="sm" tooltip={false} />}
          items={menu()}
        />
      </span>
    </motion.div>
  )
}

/** Floats up while tags are selected: merge them into one, or delete them everywhere. */
function TagsBulkBar({
  tags,
  total,
  onSelectAll,
  onClear,
  onMerge,
  onDelete,
}: {
  tags: TagCount[]
  total: number
  onSelectAll: () => void
  onClear: () => void
  onMerge: () => void
  onDelete: () => void
}) {
  const t = useT('tags')
  const phone = useIsPhone()
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
  return (
    <AnimatePresence>
      {tags.length > 0 && (
        <motion.div
          initial={{ y: 28, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
          transition={spring.sheet}
          className="fixed left-1/2 z-40 -translate-x-1/2"
          style={{ bottom: phone ? 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 12px)' : 24 }}
        >
          <div className="floating no-scrollbar flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto py-1.5 pr-1.5 pl-3.5">
            <span className="shrink-0 t-callout font-[550] text-ink tabular">
              {t('selected', { count: tags.length })}
            </span>
            {tags.length < total && (
              <Button size="sm" variant="quiet" onClick={onSelectAll} className="shrink-0">
                {t('selectAll')}
              </Button>
            )}
            {sep}
            <Button size="sm" variant="ghost" icon={Merge} onClick={onMerge} disabled={tags.length < 1}>
              {!phone && (tags.length > 1 ? t('merge') : t('mergeInto'))}
            </Button>
            <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={onDelete}>
              {!phone && t('delete')}
            </Button>
            {sep}
            <IconButton icon={X} label={t('clear')} size="sm" onClick={onClear} shortcut="escape" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
