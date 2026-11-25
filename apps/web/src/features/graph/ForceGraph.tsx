import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { chainOf, type GLink, type GNode, type GraphModel, linksWithin, type Stage } from './model'

export interface ForceGraphHandle {
  zoomBy: (factor: number) => void
  fit: () => void
  /** Bring an item into the middle of the view, a little closer. */
  focus: (key: string) => void
}

interface Props {
  model: GraphModel
  selected: string | null
  onSelect: (key: string | null) => void
  onOpen: (key: string) => void
  /** Columns from left to right by step of the process, one band per project. */
  arrange: boolean
  arrows: boolean
  /** Keys matching the search, drawn lit while it is open. */
  matches?: Set<string> | null
  label: string
  /** Shown for items without a title. */
  untitled: string
  /** Room taken on the right (an open card): items are brought into view in the rest. */
  insetRight?: number
}

/** A camera over the world: screen = world × k + (x, y). */
interface Camera {
  x: number
  y: number
  k: number
}

const MIN_K = 0.12
const MAX_K = 6
/** Column width and band height when arranged by process. */
const COLUMN = 150
const BAND_GAP = 220

/**
 * The production graph drawn like a mind map: items are dots that settle by themselves (each project gathers in its
 * own cloud), lines are the links, labels and pictures come in as you zoom. Hover lights an item and its neighbours,
 * a click lights its whole chain (what it was made from and what was made with it); drag moves an item, the
 * background pans, the wheel zooms.
 */
