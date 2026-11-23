import { type ClipState, type Op, visibleClips } from '@greenlit/composition'
import { placements } from '@greenlit/platforms'
import { type AssetResolver, Stage } from '@greenlit/player'
import { RotateCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useElementSize } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { round, setProp } from '../edits'
import { currentFormat, dispatch, editingOverride, preview, useDoc, useEditor } from '../store'
import { topClipAt } from './actions'

const get = useEditor.getState
const set = useEditor.setState

type Mode = 'move' | 'scale' | 'rotate'
interface Gesture {
  mode: Mode
  id: string
  x0: number
  y0: number
  state: ClipState
  anchor: { x: number; y: number }
  angle0: number
  dist0: number
  moved: boolean
  ops: Op[] | null
}

/** The live preview: the Stage drawn at the format's size, fitted to the room, with handles on the selection. */
export function Viewport({ assets }: { assets: AssetResolver }) {
  const t = useT('editor')
  const doc = useDoc()
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const rate = useEditor((s) => s.rate)
  const selection = useEditor((s) => s.selection)
  const formatId = useEditor((s) => s.formatId)
  const guides = useEditor((s) => s.guides)
  const readOnly = useEditor((s) => s.readOnly)
  const format = currentFormat({ doc, draft: null, formatId })
  const override = useEditor((s) => editingOverride(s))
  const [box, size] = useElementSize<HTMLDivElement>()
  const gesture = useRef<Gesture | null>(null)
  const [lines, setLines] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })

  const pad = 40
  const k =
    size.width && size.height
      ? Math.min((size.width - pad * 2) / format.width, (size.height - pad * 2) / format.height)
      : 0
  const w = format.width * k
  const h = format.height * k
  const left = (size.width - w) / 2
  const top = (size.height - h) / 2

  const states = useMemo(() => (doc ? visibleClips(doc, time, format) : []), [doc, time, format])
  const selectedStates = states.filter((s) => selection.includes(s.clip.id))

  const toComp = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: (clientX - r.left - left) / k, y: (clientY - r.top - top) / k }
  }

  const hit = (p: { x: number; y: number }) => {
    for (const s of [...states].reverse()) {
      const ox = s.x + s.dx
      const oy = s.y + s.dy
      const ax = ox + s.anchorX * s.width
      const ay = oy + s.anchorY * s.height
      const sc = s.scale * s.dscale || 1
      const r = (-s.rotation * Math.PI) / 180
      const vx = (p.x - ax) / sc
      const vy = (p.y - ay) / sc
      const qx = ax + vx * Math.cos(r) - vy * Math.sin(r)
      const qy = ay + vx * Math.sin(r) + vy * Math.cos(r)
      if (qx >= ox && qx <= ox + s.width && qy >= oy && qy <= oy + s.height) return s
    }
    return null
  }

  const begin = (e: React.PointerEvent, mode: Mode, s: ClipState) => {
    e.stopPropagation()
    if (readOnly || s.clip.locked) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const ox = s.x + s.dx
    const oy = s.y + s.dy
    const anchor = { x: ox + s.anchorX * s.width, y: oy + s.anchorY * s.height }
    const p = toComp(e.clientX, e.clientY)
    gesture.current = {
      mode,
      id: s.clip.id,
      x0: p.x,
      y0: p.y,
      state: s,
      anchor,
      angle0: Math.atan2(p.y - anchor.y, p.x - anchor.x),
      dist0: Math.hypot(p.x - anchor.x, p.y - anchor.y) || 1,
      moved: false,
      ops: null,
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const p = toComp(e.clientX, e.clientY)
    if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) * k < 3) return
    g.moved = true
    const d = get().doc!
    const tNow = get().time
    const s = g.state
    let ops: Op[] = []
    const v: number[] = []
    const hz: number[] = []
    if (g.mode === 'move') {
      let nx = s.x + (p.x - g.x0)
      let ny = s.y + (p.y - g.y0)
      // smart guides: frame edges and centre against the box's edges and centre
      const tol = 6 / k
      const sw = s.width
      const sh = s.height
      for (const [target, offs] of [
        [0, [0, sw / 2, sw]],
        [format.width / 2, [0, sw / 2, sw]],
        [format.width, [0, sw / 2, sw]],
      ] as const)
        for (const o of offs)
          if (!e.altKey && Math.abs(nx + o - target) < tol) {
            nx = target - o
            v.push(target)
          }
      for (const [target, offs] of [
        [0, [0, sh / 2, sh]],
        [format.height / 2, [0, sh / 2, sh]],
        [format.height, [0, sh / 2, sh]],
      ] as const)
        for (const o of offs)
          if (!e.altKey && Math.abs(ny + o - target) < tol) {
            ny = target - o
            hz.push(target)
          }
      if (e.shiftKey) {
        if (Math.abs(p.x - g.x0) > Math.abs(p.y - g.y0)) ny = s.y
        else nx = s.x
      }
      ops = [
        ...setProp(d, g.id, 'transform.x', round(nx), tNow, formatId),
        ...setProp(d, g.id, 'transform.y', round(ny), tNow, formatId),
      ]
      // a full-frame media clip has no size of its own yet: give it the frame size so moving keeps it
      if (!s.clip.transform.width && !override)
        ops.push({ op: 'update_clip', id: g.id, patch: { transform: { width: s.width, height: s.height } } })
    } else if (g.mode === 'scale') {
      const dist = Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y)
      let sc = Math.max(0.02, (s.scale * dist) / g.dist0)
      if (e.shiftKey) sc = Math.round(sc * 20) / 20
      ops = setProp(d, g.id, 'transform.scale', round(sc), tNow, formatId)
    } else {
      const a = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x)
      let r = s.rotation + ((a - g.angle0) * 180) / Math.PI
      if (e.shiftKey) r = Math.round(r / 15) * 15
      ops = setProp(d, g.id, 'transform.rotation', Math.round(r * 10) / 10, tNow, formatId)
    }
    g.ops = ops
    setLines({ v, h: hz })
    preview(ops)
  }

  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    setLines({ v: [], h: [] })
    if (g?.moved && g.ops)
      dispatch(g.ops, { label: g.mode === 'move' ? 'Move' : g.mode === 'scale' ? 'Scale' : 'Rotate' })
  }

  const guide = guides ? placements.find((p) => p.key === guides) : null

  return (
    <div
      ref={box}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--stage),white_3%),var(--stage)_70%)]"
    >
      {doc && k > 0 && (
        <>
          <div
            className="absolute overflow-hidden rounded-[3px] shadow-[0_30px_80px_-20px_rgba(0,0,0,.8),0_0_0_1px_rgba(255,255,255,.06)]"
            style={{ left, top, width: w, height: h }}
          >
            <div
              style={{
                width: format.width,
                height: format.height,
                transform: `scale(${k})`,
                transformOrigin: '0 0',
                pointerEvents: 'none',
              }}
            >
              <Stage
                comp={doc}
                format={format}
                time={time}
                playing={playing && rate === 1}
                mode="preview"
                assets={assets}
              />
            </div>
          </div>

          {/* interaction layer */}
          <div
            className="absolute"
            style={{ left, top, width: w, height: h }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const p = toComp(e.clientX, e.clientY)
              const s = hit(p)
              if (!s) {
                set({ selection: [] })
                return
              }
              if (!selection.includes(s.clip.id)) set({ selection: [s.clip.id], rightTab: 'inspector' })
              begin(e, 'move', s)
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onDoubleClick={(e) => {
              const c = doc && topClipAt(doc, time, formatId)
              if (c && !hit(toComp(e.clientX, e.clientY))) set({ selection: [c.id] })
            }}
          >
            {guide?.safeZone && <SafeGuides zone={guide.safeZone} label={guide.label} />}
            {selectedStates.map((s) => (
              <Handles
                key={s.clip.id}
                s={s}
                k={k}
                readOnly={readOnly || s.clip.locked}
                onBegin={begin}
                onMove={onMove}
                onUp={onUp}
              />
            ))}
            {lines.v.map((x) => (
              <div
                key={`v${x}`}
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-review"
                style={{ left: x * k }}
              />
            ))}
            {lines.h.map((y) => (
              <div
                key={`h${y}`}
                className="pointer-events-none absolute right-0 left-0 h-px bg-review"
                style={{ top: y * k }}
              />
            ))}
          </div>

          <AnimatePresence>
            {override && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease }}
                className="force-dark pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1 t-caption text-white/90 backdrop-blur-md"
                title={t('bar.overrideHint', { format: format.name })}
              >
                <span className="size-1.5 rounded-full bg-cue" />
                {t('bar.override', { format: format.name })}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

function Handles({
  s,
  k,
  readOnly,
  onBegin,
  onMove,
  onUp,
}: {
  s: ClipState
  k: number
  readOnly: boolean
  onBegin: (e: React.PointerEvent, m: Mode, s: ClipState) => void
  onMove: (e: React.PointerEvent) => void
  onUp: () => void
}) {
  const sc = s.scale * s.dscale || 1
  const inv = 1 / sc
  const knob = (pos: string, cursor: string) => (
    <span
      key={pos}
      onPointerDown={(e) => onBegin(e, 'scale', s)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      className={cn(
        'absolute size-[11px] rounded-[3px] bg-white shadow-[0_0_0_1.5px_var(--signal),0_2px_6px_rgba(0,0,0,.5)]',
        pos,
      )}
      style={{ cursor, transform: `translate(-50%, -50%) scale(${inv})` }}
    />
  )
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: (s.x + s.dx) * k,
        top: (s.y + s.dy) * k,
        width: s.width * k,
        height: s.height * k,
        transform: `rotate(${s.rotation}deg) scale(${sc})`,
        transformOrigin: `${s.anchorX * 100}% ${s.anchorY * 100}%`,
      }}
    >
      <div className="absolute inset-0" style={{ boxShadow: `0 0 0 ${1.5 * inv}px var(--signal)` }} />
      {!readOnly && (
        <div className="pointer-events-auto">
          {knob('left-0 top-0', 'nwse-resize')}
          {knob('left-full top-0', 'nesw-resize')}
          {knob('left-0 top-full', 'nesw-resize')}
          {knob('left-full top-full', 'nwse-resize')}
          <span
            onPointerDown={(e) => onBegin(e, 'rotate', s)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            className="absolute left-1/2 grid size-6 cursor-grab place-items-center rounded-full bg-white text-[#0c0d0c] shadow-[0_0_0_1.5px_var(--signal),0_2px_6px_rgba(0,0,0,.5)]"
            style={{ top: -30 * inv, transform: `translate(-50%, -50%) scale(${inv})` }}
          >
            <RotateCw size={12} strokeWidth={2.4} />
          </span>
          <span
            className="absolute left-1/2 w-px bg-signal"
            style={{ top: -22 * inv, height: 22 * inv, transform: 'translateX(-50%)' }}
          />
        </div>
      )}
    </div>
  )
}

function SafeGuides({
  zone,
  label,
}: {
  zone: {
    top: number
    bottom: number
    left: number
    right: number
    regions: { label: string; x: number; y: number; w: number; h: number }[]
  }
  label: string
}) {
  const shade =
    'bg-[repeating-linear-gradient(135deg,rgba(247,93,89,.16)_0_6px,rgba(247,93,89,.06)_6px_12px)]'
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className={cn('absolute inset-x-0 top-0', shade)} style={{ height: `${zone.top * 100}%` }} />
      <div className={cn('absolute inset-x-0 bottom-0', shade)} style={{ height: `${zone.bottom * 100}%` }} />
      <div
        className={cn('absolute left-0', shade)}
        style={{ top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.left * 100}%` }}
      />
      <div
        className={cn('absolute right-0', shade)}
        style={{ top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.right * 100}%` }}
      />
      {zone.regions.map((r) => (
        <div
          key={r.label}
          className={cn('absolute', shade)}
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
          }}
        />
      ))}
      <div
        className="absolute rounded-[2px] border border-dashed border-white/60"
        style={{
          left: `${zone.left * 100}%`,
          right: `${zone.right * 100}%`,
          top: `${zone.top * 100}%`,
          bottom: `${zone.bottom * 100}%`,
        }}
      />
      <span
        className="force-dark absolute rounded-[4px] bg-black/55 px-1.5 py-0.5 t-micro text-white/85"
        style={{ left: `${zone.left * 100}%`, top: `calc(${zone.top * 100}% + 6px)`, marginLeft: 6 }}
      >
        {label} safe area
      </span>
    </div>
  )
}
