import type { Media, MediaListQuery } from '@greenlit/shared'
import {
  ArrowDownUp,
  ImagePlus,
  LayoutGrid,
  List,
  ListFilter,
  Maximize2,
  Minimize2,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router'
import { Slot } from '@/app/Slot'
import { browseState, takeSteppedTo } from '@/components/viewer/browse'
import { uploadMedia, useMediaList } from '@/data/media'
import { useProjects } from '@/data/projects'
import { useTags } from '@/data/tags'
import { cn } from '@/lib/cn'
import { useFileDrop, useIsPhone, useMediaQuery, useStoredState, withViewTransition } from '@/lib/dom'
import { isTypingTarget } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { can, useSession } from '@/lib/session'
import { useTimeZone } from '@/lib/time'
import { filesFromClipboard } from '@/lib/uploads'
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  openContextMenu,
  Popover,
  Segmented,
  Skeleton,
  Slider,
  Spinner,
  Tally,
  toast,
  toneFor,
} from '@/ui'
import { useMediaActions } from './actions'
import { BulkBar } from './BulkBar'
import { DropOverlay } from './DropOverlay'
import { type GridHandle, MediaGrid } from './MediaGrid'
import { MediaList } from './MediaList'
import type { TileHandlers } from './MediaTile'
import { SearchField } from './SearchField'
import { groupMedia } from './sections'
import { useSelection } from './selection'
import { countFilters, hasToken, KINDS, STATUSES, toggleToken } from './tokens'

type Sort = MediaListQuery['sort']
const SORTS: Sort[] = ['recent', 'oldest', 'taken', 'title', 'size']

export interface BrowserHeaderContext {
  total: number | null
  inTrash: boolean
  upload: () => void
  canUpload: boolean
  exitTrash: () => void
}

/**
 * The media browser shared by the library and project pages: token search, filters, sort, grid or list, selection
 * with a marquee and a bulk bar, right-click menus, rename in place, drop / paste to upload, trash.
 * State lives in the URL (`q`, `sort`, `view`, `trash`) so a filtered view can be linked.
 */
