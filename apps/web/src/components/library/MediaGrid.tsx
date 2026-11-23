import type { Media } from '@greenlit/shared'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { GroupedVirtuoso, type GroupedVirtuosoHandle, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useElementSize, useIsPhone } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { MediaTile, type TileHandlers } from './MediaTile'
import type { MediaSection } from './sections'
import type { Selection } from './selection'

export interface GridHandle {
  /** Scrolls an item into view (it may not be rendered yet). */
  reveal: (id: string) => void
  cols: () => number
}

interface Props {
  sections: MediaSection[]
  tileSize: number
  fit: 'cover' | 'contain'
  selection: Selection
  focusedId: string | null
  renamingId: string | null
  canRename: boolean
  transitionId: string | null
  handlers: TileHandlers
  onEndReached: () => void
  /** Where sticky section headers stop (below the top bar and the toolbar). */
  stickyTop: number
  footer?: React.ReactNode
}

const GAP_X = 18
const GAP_Y = 26

/**
 * The media grid: rows of tiles, virtualised against the window scroll, with sticky date headers. Drag on empty space
 * draws a marquee that selects what it touches (shift / ⌘ adds to the selection).
 */
export const MediaGrid = forwardRef<GridHandle, Props>(function MediaGrid(
  {
    sections,
    tileSize,
    fit,
    selection,
    focusedId,
    renamingId,
    canRename,
    transitionId,
    handlers,
    onEndReached,
    stickyTop,
    footer,
  },
  ref,
) {
  const tc = useT('browser')
  const phone = useIsPhone()
  const [box, size] = useElementSize<HTMLDivElement>()
  const gap = phone ? 10 : GAP_X
  const minTile = phone ? Math.min(tileSize, 150) : tileSize
  const cols = Math.max(phone ? 2 : 1, Math.floor((size.width + gap) / (minTile + gap)) || 1)
  const grouped = sections.length > 1 || !!sections[0]?.label
  const virt = useRef<GroupedVirtuosoHandle & VirtuosoHandle>(null)

  // rows: per section, chunks of `cols` items; plus where each item lives
  const { rows, groupCounts, rowOf } = useMemo(() => {
    const rows: Media[][] = []
    const groupCounts: number[] = []
    const rowOf = new Map<string, number>()
    for (const s of sections) {
      let n = 0
      for (let i = 0; i < s.items.length; i += cols) {
        const chunk = s.items.slice(i, i + cols)
        for (const m of chunk) rowOf.set(m.id, rows.length)
        rows.push(chunk)
        n++
      }
      groupCounts.push(n)
    }
    return { rows, groupCounts, rowOf }
  }, [sections, cols])

  useImperativeHandle(
    ref,
    () => ({
      cols: () => cols,
      reveal: (id) => {
        const el = box.current?.querySelector<HTMLElement>(`[data-media-id="${id}"]`)
        if (el) {
          const r = el.getBoundingClientRect()
          if (r.top < stickyTop + 40 || r.bottom > innerHeight - 20)
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          return
        }
        const row = rowOf.get(id)
        if (row !== undefined)
          virt.current?.scrollToIndex({ index: row, align: 'center', behavior: 'smooth' })
      },
    }),
    [cols, rowOf, stickyTop, box],
  )

  // ── marquee ─────────────────────────────────────────────────────────
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drag = useRef<{
    x: number
    y: number
    base: Set<string>
    moved: boolean
    px: number
    py: number
  } | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const updateMarquee = useCallback(() => {
    const d = drag.current
    if (!d) return
    const y0 = d.y - scrollY
    const x = Math.min(d.x, d.px)
    const y = Math.min(y0, d.py)
    const w = Math.abs(d.px - d.x)
    const h = Math.abs(d.py - y0)
    setMarquee({ x, y, w, h })
    const hit = new Set(d.base)
    for (const el of box.current?.querySelectorAll<HTMLElement>('[data-media-id]') ?? []) {
      const r = el.getBoundingClientRect()
      if (r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) hit.add(el.dataset.mediaId!)
    }
    selection.replace(hit)
  }, [selection, box])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return
    const target = e.target as HTMLElement
    if (target.closest('[data-media-id],button,a,input,[role=menu]')) return
    e.preventDefault()
    drag.current = {
      x: e.clientX,
      y: e.clientY + scrollY,
      px: e.clientX,
      py: e.clientY,
      moved: false,
      base: e.shiftKey || e.metaKey || e.ctrlKey ? new Set(selection.selected) : new Set(),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.px = e.clientX
    d.py = e.clientY
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY + scrollY - d.y) < 5) return
    d.moved = true
    updateMarquee()
    // scroll while dragging near the edges
    const edge = e.clientY > innerHeight - 48 ? 14 : e.clientY < stickyTop + 24 ? -14 : 0
    if (edge && !scrollTimer.current)
      scrollTimer.current = setInterval(() => {
        scrollBy(0, edge)
        updateMarquee()
      }, 16)
    if (!edge && scrollTimer.current) {
      clearInterval(scrollTimer.current)
      scrollTimer.current = null
    }
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (scrollTimer.current) clearInterval(scrollTimer.current)
    scrollTimer.current = null
    setMarquee(null)
    if (d && !d.moved && !d.base.size) selection.clear()
  }
  useEffect(() => () => void (scrollTimer.current && clearInterval(scrollTimer.current)), [])

  const renderRow = (index: number) => {
    const row = rows[index]
    if (!row) return null
    return (
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          columnGap: gap,
          paddingBottom: phone ? 18 : GAP_Y,
        }}
      >
        {row.map((m) => (
          <MediaTile
            key={m.id}
            media={m}
            selected={selection.selected.has(m.id)}
            selecting={selection.selected.size > 0}
            focused={focusedId === m.id && !selection.selected.has(m.id)}
            fit={fit}
            renaming={renamingId === m.id}
            canRename={canRename}
            transitionName={transitionId === m.id ? 'gl-frame' : undefined}
            handlers={handlers}
          />
        ))}
      </div>
    )
  }

  const Footer = useCallback(() => <>{footer}</>, [footer])

  return (
    <div
      ref={box}
      role="listbox"
      aria-multiselectable
      className="relative min-h-[60dvh] touch-pan-y"
      style={{ ['--sticky-top' as string]: `${stickyTop}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {size.width > 0 &&
        (grouped ? (
          <GroupedVirtuoso
            ref={virt}
            useWindowScroll
            increaseViewportBy={800}
            groupCounts={groupCounts}
            endReached={onEndReached}
            components={{ TopItemList, Footer }}
            groupContent={(gi) => {
              const s = sections[gi]!
              return (
                <div className="material-bar -mx-[var(--gutter)] flex h-11 items-center gap-2.5 px-[var(--gutter)]">
                  <span className="t-headline text-ink">{s.label}</span>
                  <span className="t-caption tabular text-ink-4">
                    {tc('count', { count: s.items.length })}
                  </span>
                </div>
              )
            }}
            itemContent={(index) => renderRow(index)}
          />
        ) : (
          <Virtuoso
            ref={virt}
            useWindowScroll
            increaseViewportBy={800}
            totalCount={rows.length}
            endReached={onEndReached}
            components={{ Footer }}
            itemContent={(index) => renderRow(index)}
          />
        ))}
      {marquee && (
        <div
          className="pointer-events-none fixed z-30 rounded-[4px] bg-signal-soft shadow-[inset_0_0_0_1px_var(--signal)]"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
    </div>
  )
})

/** GroupedVirtuoso's sticky header holder, stuck below the top bar and the toolbar. */
const TopItemList = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function TopItemList(props, ref) {
    return <div {...props} ref={ref} style={{ ...props.style, top: 'var(--sticky-top)', zIndex: 20 }} />
  },
)
