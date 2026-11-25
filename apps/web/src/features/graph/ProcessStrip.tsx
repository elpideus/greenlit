import dagre from '@dagrejs/dagre'
import {
  type GraphNode,
  type Lineage,
  type Media,
  type MediaFormat,
  nodeKey,
  type ProcessStep,
  processSteps,
  type UseSpan,
} from '@greenlit/shared'
import type { TFunction } from 'i18next'
import { Network, Workflow, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { browseState } from '@/components/viewer/browse'
import { cn } from '@/lib/cn'
import { useStoredState } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { IconButton, Skeleton } from '@/ui'
import { useLineage } from './api'
import { useProcessStrip } from './store'
import { Thumb } from './Thumb'

const NODE_W = 132
const THUMB_H = 74
const NODE_H = THUMB_H + 40
const PAD_X = 28
const PAD_Y = 14
const DEFAULT_H = 232
const MIN_H = 150

/** In the viewer's top bar: opens the process strip under the picture (`G`). */
export function ProcessTool() {
  const t = useT('graph')
  const open = useProcessStrip((s) => s.open)
  const toggle = useProcessStrip((s) => s.toggle)
  useHotkey('g', toggle)
  return (
    <IconButton
      icon={Workflow}
      label={open ? t('strip.hide') : t('strip.show')}
      shortcut="g"
      active={open}
      onClick={toggle}
    />
  )
}

interface Placed {
  key: string
  node: GraphNode
  x: number
  y: number
  hidden?: { inputs: number; outputs: number }
  related?: boolean
}

/**
 * Under the viewer's picture: where this item stands in the production, as a strip you can pan. What it was made
 * from runs to the left (back to the photos and videos taken), what was made with it to the right (edits, films,
 * posts); for an edit, the time where the item plays in it.
 */
export function ProcessStrip({ media }: { media: Media; format: MediaFormat }) {
  const open = useProcessStrip((s) => s.open)
  if (!open) return null
  return <Strip media={media} />
}

function Strip({ media }: { media: Media }) {
  const t = useT('graph')
  const navigate = useNavigate()
  const setOpen = useProcessStrip((s) => s.setOpen)
  const ref = useMemo(() => ({ type: 'media' as const, id: media.id }), [media.id])
  const { data, isLoading } = useLineage(ref)
  const layout = useMemo(() => (data ? layOut(data) : null), [data])
  const scroller = useRef<HTMLDivElement>(null)

  // Open on the item itself, in the middle.
  useLayoutEffect(() => {
    const el = scroller.current
    const f = layout?.focus
    if (!el || !f) return
    el.scrollLeft = Math.max(0, f.x - el.clientWidth / 2)
    el.scrollTop = Math.max(0, f.y - el.clientHeight / 2 + NODE_H / 2)
  }, [layout])

  // Drag the strip to pan it.
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !scroller.current) return
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      l: scroller.current.scrollLeft,
      t: scroller.current.scrollTop,
      moved: false,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = scroller.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true
      el.setPointerCapture(e.pointerId)
    }
    if (d.moved) {
      el.scrollLeft = d.l - dx
      el.scrollTop = d.t - dy
    }
  }
  const onPointerUp = () => {
    setTimeout(() => (drag.current = null), 0)
  }

  const go = (p: Placed) => {
    if (drag.current?.moved || p.key === nodeKey(ref)) return
    if (p.node.type === 'media' && layout) {
      const ids = layout.order.filter((n) => n.node.type === 'media').map((n) => n.node.id)
      navigate(p.node.href, { state: browseState({ ids }) })
    } else navigate(p.node.href)
  }

  // Drag the top edge to give the strip more room (a film's sources make a tall tree); double-click resets it.
  const [height, setHeight] = useStoredState('graph.stripHeight', DEFAULT_H)
  const resize = useRef<{ y: number; h: number } | null>(null)
  const max = () => Math.round(window.innerHeight * 0.6)

  const before = layout?.before ?? 0
  const after = layout?.after ?? 0
  return (
    <div
      className="relative flex shrink-0 flex-col border-white/[0.07] border-t bg-black/25"
      style={{ height: Math.min(Math.max(MIN_H, height), max()) }}
    >
      <div
        className="group absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize touch-none"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('strip.resize')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          resize.current = { y: e.clientY, h: Math.min(Math.max(MIN_H, height), max()) }
        }}
        onPointerMove={(e) => {
          const r = resize.current
          if (r) setHeight(Math.min(Math.max(MIN_H, r.h + (r.y - e.clientY)), max()))
        }}
        onPointerUp={() => (resize.current = null)}
        onDoubleClick={() => setHeight(DEFAULT_H)}
      >
        <div className="absolute inset-x-0 top-1.5 h-px transition-colors duration-150 group-hover:bg-signal/50 group-active:bg-signal/70" />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <Workflow size={14} className="text-white/50" />
        <span className="t-callout font-medium text-white/85">{t('strip.title')}</span>
        {layout && layout.count > 1 && (
          <span className="t-caption text-white/40">{t('strip.summary', { before, after })}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            icon={Network}
            label={t('strip.openGraph')}
            onClick={() => navigate(`/graph?focus=${encodeURIComponent(nodeKey(ref))}`)}
          />
          <IconButton icon={X} label={t('strip.hide')} shortcut="g" onClick={() => setOpen(false)} />
        </div>
      </div>
      {isLoading ? (
        <div className="flex gap-6 px-7 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] w-[132px] rounded-[8px]" />
          ))}
        </div>
      ) : !layout || layout.count <= 1 ? (
        <div className="grid flex-1 place-items-center px-6 pb-4 text-center">
          <div>
            <p className="t-callout text-white/75">{t('strip.empty')}</p>
            <p className="mt-1 t-caption text-white/40">{t('strip.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <div
          ref={scroller}
          className="relative min-h-0 flex-1 cursor-grab select-none overflow-auto active:cursor-grabbing [scrollbar-width:thin]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg
              className="pointer-events-none absolute inset-0"
              width={layout.width}
              height={layout.height}
              aria-hidden
            >
              {layout.edges.map((e) => (
                <path
                  key={e.key}
                  d={e.d}
                  fill="none"
                  stroke={e.lit ? 'var(--signal)' : 'rgba(255,255,255,0.22)'}
                  strokeWidth={e.lit ? 1.6 : 1.2}
                  strokeDasharray={e.dash}
                />
              ))}
            </svg>
            {layout.edges
              .filter((e) => e.label)
              .map((e) => (
                <span
                  key={`${e.key}-label`}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[5px] bg-[#111] px-1.5 py-px t-meta text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  style={{ left: e.lx, top: e.ly }}
                >
                  {e.label}
                </span>
              ))}
            {layout.placed.map((p) => {
              const me = p.key === nodeKey(ref)
              return (
                <button
                  key={p.key}
                  type="button"
                  title={p.node.title}
                  onClick={() => go(p)}
                  className={cn('press absolute flex flex-col gap-1.5 text-left', !me && 'cursor-pointer')}
                  style={{ left: p.x - NODE_W / 2, top: p.y - NODE_H / 2, width: NODE_W }}
                >
                  <Thumb
                    node={p.node}
                    className={cn(
                      'h-[74px] w-full rounded-[8px]',
                      me
                        ? 'shadow-[0_0_0_2px_var(--signal)]'
                        : 'opacity-85 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:opacity-100',
                    )}
                  />
                  <span className="block w-full">
                    <span className={cn('block truncate t-caption', me ? 'text-white' : 'text-white/75')}>
                      {p.node.title || t('untitled')}
                    </span>
                    <span className="block truncate t-micro text-white/40">
                      {me ? t('strip.here') : p.related ? t('relations.related.forward') : meta(p, t)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function meta(p: Placed, t: TFunction) {
  const kind = p.node.type === 'media' ? t(`common:kind.${p.node.kind ?? 'other'}`) : t(`type.${p.node.type}`)
  const more = p.hidden
    ? [
        p.hidden.inputs ? t('strip.moreInputs', { count: p.hidden.inputs }) : '',
        p.hidden.outputs ? t('strip.moreOutputs', { count: p.hidden.outputs }) : '',
      ].filter(Boolean)
    : []
  return [kind, ...more].join(' · ')
}

const clock = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  const whole = Math.abs(sec - Math.round(sec)) < 0.05
  return `${m}:${whole ? String(Math.round(sec)).padStart(2, '0') : sec.toFixed(1).padStart(4, '0')}`
}
const spanLabel = (spans: UseSpan[]) => {
  const [a] = spans
  if (!a) return ''
  const first = `${clock(a.start)}–${clock(a.start + a.duration)}`
  return spans.length > 1 ? `${first} +${spans.length - 1}` : first
}

/** A point on a cubic Bézier curve (for placing a line's label). */
function pointOn(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const u = 1 - t
  const f = (i: number) => u ** 3 * p0[i]! + 3 * u * u * t * p1[i]! + 3 * u * t * t * p2[i]! + t ** 3 * p3[i]!
  return { lx: f(0), ly: f(1) }
}

/** The lineage laid out left to right with dagre: one column per step, the item highlighted, related ones beside it. */
function layOut(l: Lineage) {
  const focus = nodeKey(l.focus)
  const nodes = new Map(l.nodes.map((n) => [nodeKey(n), n]))
  const { steps, related } = processSteps(l.edges)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 64, marginx: PAD_X, marginy: PAD_Y })
  g.setDefaultEdgeLabel(() => ({}))
  const relatedKeys = new Set<string>()
  for (const [a, b] of related) {
    if (a === focus && nodes.has(b)) relatedKeys.add(b)
    if (b === focus && nodes.has(a)) relatedKeys.add(a)
  }
  for (const [k] of nodes) if (!relatedKeys.has(k)) g.setNode(k, { width: NODE_W, height: NODE_H })
  const used: ProcessStep[] = []
  for (const s of steps) {
    if (!g.hasNode(s.up) || !g.hasNode(s.down)) continue
    g.setEdge(s.up, s.down)
    used.push(s)
  }
  dagre.layout(g)
  const placed: Placed[] = []
  for (const k of g.nodes()) {
    const pos = g.node(k)
    const n = nodes.get(k)
    if (!pos || !n) continue
    placed.push({ key: k, node: n, x: pos.x, y: pos.y, hidden: l.hidden[k] })
  }
  const at = new Map(placed.map((p) => [p.key, p]))
  const me = at.get(focus)
  // Related items stand in the item's column, under everything there.
  if (me) {
    let y = Math.max(...placed.filter((p) => Math.abs(p.x - me.x) < 1).map((p) => p.y)) + NODE_H + 18
    for (const k of relatedKeys) {
      const n = nodes.get(k)!
      const p = { key: k, node: n, x: me.x, y, related: true }
      placed.push(p)
      at.set(k, p)
      y += NODE_H + 18
    }
  }
  const chainKeys = new Set(placed.map((p) => p.key))
  const edges = used.map((s) => {
    const a = at.get(s.up)!
    const b = at.get(s.down)!
    const x1 = a.x + NODE_W / 2
    const y1 = a.y - NODE_H / 2 + THUMB_H / 2
    const x2 = b.x - NODE_W / 2
    const y2 = b.y - NODE_H / 2 + THUMB_H / 2
    const c = Math.max(24, (x2 - x1) / 2)
    return {
      key: s.key,
      d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`,
      lit: s.up === focus || s.down === focus,
      dash: s.relation === 'reference_for' ? '5 4' : undefined,
      label: s.spans.length ? spanLabel(s.spans) : '',
      // A third of the way along, so labels of lines meeting at one item stay apart.
      ...pointOn([x1, y1], [x1 + c, y1], [x2 - c, y2], [x2, y2], 0.32),
    }
  })
  if (me)
    for (const k of relatedKeys) {
      const p = at.get(k)!
      const x = me.x - NODE_W / 2 - 10
      const y1 = me.y - NODE_H / 2 + THUMB_H / 2
      const y2 = p.y - NODE_H / 2 + THUMB_H / 2
      edges.push({
        key: `rel-${k}`,
        d: `M${me.x - NODE_W / 2},${y1} C${x - 14},${y1} ${x - 14},${y2} ${p.x - NODE_W / 2},${y2}`,
        lit: false,
        dash: '2 3',
        label: '',
        lx: 0,
        ly: 0,
      })
    }
  const width = Math.max(...placed.map((p) => p.x + NODE_W / 2)) + PAD_X
  const height = Math.max(...placed.map((p) => p.y + NODE_H / 2)) + PAD_Y
  const order = [...placed].sort((a, b) => a.x - b.x || a.y - b.y)
  return {
    placed,
    edges,
    width,
    height,
    focus: me ?? null,
    order,
    count: chainKeys.size,
    before: me ? new Set(placed.filter((p) => !p.related && p.x < me.x - 1).map((p) => p.key)).size : 0,
    after: me ? new Set(placed.filter((p) => !p.related && p.x > me.x + 1).map((p) => p.key)).size : 0,
  }
}
