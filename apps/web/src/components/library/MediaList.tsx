import type { Media } from '@greenlit/shared'
import { ArrowDown, ArrowUp, MessageSquare } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { MediaThumb } from '@/components/MediaThumb'
import { useProjects } from '@/data/projects'
import { cn } from '@/lib/cn'
import { useElementSize } from '@/lib/dom'
import { formatBytes, formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { formatRelative, useTimeZone } from '@/lib/time'
import { Checkbox, InlineEdit, StatusLabel } from '@/ui'
import { pressEvent, useLongPress } from './longPress'
import type { TileHandlers } from './MediaTile'
import type { Selection } from './selection'

type Col = 'kind' | 'status' | 'formats' | 'duration' | 'size' | 'project' | 'updated'
/** Columns appear as the list gets wider; title and status always show. */
function columnsFor(width: number): { cols: Col[]; template: string } {
  const cols: Col[] = ['status']
  if (width > 620) cols.push('updated')
  if (width > 760) cols.unshift('kind')
  if (width > 900) cols.splice(cols.indexOf('updated'), 0, 'duration')
  if (width > 1040) cols.splice(cols.indexOf('updated'), 0, 'size')
  if (width > 1160) cols.splice(cols.indexOf('duration'), 0, 'formats')
  if (width > 1280) cols.splice(cols.indexOf('updated'), 0, 'project')
  const w: Record<Col, string> = {
    kind: '84px',
    status: '150px',
    formats: '64px',
    duration: '64px',
    size: '76px',
    project: 'minmax(120px,0.8fr)',
    updated: '104px',
  }
  return { cols, template: ['28px', '64px', 'minmax(160px,2fr)', ...cols.map((c) => w[c])].join(' ') }
}

/** Rows for people who sort and compare: the same selection, menus and rename as the grid. */
export function MediaList({
  items,
  selection,
  focusedId,
  renamingId,
  canRename,
  handlers,
  onEndReached,
  stickyTop,
  sort,
  onSort,
  footer,
}: {
  items: Media[]
  selection: Selection
  focusedId: string | null
  renamingId: string | null
  canRename: boolean
  handlers: TileHandlers
  onEndReached: () => void
  stickyTop: number
  sort: string
  onSort: (s: string) => void
  footer?: React.ReactNode
}) {
  const t = useT('browser')
  const tc = useT()
  const tz = useTimeZone()
  const { data: projects } = useProjects()
  const projectName = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects])
  const allSelected = items.length > 0 && items.every((m) => selection.selected.has(m.id))
  const Footer = useCallback(() => <>{footer}</>, [footer])
  const [box, size] = useElementSize<HTMLDivElement>()
  const { cols, template } = columnsFor(size.width || 1200)
  const has = (c: Col) => cols.includes(c)

  const head = (label: string, key?: string, alt?: string) => {
    const active = key && (sort === key || sort === alt)
    return (
      <button
        type="button"
        disabled={!key}
        onClick={() => key && onSort(sort === key && alt ? alt : key)}
        className={cn(
          'flex items-center gap-1 text-left',
          key && 'press hover:text-ink',
          active && 'text-ink',
        )}
      >
        {label}
        {active && (sort === alt ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    )
  }

  return (
    <div ref={box} className="-mx-2">
      <div className="px-2">
        <div
          className="material-bar sticky z-20 -mx-2 grid h-9 items-center gap-3 border-b border-line px-4 t-caption text-ink-3"
          style={{ top: stickyTop, gridTemplateColumns: template }}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && selection.selected.size > 0}
            onChange={(v) => (v ? selection.all() : selection.clear())}
            label={t('selection.selectAll')}
          />
          <span />
          {head(t('list.title'), 'title')}
          {has('kind') && head(t('list.kind'))}
          {head(t('list.status'))}
          {has('formats') && head(t('list.formats'))}
          {has('duration') && head(t('list.duration'))}
          {has('size') && head(t('list.size'), 'size')}
          {has('project') && head(t('list.project'))}
          {has('updated') && head(t('list.updated'), 'recent', 'oldest')}
        </div>
        <Virtuoso
          useWindowScroll
          increaseViewportBy={600}
          data={items}
          endReached={onEndReached}
          components={{ Footer }}
          itemContent={(_, m) => {
            const selected = selection.selected.has(m.id)
            const size = m.formats.reduce((s, f) => s + f.size, 0)
            const duration = m.formats.find((f) => f.isPrimary)?.duration ?? m.formats[0]?.duration
            return (
              <Pressable onLongPress={(x, y) => handlers.onContextMenu(m, pressEvent(x, y))}>
                {(press) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the list handles keys (arrows, Enter, F2)
                  <div
                    {...press}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    data-media-id={m.id}
                    onClick={(e) => {
                      // the checkbox toggles on its own
                      if (!(e.target as HTMLElement).closest('[role=checkbox]')) handlers.onClick(m, e)
                    }}
                    onDoubleClick={(e) => {
                      if (!(e.target as HTMLElement).closest('[role=checkbox]')) handlers.onOpen(m)
                    }}
                    onContextMenu={(e) => handlers.onContextMenu(m, e)}
                    style={{ gridTemplateColumns: template }}
                    className={cn(
                      'grid h-[52px] items-center gap-3 rounded-[8px] px-2 select-none',
                      selected ? 'bg-signal-soft' : 'hover-device:hover:bg-hover',
                      focusedId === m.id && !selected && 'shadow-[inset_0_0_0_1px_var(--line-strong)]',
                    )}
                  >
                    <Checkbox checked={selected} onChange={() => selection.toggle(m.id)} label={m.title} />
                    <MediaThumb media={m} className="h-10 w-[64px]" showDuration={false} />
                    <span className="flex min-w-0 items-center gap-2">
                      <InlineEdit
                        value={m.title}
                        placeholder={tc('untitled')}
                        editing={renamingId === m.id}
                        disabled={!canRename}
                        tooltip={null}
                        onEditingChange={(e) => (e ? handlers.onStartRename(m) : handlers.onRename(m, null))}
                        onSave={(v) => handlers.onRename(m, v)}
                        className="t-callout font-[500] text-ink"
                      />
                      {m.openCommentCount > 0 && (
                        <span className="flex shrink-0 items-center gap-1 t-meta text-review">
                          <MessageSquare size={11} strokeWidth={2} />
                          {m.openCommentCount}
                        </span>
                      )}
                    </span>
                    {has('kind') && <span className="t-caption text-ink-2">{tc(`kind.${m.kind}`)}</span>}
                    <StatusLabel status={m.status} label={tc(`status.${m.status}`)} />
                    {has('formats') && (
                      <span className="t-caption tabular text-ink-3">{m.formats.length}</span>
                    )}
                    {has('duration') && (
                      <span className="t-meta text-ink-3">{duration ? formatDuration(duration) : '—'}</span>
                    )}
                    {has('size') && (
                      <span className="t-caption tabular text-ink-3">{size ? formatBytes(size) : '—'}</span>
                    )}
                    {has('project') && (
                      <span className="truncate t-caption text-ink-2">
                        {m.projectId ? (projectName.get(m.projectId) ?? '—') : '—'}
                      </span>
                    )}
                    {has('updated') && (
                      <span className="t-caption text-ink-3">{formatRelative(m.createdAt, tz)}</span>
                    )}
                  </div>
                )}
              </Pressable>
            )
          }}
        />
      </div>
    </div>
  )
}

function Pressable({
  onLongPress,
  children,
}: {
  onLongPress: (x: number, y: number) => void
  children: (props: ReturnType<typeof useLongPress>) => React.ReactNode
}) {
  return <>{children(useLongPress(onLongPress))}</>
}