export const ForceGraph = forwardRef<ForceGraphHandle, Props>(function ForceGraph(
  { model, selected, onSelect, onOpen, arrange, arrows, matches, label, untitled, insetRight = 0 },
  ref,
) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const sim = useRef<Simulation<GNode, GLink> | null>(null)
  const hover = useRef<string | null>(null)
  const draw = useRef<() => void>(() => {})
  const fitted = useRef(false)
  const anim = useRef<number | null>(null)
  const state = useRef({ model, selected, arrows, matches, arrange, insetRight })
  state.current = { model, selected, arrows, matches, arrange, insetRight }

  const palette = usePalette(wrap, () => draw.current())
  const images = useImages(() => draw.current())

  // ── camera ──────────────────────────────────────────────────────────
  const size = () => {
    const el = wrap.current
    return { w: el?.clientWidth ?? 1, h: el?.clientHeight ?? 1 }
  }
  const animateTo = (to: Camera, ms = 420) => {
    if (anim.current) cancelAnimationFrame(anim.current)
    const from = { ...cam.current }
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - (1 - p) ** 3
      cam.current = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: from.k + (to.k - from.k) * e,
      }
      draw.current()
      anim.current = p < 1 ? requestAnimationFrame(step) : null
    }
    anim.current = requestAnimationFrame(step)
  }
  const fitTo = (nodes: GNode[], animate = true) => {
    const placed = nodes.filter((n) => Number.isFinite(n.x))
    if (!placed.length) return
    const { w, h } = size()
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const n of placed) {
      x0 = Math.min(x0, n.x - n.r)
      y0 = Math.min(y0, n.y - n.r)
      x1 = Math.max(x1, n.x + n.r)
      y1 = Math.max(y1, n.y + n.r)
    }
    const pad = 80
    const k = clamp(
      Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0)),
      MIN_K,
      2.2,
    )
    const to = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k }
    if (animate) animateTo(to)
    else {
      cam.current = to
      draw.current()
    }
  }
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const c = cam.current
    const k = clamp(c.k * factor, MIN_K, MAX_K)
    const f = k / c.k
    cam.current = { k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f }
    draw.current()
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const { w, h } = size()
      const c = cam.current
      const k = clamp(c.k * factor, MIN_K, MAX_K)
      const f = k / c.k
      animateTo({ k, x: w / 2 - (w / 2 - c.x) * f, y: h / 2 - (h / 2 - c.y) * f }, 220)
    },
    fit: () => fitTo(state.current.model.nodes),
    focus: (key) => {
      const n = state.current.model.byKey.get(key)
      if (!n || !Number.isFinite(n.x)) return
      const { w, h } = size()
      const k = Math.max(cam.current.k, 1.5)
      const cx = (w - state.current.insetRight) / 2
      animateTo({ k, x: cx - n.x * k, y: h / 2 - n.y * k })
    },
  }))

  // ── drawing ─────────────────────────────────────────────────────────
  let frame = 0
  draw.current = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }
  const paint = () => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const { w, h } = size()
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
    }
    const { model: m, selected: sel, arrows: showArrows, matches: found } = state.current
    const c = cam.current
    const p = palette.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // What is lit: the selected item's chain, else the hovered item and its neighbours, else the search matches.
    const hov = hover.current
    let lit: Set<string> | null = null
    let litLinks: Set<string> | null = null
    let chain = false
    if (sel && m.byKey.has(sel)) {
      lit = chainOf(m, sel)
      for (const l of m.links)
        if (l.relation === 'related' && (l.source.key === sel || l.target.key === sel)) {
          lit.add(l.source.key)
          lit.add(l.target.key)
        }
      litLinks = linksWithin(m, lit)
      chain = true
    } else if (hov && m.byKey.has(hov)) {
      lit = new Set([hov, ...(m.neighbors.get(hov) ?? [])])
      litLinks = new Set(
        m.links.filter((l) => l.source.key === hov || l.target.key === hov).map((l) => l.key),
      )
    } else if (found?.size) {
      lit = found
      litLinks = new Set()
    }
    if (hov && lit && !lit.has(hov) && m.byKey.has(hov)) lit = new Set([...lit, hov])

    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.scale(c.k, c.k)

    // Project names over their clouds while far out.
    const nameAlpha = clamp((1.5 - c.k) / 0.8, 0, 1)
    if (nameAlpha > 0.02 && m.groups.length > 1) {
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `600 14px ${p.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (const g of m.groups) {
        const ns = m.nodes.filter((n) => n.group === g.id && Number.isFinite(n.x))
        if (!ns.length) continue
        let minY = Number.POSITIVE_INFINITY
        let sx = 0
        for (const n of ns) {
          minY = Math.min(minY, n.y - n.r)
          sx += n.x
        }
        const x = (sx / ns.length) * c.k + c.x
        const y = minY * c.k + c.y - 14
        ctx.globalAlpha = nameAlpha * (lit ? 0.45 : 0.9)
        ctx.fillStyle = p.ink2
        ctx.fillText(g.name, x, y)
      }
      ctx.restore()
    }

    // Links.
    const px = 1 / c.k
    for (const l of m.links) {
      const a = l.source
      const b = l.target
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue
      const on = !!litLinks?.has(l.key)
      const dim = !!lit && !on
      ctx.globalAlpha = dim ? 0.06 : on ? 0.95 : 0.55
      ctx.strokeStyle = on ? (chain ? p.signal : p.ink2) : p.ink3
      ctx.lineWidth = (on ? 1.8 : 1.1) * px
      ctx.setLineDash(
        l.relation === 'related' ? [2 * px, 3 * px] : l.relation === 'reference_for' ? [5 * px, 4 * px] : [],
      )
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const ex = b.x - ux * (b.r + 1.5 * px)
      const ey = b.y - uy * (b.r + 1.5 * px)
      ctx.beginPath()
      ctx.moveTo(a.x + ux * a.r, a.y + uy * a.r)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      if (showArrows && l.relation !== 'related' && c.k > 0.45 && !dim) {
        const s = Math.min(6 * px, b.r * 0.9)
        ctx.setLineDash([])
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - ux * s * 1.6 - uy * s * 0.8, ey - uy * s * 1.6 + ux * s * 0.8)
        ctx.lineTo(ex - ux * s * 1.6 + uy * s * 0.8, ey - uy * s * 1.6 - ux * s * 0.8)
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.setLineDash([])

    // Nodes.
    for (const n of m.nodes) {
      if (!Number.isFinite(n.x)) continue
      const on = !lit || lit.has(n.key)
      ctx.globalAlpha = on ? 1 : 0.14
      const colour = p.stage[n.stage]
      const screenR = n.r * c.k
      const img = screenR >= 15 && n.node.thumbnailUrl ? images.get(n.node.thumbnailUrl) : null
      shape(ctx, n)
      if (img) {
        ctx.save()
        ctx.clip()
        const s = Math.max((n.r * 2) / img.width, (n.r * 2) / img.height)
        ctx.drawImage(
          img,
          n.x - (img.width * s) / 2,
          n.y - (img.height * s) / 2,
          img.width * s,
          img.height * s,
        )
        ctx.restore()
        shape(ctx, n)
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = colour
        ctx.stroke()
      } else {
        ctx.fillStyle = colour
        ctx.fill()
        if (n.stage === 'post') {
          ctx.lineWidth = 1.5 * px
          ctx.strokeStyle = p.canvas
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r * 0.55, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      if (n.key === sel || n.key === hov) {
        shape(ctx, n, 3.5 * px)
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = n.key === sel ? p.signal : p.ink
        ctx.stroke()
      }
    }

    ctx.restore()
    ctx.globalAlpha = 1

    // Labels, at a steady size: the selected, hovered and lit ones first, then the busiest; never one on another.
    const fontPx = 11.5
    ctx.font = `450 ${fontPx}px ${p.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const rank = (n: GNode) =>
      n.key === sel || n.key === hov ? 0 : lit?.has(n.key) ? 1 : n.stage === 'final' ? 2 : 3
    const candidates = m.nodes
      .filter((n) => {
        if (!Number.isFinite(n.x)) return false
        if (n.key === sel || n.key === hov) return true
        if (lit) return lit.has(n.key) && c.k > 0.35
        return c.k > 0.75 || (c.k > 0.45 && (n.stage === 'final' || n.degree >= 5))
      })
      .sort((a, b) => rank(a) - rank(b) || b.degree - a.degree)
    const boxes: [number, number, number, number][] = []
    for (const n of candidates) {
      const text = ellipsize(n.node.title || untitled, 30)
      const sx = n.x * c.k + c.x
      const sy = (n.y + n.r) * c.k + c.y + 4
      if (sx < -100 || sx > w + 100 || sy < -20 || sy > h + 20) continue
      const tw = ctx.measureText(text).width
      const box: [number, number, number, number] = [
        sx - tw / 2 - 3,
        sy - 1,
        sx + tw / 2 + 3,
        sy + fontPx + 2,
      ]
      if (rank(n) > 0 && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]))
        continue
      boxes.push(box)
      ctx.globalAlpha = 1
      ctx.fillStyle = n.key === sel || n.key === hov ? p.ink : p.ink2
      ctx.fillText(text, sx, sy)
    }
  }

  // ── simulation ──────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt when the model or the arrangement changes
  useEffect(() => {
    const { w, h } = size()
    const groups = model.groups.map((g) => g.id)
    const total = model.nodes.length
    const spread = groups.length > 1 ? 140 + Math.sqrt(total) * 34 : 0
    const anchor = new Map<string, { x: number; y: number }>()
    groups.forEach((g, i) => {
      if (arrange) {
        anchor.set(g, { x: 0, y: i * BAND_GAP * Math.max(1, Math.sqrt(total) / 6) })
      } else {
        const a = (i / groups.length) * Math.PI * 2 - Math.PI / 2
        anchor.set(g, { x: Math.cos(a) * spread, y: Math.sin(a) * spread * 0.7 })
      }
    })
    const mid = model.maxRank / 2
    for (const n of model.nodes)
      if (!Number.isFinite(n.x)) {
        const a = anchor.get(n.group) ?? { x: 0, y: 0 }
        n.x = (arrange ? (n.rank - mid) * COLUMN : a.x) + (Math.random() - 0.5) * 120
        n.y = a.y + (Math.random() - 0.5) * 120
      }

    const s = forceSimulation<GNode, GLink>(model.nodes)
      .force(
        'link',
        forceLink<GNode, GLink>(model.links)
          .id((d) => d.key)
          .distance((l) => (l.relation === 'related' ? 60 : 34) + l.source.r + l.target.r)
          .strength((l) => (l.relation === 'related' || l.relation === 'reference_for' ? 0.15 : 0.55)),
      )
      .force(
        'charge',
        forceManyBody<GNode>()
          .strength((d) => -40 - d.r * 6)
          .distanceMax(420),
      )
      .force(
        'collide',
        forceCollide<GNode>((d) => d.r + 4),
      )
      .force(
        'x',
        forceX<GNode>((d) => (arrange ? (d.rank - mid) * COLUMN : (anchor.get(d.group)?.x ?? 0))).strength(
          (d) => (arrange ? (d.stage === 'loose' ? 0.05 : 0.6) : 0.05),
        ),
      )
      .force('y', forceY<GNode>((d) => anchor.get(d.group)?.y ?? 0).strength(arrange ? 0.12 : 0.05))
      .alphaDecay(0.025)
      .stop()
    // Settle most of the way before the first picture, so it opens calm; the rest plays out live.
    const warm = fitted.current ? 0 : 160
    for (let i = 0; i < warm; i++) s.tick()
    if (fitted.current) s.alpha(0.6)
    s.on('tick', () => draw.current())
    s.restart()
    sim.current = s
    if (!fitted.current && w > 1 && h > 1) {
      fitted.current = true
      fitTo(model.nodes, false)
    } else draw.current()
    return () => {
      s.stop()
    }
  }, [model, arrange])

  // Redraw on what changes the picture but not the layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draw is a ref
  useEffect(() => draw.current(), [selected, arrows, matches])

  // ── pointer ─────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read live state through refs
  useEffect(() => {
    const el = canvas.current
    const box = wrap.current
    if (!el || !box) return
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const toWorld = (x: number, y: number) => ({
      x: (x - cam.current.x) / cam.current.k,
      y: (y - cam.current.y) / cam.current.k,
    })
    const hit = (sx: number, sy: number): GNode | null => {
      const w = toWorld(sx, sy)
      let best: GNode | null = null
      let bestD = Number.POSITIVE_INFINITY
      const slack = 5 / cam.current.k
      for (const n of state.current.model.nodes) {
        const d = Math.hypot(n.x - w.x, n.y - w.y) - n.r
        if (d < slack && d < bestD) {
          best = n
          bestD = d
        }
      }
      return best
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { node: GNode | null; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null =
      null
    let pinch: { d: number; k: number } | null = null
    let lastClick = { key: '', t: 0 }

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      el.setPointerCapture(e.pointerId)
      const pt = local(e)
      pointers.set(e.pointerId, pt)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: cam.current.k }
        drag = null
        return
      }
      const node = hit(pt.x, pt.y)
      drag = { node, sx: pt.x, sy: pt.y, cx: cam.current.x, cy: cam.current.y, moved: false }
      if (anim.current) cancelAnimationFrame(anim.current)
    }
    const move = (e: PointerEvent) => {
      const pt = local(e)
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt)
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const mx = (a!.x + b!.x) / 2
        const my = (a!.y + b!.y) / 2
        zoomAt((pinch.k * (d / pinch.d)) / cam.current.k, mx, my)
        return
      }
      if (drag) {
        const dx = pt.x - drag.sx
        const dy = pt.y - drag.sy
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true
          if (drag.node) sim.current?.alphaTarget(0.25).restart()
        }
        if (!drag.moved) return
        if (drag.node) {
          const w = toWorld(pt.x, pt.y)
          drag.node.fx = w.x
          drag.node.fy = w.y
        } else {
          cam.current = { ...cam.current, x: drag.cx + dx, y: drag.cy + dy }
        }
        draw.current()
        return
      }
      const n = hit(pt.x, pt.y)
      const key = n?.key ?? null
      if (key !== hover.current) {
        hover.current = key
        el.style.cursor = key ? 'pointer' : 'grab'
        draw.current()
      }
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pinch) {
        if (pointers.size < 2) pinch = null
        return
      }
      const d = drag
      drag = null
      if (!d) return
      if (d.node && d.moved) {
        d.node.fx = null
        d.node.fy = null
        sim.current?.alphaTarget(0)
        return
      }
      if (d.moved) return
      const key = d.node?.key ?? null
      const now = performance.now()
      if (key && lastClick.key === key && now - lastClick.t < 320) {
        lastClick = { key: '', t: 0 }
        onOpen(key)
        return
      }
      lastClick = { key: key ?? '', t: now }
      onSelect(key)
    }
    const leave = () => {
      if (hover.current) {
        hover.current = null
        draw.current()
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const pt = local(e)
      // Pinch on a trackpad arrives as ctrl+wheel with small deltas.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))
      zoomAt(factor, pt.x, pt.y)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(() => draw.current())
    ro.observe(box)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={wrap} className="absolute inset-0">
      <canvas
        ref={canvas}
        className="block size-full touch-none"
        style={{ cursor: 'grab' }}
        role="img"
        aria-label={label}
      />
    </div>
  )
})