export function MediaBrowser({
  projectId,
  projectName,
  header,
  allowTrash = true,
}: {
  projectId?: string
  projectName?: string
  header?: (ctx: BrowserHeaderContext) => ReactNode
  allowTrash?: boolean
}) {
  const t = useT('browser')
  const tc = useT()
  const me = useSession()
  const tz = useTimeZone()
  const phone = useIsPhone()
  const coarse = useMediaQuery('(hover: none)')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const sort = (SORTS.includes(params.get('sort') as Sort) ? params.get('sort') : 'recent') as Sort
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const inTrash = allowTrash && params.get('trash') === '1'
  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // The query follows the field after a short pause, so typing stays smooth.
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 180)
    return () => clearTimeout(id)
  }, [q])

  const query = useMemo(
    () => ({
      q: debounced || undefined,
      sort,
      projectId,
      // The library is the work: brand kits' files stay in their kit (a `project:` token still finds them).
      ...(inTrash ? { trash: true } : projectId ? {} : { projectKind: 'project' as const }),
    }),
    [debounced, sort, projectId, inTrash],
  )
  const list = useMediaList(query)
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const total = list.data?.pages[0]?.total ?? null
  const order = useMemo(() => items.map((m) => m.id), [items])
  const selection = useSelection(order)
  const selectedItems = useMemo(
    () => items.filter((m) => selection.selected.has(m.id)),
    [items, selection.selected],
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [transitionId, setTransitionId] = useState<string | null>(null)
  const [tileSize, setTileSize] = useStoredState('library.tile', 236)
  const [fit, setFit] = useStoredState<'cover' | 'contain'>('library.fit', 'cover')
  const grid = useRef<GridHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Section headers stick right under the top bar and this toolbar (its full height, padding included).
  const toolbar = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(56)
  useEffect(() => {
    const el = toolbar.current
    if (!el) return
    const ro = new ResizeObserver(() => setToolbarHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const stickyTop = 52 + toolbarHeight

  const actions = useMediaActions({ onRename: setRenamingId, inTrash })
  const canUpload = can(me, 'media.upload') && !me.viaShareLink && !inTrash
  const canRename = can(me, 'media.edit') && !me.viaShareLink && !inTrash
  const { data: projects } = useProjects()
  const { data: tags } = useTags()

  // A new search, sort or view starts with nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listed values are the triggers
  useEffect(() => selection.clear(), [debounced, sort, inTrash, projectId, selection.clear])

  // ── uploads ─────────────────────────────────────────────────────────
  const place = projectName ?? t('drop.library')
  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length || !canUpload) return
      toast.info(t('uploading', { count: files.length, name: files[0]!.name }))
      const ids = await uploadMedia(files, { projectId: projectId ?? null })
      if (ids.length) toast.done(t('uploadedTo', { place }))
    },
    [canUpload, projectId, place, t],
  )
  const dragging = useFileDrop((files) => void doUpload(files), { enabled: canUpload })
  useEffect(() => {
    if (!canUpload) return
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const files = filesFromClipboard(e)
      if (files.length) {
        e.preventDefault()
        void doUpload(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [canUpload, doUpload])

  // ── opening, clicking, menus ────────────────────────────────────────
  const open = useCallback(
    (m: Media) => {
      flushSync(() => setTransitionId(m.id))
      // The viewer steps through this same view (search, sort, trash) with its previous / next buttons.
      withViewTransition(() => navigate(`/media/${m.id}`, { state: browseState({ query }) }))
    },
    [navigate, query],
  )

  // Back from the viewer after stepping through items: focus the last one shown and bring it into view.
  const steppedTo = useRef(takeSteppedTo())
  useEffect(() => {
    const id = steppedTo.current
    if (!id || !order.includes(id)) return
    steppedTo.current = null
    setFocusedId(id)
    requestAnimationFrame(() => grid.current?.reveal(id))
  }, [order])
  const handlers = useMemo<TileHandlers>(
    () => ({
      onClick: (m, e) => {
        setFocusedId(m.id)
        if (coarse && !selection.selected.size) return open(m)
        if (coarse) return selection.toggle(m.id)
        selection.click(m.id, e)
      },
      onOpen: open,
      onToggle: (m, e) => {
        setFocusedId(m.id)
        selection.toggle(m.id, e)
      },
      onContextMenu: (m, e) => {
        e.preventDefault()
        const ids = new Set(selection.ensure(m.id))
        setFocusedId(m.id)
        openContextMenu(e.clientX, e.clientY, actions.menu(items.filter((x) => ids.has(x.id))))
      },
      onStartRename: (m) => setRenamingId(m.id),
      onRename: (m, title) => {
        setRenamingId(null)
        if (title && title !== m.title) void actions.rename(m, title)
      },
    }),
    [coarse, selection, open, actions, items],
  )

  // ── keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if ((e.target as HTMLElement).closest?.('[role=dialog],[role=menu],[role=listbox][data-cmdk-list]'))
        return
      if (document.querySelector('[role=dialog][data-open]')) return
      const mod = e.metaKey || e.ctrlKey
      const current = focusedId ?? selectedItems[0]?.id ?? null
      if (e.key === 'Escape' && selection.selected.size) {
        selection.clear()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selection.all()
        return
      }
      if (e.key === 'Enter' && current) {
        const m = items.find((x) => x.id === current)
        if (m) open(m)
        return
      }
      if (e.key === 'F2' && current && canRename) {
        e.preventDefault()
        setRenamingId(current)
        return
      }
      if (
        (e.key === 'Delete' || (mod && e.key === 'Backspace')) &&
        selectedItems.length &&
        can(me, 'media.delete')
      ) {
        e.preventDefault()
        void (inTrash ? actions.purge(selectedItems) : actions.trash(selectedItems))
        return
      }
      const step =
        e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowLeft'
            ? -1
            : e.key === 'ArrowDown'
              ? view === 'grid'
                ? (grid.current?.cols() ?? 1)
                : 1
              : e.key === 'ArrowUp'
                ? -(view === 'grid' ? (grid.current?.cols() ?? 1) : 1)
                : 0
      if (step && items.length) {
        e.preventDefault()
        const i = current ? order.indexOf(current) : -1
        const next = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + step))]!
        setFocusedId(next)
        selection.click(next, { shiftKey: e.shiftKey })
        grid.current?.reveal(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, selectedItems, selection, items, order, open, canRename, inTrash, actions, me, view])

  const endReached = useCallback(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
  }, [list])

  const sections = useMemo(
    () =>
      groupMedia(items, sort, tz, {
        today: t('sections.today'),
        yesterday: t('sections.yesterday'),
        week: t('sections.week'),
        undated: t('sections.undated'),
      }),
    [items, sort, tz, t],
  )

  const filters = countFilters(q)
  const toggle = (key: 'status' | 'kind' | 'tag' | 'project' | 'has' | 'no', value: string) =>
    setParam('q', toggleToken(q, { key, value }))
  const filterItems = [
    {
      label: t('suggest.status'),
      items: STATUSES.map((s) => ({
        label: (
          <span className="flex items-center gap-2">
            <Tally tone={toneFor(s)} size={7} />
            {tc(`status.${s}`)}
          </span>
        ),
        checked: hasToken(q, { key: 'status', value: s }),
        keepOpen: true,
        onSelect: () => toggle('status', s),
      })),
    },
    {
      label: t('suggest.kind'),
      items: KINDS.map((k) => ({
        label: tc(`kind.${k}`),
        checked: hasToken(q, { key: 'kind', value: k }),
        keepOpen: true,
        onSelect: () => toggle('kind', k),
      })),
    },
    (tags?.length ?? 0) > 0 && {
      label: t('suggest.tags'),
      items: (tags ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 24)
        .map((tg) => ({
          label: `#${tg.name}`,
          hint: <span className="t-meta">{tg.count}</span>,
          checked: hasToken(q, { key: 'tag', value: tg.name }),
          keepOpen: true,
          onSelect: () => toggle('tag', tg.name),
        })),
    },
    !projectId &&
      (projects?.length ?? 0) > 0 && {
        label: t('suggest.projects'),
        items: (projects ?? []).map((p) => ({
          label: p.name,
          checked: hasToken(q, { key: 'project', value: p.name }),
          keepOpen: true,
          onSelect: () => toggle('project', p.name),
        })),
      },
    {
      label: t('depth.group'),
      items: (['has', 'no'] as const).map((k) => ({
        label: t(`depth.${k}`),
        checked: hasToken(q, { key: k, value: 'depth' }),
        keepOpen: true,
        onSelect: () => {
          // With and without exclude each other.
          const other = k === 'has' ? 'no' : 'has'
          const base = hasToken(q, { key: other, value: 'depth' })
            ? toggleToken(q, { key: other, value: 'depth' })
            : q
          setParam('q', toggleToken(base, { key: k, value: 'depth' }))
        },
      })),
    },
    filters > 0 && 'separator',
    filters > 0 && { label: t('empty.clear'), onSelect: () => setParam('q', null) },
  ] as const

  const footer = list.isFetchingNextPage ? (
    <div className="flex justify-center py-8 text-ink-3">
      <Spinner />
    </div>
  ) : (
    <div className="h-24" />
  )

  const body = () => {
    if (list.isLoading)
      return (
        <div
          className="grid gap-x-[18px] gap-y-[26px]"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${phone ? 150 : tileSize}px, 1fr))` }}
        >
          {Array.from({ length: 18 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i}>
              <Skeleton
                className="aspect-[16/10] w-full rounded-tile"
                style={{ animationDelay: `${i * 40}ms` }}
              />
              <Skeleton className="mt-2.5 h-3.5 w-3/5" />
            </div>
          ))}
        </div>
      )
    if (!items.length) {
      if (inTrash)
        return <EmptyState icon={Trash2} title={t('empty.trashTitle')} body={t('empty.trashBody')} />
      if (q)
        return (
          <EmptyState
            icon={SearchX}
            title={t('empty.noResults')}
            body={t('empty.noResultsBody')}
            action={<Button onClick={() => setParam('q', null)}>{t('empty.clear')}</Button>}
          />
        )
      return (
        <EmptyState
          icon={ImagePlus}
          title={projectId ? t('empty.projectTitle') : t('empty.title')}
          body={canUpload ? (projectId ? t('empty.projectBody') : t('empty.body')) : t('empty.readonlyBody')}
          action={
            canUpload && (
              <Button variant="primary" icon={Upload} onClick={() => fileInput.current?.click()}>
                {t('upload')}
              </Button>
            )
          }
        />
      )
    }
    return view === 'grid' ? (
      <MediaGrid
        ref={grid}
        sections={sections}
        tileSize={tileSize}
        fit={fit}
        selection={selection}
        focusedId={focusedId}
        renamingId={renamingId}
        canRename={canRename}
        transitionId={transitionId}
        handlers={handlers}
        onEndReached={endReached}
        stickyTop={stickyTop}
        footer={footer}
      />
    ) : (
      <MediaList
        items={items}
        selection={selection}
        focusedId={focusedId}
        renamingId={renamingId}
        canRename={canRename}
        handlers={handlers}
        onEndReached={endReached}
        stickyTop={stickyTop}
        sort={sort}
        onSort={(s) => setParam('sort', s === 'recent' ? null : s)}
        footer={footer}
      />
    )
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void doUpload(files)
        }}
      />
      {header?.({
        total,
        inTrash,
        upload: () => fileInput.current?.click(),
        canUpload,
        exitTrash: () => setParam('trash', null),
      })}

      <div
        ref={toolbar}
        className="material-bar sticky top-[var(--bar-h)] z-30 -mx-[var(--gutter)] mb-4 px-[var(--gutter)] py-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={q}
            onChange={(v) => setParam('q', v)}
            showProjects={!projectId}
            className={cn('min-w-0 flex-1', phone ? 'basis-full' : 'max-w-[560px]')}
          />
          <Menu
            align="start"
            width={230}
            trigger={
              <Button
                variant="ghost"
                icon={ListFilter}
                className={cn(filters > 0 && 'text-ink')}
                aria-label={t('filter')}
              >
                {!phone && t('filter')}
                {filters > 0 && <Badge tone="signal">{filters}</Badge>}
              </Button>
            }
            items={filterItems.filter(Boolean) as never}
          />
          <Menu
            align="start"
            width={210}
            trigger={
              <Button variant="ghost" icon={ArrowDownUp} aria-label={t('sort.label')}>
                {!phone && t(`sort.${sort}`)}
              </Button>
            }
            items={SORTS.map((s) => ({
              label: t(`sort.${s}`),
              checked: s === sort,
              onSelect: () => setParam('sort', s === 'recent' ? null : s),
            }))}
          />
          <span className="flex-1" />
          <Slot name="library.toolbar" props={{ projectId: projectId ?? null }} />
          {!phone && view === 'grid' && (
            <Popover
              align="end"
              width={248}
              trigger={<IconButton icon={SlidersHorizontal} label={t('view.size')} />}
            >
              <div className="flex flex-col gap-4 p-4">
                <div>
                  <div className="mb-2.5 flex items-center justify-between t-caption text-ink-3">
                    <span>{t('view.size')}</span>
                    <span className="t-meta">{tileSize}px</span>
                  </div>
                  <Slider
                    value={tileSize}
                    min={150}
                    max={420}
                    step={2}
                    onChange={(v) => setTileSize(Math.round(v))}
                    label={t('view.size')}
                  />
                </div>
                <Segmented
                  stretch
                  size="sm"
                  value={fit}
                  onChange={setFit}
                  options={[
                    { value: 'cover', label: t('view.fill'), icon: Maximize2 },
                    { value: 'contain', label: t('view.fit'), icon: Minimize2 },
                  ]}
                />
              </div>
            </Popover>
          )}
          <Segmented
            value={view}
            onChange={(v) => setParam('view', v === 'grid' ? null : v)}
            options={[
              { value: 'grid', icon: LayoutGrid, title: t('view.grid') },
              { value: 'list', icon: List, title: t('view.list') },
            ]}
          />
          {allowTrash && can(me, 'media.delete') && (
            <IconButton
              icon={Trash2}
              label={t('trash')}
              active={inTrash || undefined}
              onClick={() => setParam('trash', inTrash ? null : '1')}
            />
          )}
        </div>
      </div>

      {body()}

      <BulkBar
        items={selectedItems}
        total={items.length}
        onSelectAll={selection.all}
        onClear={selection.clear}
        actions={actions}
        inTrash={inTrash}
      />
      {actions.tagDialog}
      <DropOverlay visible={dragging} place={place} />
    </>
  )
}
