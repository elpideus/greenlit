import type { Media, MediaFormat } from '@greenlit/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { type NoteDraft, useViewer } from '@/components/viewer/store'
import { cn } from '@/lib/cn'
import { useHotkey } from '@/lib/hotkeys'
import { spring } from '@/lib/motion'
import { useCan } from '@/lib/session'
import { type Note, useNotes } from './api'
import { pinNumbers } from './NotesPanel'
import { focusComposer, useNotesUi } from './store'

const NEAR = 1.25 // seconds around a note's moment during which its pin shows

type Pt = { x: number; y: number }

/**
 * Notes on the picture: click places a pin (the video pauses on that frame), drag marks an area, the pen draws.
 * Pins of the notes near the current moment show (all of them on a still picture); hovering a note lights its pin.
 */
export function NotesOverlay({ media, format }: { media: Media; format: MediaFormat }) {
  const canWrite = useCan('comments.create')
  const { data: notes } = useNotes('media', media.id)
  const time = useViewer((s) => s.time)
  const draft = useViewer((s) => s.draft)
  const active = useViewer((s) => s.activeNote)
  const hover = useViewer((s) => s.hoverNote)
  const frame = useViewer((s) => s.frame)
  const set = useViewer((s) => s.set)
  const drawing = useNotesUi((s) => s.drawing)
  const timed = format.kind === 'video'
  const layer = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ start: Pt; moved: boolean; stroke: Pt[] } | null>(null)
  const [live, setLive] = useState<{ region: NoteDraft['region']; stroke: Pt[] | null } | null>(null)

  useHotkey('escape', () => set({ draft: null }), {
    enabled: !!draft,
    allowInInputs: true,
    preventDefault: false,
  })

  const numbers = useMemo(
    () => pinNumbers(notes ?? [], timed || format.kind === 'audio'),
    [notes, timed, format.kind],
  )
  const pins = (notes ?? []).filter(
    (n) =>
      n.pin &&
      (n.formatId === null || n.formatId === format.id) &&
      (!timed || n.time === null || Math.abs(n.time - time) <= NEAR || n.id === active || n.id === hover),
  )

  const at = (e: React.PointerEvent): Pt => {
    const r = layer.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    gesture.current = { start: p, moved: false, stroke: [p] }
    useViewer.getState().controls?.pause()
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !frame) return
    const p = at(e)
    const dx = (p.x - g.start.x) * frame.width
    const dy = (p.y - g.start.y) * frame.height
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    g.moved = true
    if (drawing) {
      g.stroke.push(p)
      setLive({ region: null, stroke: [...g.stroke] })
    } else {
      setLive({
        region: {
          x: Math.min(g.start.x, p.x),
          y: Math.min(g.start.y, p.y),
          w: Math.abs(p.x - g.start.x),
          h: Math.abs(p.y - g.start.y),
        },
        stroke: null,
      })
    }
  }
  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const s = useViewer.getState()
    const t = timed || format.kind === 'audio' ? s.time : null
    const base: NoteDraft =
      s.draft && drawing
        ? s.draft
        : {
            point: g.start,
            region: null,
            strokes: [],
            time: t,
            frame: t === null ? null : Math.round(t * s.fps),
          }
    let next: NoteDraft
    if (!g.moved) next = drawing && s.draft ? s.draft : { ...base, point: g.start }
    else if (drawing) next = { ...base, strokes: [...base.strokes, simplify(g.stroke)] }
    else if (live?.region && live.region.w > 0.01 && live.region.h > 0.01)
      next = { ...base, point: { x: live.region.x, y: live.region.y }, region: live.region }
    else next = { ...base, point: g.start }
    setLive(null)
    s.set({ draft: next, tab: 'comments', activeNote: null })
    focusComposer()
  }

  const strokeColor = (n: Note) => (n.status === 'done' ? 'var(--signal)' : 'var(--review)')

  return (
    <div className="absolute inset-0">
      {canWrite && (
        <div
          ref={layer}
          className={cn('pointer-events-auto absolute inset-0', drawing ? 'cursor-crosshair' : 'cursor-cell')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            gesture.current = null
            setLive(null)
          }}
        />
      )}

      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {pins.map((n) => {
          const lit = n.id === active || n.id === hover
          return (
            <g key={n.id} style={{ opacity: lit || !active ? 1 : 0.55, transition: 'opacity 200ms' }}>
              {n.pin?.region && (
                <rect
                  x={n.pin.region.x}
                  y={n.pin.region.y}
                  width={n.pin.region.w}
                  height={n.pin.region.h}
                  rx={0.006}
                  fill={strokeColor(n)}
                  fillOpacity={lit ? 0.16 : 0.08}
                  stroke={strokeColor(n)}
                  strokeWidth={lit ? 2.5 : 1.75}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {n.pin?.strokes.map((s, i) => (
                <polyline
                  // biome-ignore lint/suspicious/noArrayIndexKey: strokes have no ids
                  key={i}
                  points={s.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={strokeColor(n)}
                  strokeWidth={lit ? 3.5 : 2.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )
        })}
        {(draft?.region || live?.region) && (
          <rect
            {...(() => {
              const r = live?.region ?? draft!.region!
              return { x: r.x, y: r.y, width: r.w, height: r.h }
            })()}
            rx={0.006}
            fill="var(--signal)"
            fillOpacity={0.12}
            stroke="var(--signal)"
            strokeWidth={2}
            strokeDasharray={live?.region ? '5 4' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {[...(draft?.strokes ?? []), ...(live?.stroke ? [live.stroke] : [])].map((s, i) => (
          <polyline
            // biome-ignore lint/suspicious/noArrayIndexKey: strokes have no ids
            key={`d${i}`}
            points={s.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--signal)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <AnimatePresence>
        {pins.map((n) => {
          const p = n.pin!.point
          const lit = n.id === active || n.id === hover
          const done = n.status === 'done'
          return (
            <motion.button
              key={n.id}
              type="button"
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: lit ? 1.15 : 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={spring.lamp}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                set({ activeNote: n.id, tab: 'comments', hoverNote: null })
              }}
              onMouseEnter={() => set({ hoverNote: n.id })}
              onMouseLeave={() => set({ hoverNote: null })}
              className={cn(
                'pointer-events-auto absolute -mt-3 -ml-3 grid size-6 place-items-center rounded-full t-micro text-[11px] font-[650] tabular',
                done ? 'bg-signal text-signal-ink' : 'bg-review text-[#1b1302]',
              )}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                boxShadow: `0 0 0 2px rgba(0,0,0,.55), 0 4px 14px rgba(0,0,0,.45)${lit ? `, 0 0 18px ${done ? 'var(--signal)' : 'var(--review)'}` : ''}`,
              }}
              aria-label={n.body.slice(0, 60)}
            >
              {numbers.get(n.id) ?? ''}
            </motion.button>
          )
        })}
      </AnimatePresence>

      <AnimatePresence>
        {draft && (
          <motion.span
            key={`${draft.point.x},${draft.point.y}`}
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.2, opacity: 0 }}
            transition={spring.lamp}
            className="pointer-events-none absolute -mt-3.5 -ml-3.5 size-7 rounded-full"
            style={{ left: `${draft.point.x * 100}%`, top: `${draft.point.y * 100}%` }}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-signal/40" />
            <span className="absolute inset-[5px] rounded-full bg-signal shadow-[0_0_0_2px_rgba(0,0,0,.5),0_0_16px_var(--signal)]" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Drops points closer than ~0.4% of the frame so strokes stay small. */
function simplify(points: Pt[]) {
  const out: Pt[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.004)
      out.push({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 })
  }
  return out.slice(0, 400)
}