function shape(ctx: CanvasRenderingContext2D, n: GNode, grow = 0) {
  const r = n.r + grow
  ctx.beginPath()
  if (n.stage === 'edit') {
    const s = r * 0.9
    const rr = s * 0.35
    ctx.roundRect(n.x - s, n.y - s, s * 2, s * 2, rr)
  } else ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const ellipsize = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

interface Palette {
  stage: Record<Stage, string>
  ink: string
  ink2: string
  ink3: string
  line: string
  signal: string
  canvas: string
  font: string
}

/** The theme's colours as canvas colours, read again when the theme or mode changes. */
function usePalette(host: React.RefObject<HTMLDivElement | null>, onChange: () => void) {
  const pal = useRef<Palette>({
    stage: { loose: '#555', source: '#777', made: '#aaa', final: '#4c7', edit: '#aaa', post: '#6af' },
    ink: '#eee',
    ink2: '#aaa',
    ink3: '#777',
    line: '#444',
    signal: '#4c7',
    canvas: '#000',
    font: 'sans-serif',
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads once and on theme changes
  useEffect(() => {
    const read = () => {
      const el = host.current
      if (!el) return
      const probe = document.createElement('span')
      probe.style.display = 'none'
      el.appendChild(probe)
      const col = (v: string) => {
        probe.style.color = `var(${v})`
        return getComputedStyle(probe).color
      }
      pal.current = {
        stage: {
          loose: col('--ink-4'),
          source: col('--ink-3'),
          made: col('--ink-2'),
          edit: col('--ink-2'),
          final: col('--signal'),
          post: col('--cue'),
        },
        ink: col('--ink'),
        ink2: col('--ink-2'),
        ink3: col('--ink-3'),
        line: col('--line-strong'),
        signal: col('--signal'),
        canvas: col('--canvas'),
        font: getComputedStyle(el).fontFamily || 'sans-serif',
      }
      probe.remove()
      onChange()
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode', 'style', 'class'],
    })
    return () => mo.disconnect()
  }, [])
  return pal
}

/** Thumbnails for the dots, loaded the first time they are big enough to show. */
function useImages(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement | 'loading' | 'error'>())
  return {
    get(url: string): HTMLImageElement | null {
      const have = cache.current.get(url)
      if (have instanceof HTMLImageElement) return have
      if (have) return null
      cache.current.set(url, 'loading')
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => {
        cache.current.set(url, img)
        onLoad()
      }
      img.onerror = () => cache.current.set(url, 'error')
      img.src = url
      return null
    },
  }
}
