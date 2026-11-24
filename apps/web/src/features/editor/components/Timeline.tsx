import { type Clip, type Composition, contentEnd, type Op, type Track } from '@greenlit/composition'
import type { Media } from '@greenlit/shared'
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useStoredState } from '@/lib/dom'
import { formatTimecode } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { IconButton, InlineEdit, type MenuEntry, Slider, Tooltip, toast, useContextMenu } from '@/ui'
import { type AssetSource, compositionApi } from '../api'
import { freeStart, mediaClipOps, round, trackFits } from '../edits'
import { dispatch, preview, sendPresence, useDoc, useEditor } from '../store'
import { clipActions } from './actions'
import { ClipBody, clipLabel, TYPE_LOOK } from './clipLook'

export const HEADER_W = 184
const RULER_H = 30
const PAD = 16
const ROW = { visual: 60, audio: 44 } as const
const EDGE = 7

const get = useEditor.getState
const set = useEditor.setState

/** Display order: the top visual track first (it draws above the others), then audio. */
function rowsOf(doc: Composition) {
  const visual = doc.tracks.filter((t) => t.kind === 'visual').reverse()
  const audio = doc.tracks.filter((t) => t.kind === 'audio')
  let y = 0
  return [...visual, ...audio].map((track) => {
    const h = ROW[track.kind]
    const row = { track, y, h }
    y += h
    return row
  })
}

interface DragState {
  kind: 'move' | 'trim-l' | 'trim-r'
  x0: number
  y0: number
  moved: boolean
  primary: string
  originals: Map<
    string,
    { start: number; duration: number; in: number; trackId: string; keyframes: Clip['keyframes'] }
  >
  ops: Op[] | null
}

export function Timeline({ media, height }: { media: Map<string, Media>; height: number }) {
  const t = useT('editor')
  const doc = useDoc()
  const pps = useEditor((s) => s.pxPerSec)
  const selection = useEditor((s) => s.selection)
  const readOnly = useEditor((s) => s.readOnly)
  const presence = useEditor((s) => s.presence)
  const remote = useEditor((s) => s.remote)
  const [snapOn, setSnapOn] = useStoredState('editor.snap', true)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<{ t: number; trackId: string | null } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)

  const rows = useMemo(() => (doc ? rowsOf(doc) : []), [doc])
  const end = doc ? Math.max(doc.duration, contentEnd(doc)) : 10
  const contentW = PAD * 2 + (end + Math.max(4, end * 0.25)) * pps

  // ── zoom (ctrl/⌘ + wheel or trackpad pinch), around the pointer ────────────────
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - HEADER_W + el.scrollLeft - PAD
      const time = x / get().pxPerSec
      const next = Math.max(4, Math.min(600, get().pxPerSec * Math.exp(-e.deltaY * 0.0045)))
      set({ pxPerSec: next })
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, time * next + PAD - (e.clientX - rect.left - HEADER_W))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── follow the playhead while playing ─────────────────────────────────────────
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (!s.playing || s.time === prev.time) return
        const el = scroller.current
        if (!el) return
        const x = PAD + s.time * s.pxPerSec
        const view = el.clientWidth - HEADER_W
        if (x > el.scrollLeft + view - 60) el.scrollLeft = x - 80
        if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
      }),
    [],
  )

  const timeAt = useCallback((clientX: number) => {
    const el = scroller.current!
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft - PAD) / get().pxPerSec)
  }, [])
  const rowAt = useCallback(
    (clientY: number) => {
      const el = scroller.current!
      const rect = el.getBoundingClientRect()
      const y = clientY - rect.top - RULER_H + el.scrollTop
      return rows.find((r) => y >= r.y && y < r.y + r.h) ?? null
    },
    [rows],
  )

  // ── scrubbing on the ruler / empty lanes ─────────────────────────────────────
  const scrubbing = useRef(false)
  const scrub = (clientX: number) => {
    const d = get().draft ?? get().doc
    if (!d) return
    const fps = d.fps
    const time = Math.min(Math.max(d.duration, contentEnd(d)), Math.round(timeAt(clientX) * fps) / fps)
    set({ time, playing: false })
    sendPresence()
  }

  // ── snapping ──────────────────────────────────────────────────────────────────
  const snapPoints = (ignore: Set<string>) => {
    const d = get().doc!
    const pts = [0, get().time, ...d.markers.map((m) => m.t)]
    for (const tr of d.tracks)
      for (const c of tr.clips) if (!ignore.has(c.id)) pts.push(c.start, c.start + c.duration)
    return pts
  }
  const snap = (value: number, pts: number[], fps: number) => {
    const quant = Math.round(value * fps) / fps
    if (!snapOn) return { v: quant, line: null as number | null }
    const tol = 8 / get().pxPerSec
    let best: number | null = null
    for (const p of pts)
      if (Math.abs(p - value) <= tol && (best === null || Math.abs(p - value) < Math.abs(best - value)))
        best = p
    return best === null ? { v: quant, line: null } : { v: best, line: best }
  }

  // ── clip drag: move / trim ────────────────────────────────────────────────────
  const onClipDown = (e: React.PointerEvent, clip: Clip, track: Track) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = get()
    let sel = s.selection
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      sel = sel.includes(clip.id) ? sel.filter((x) => x !== clip.id) : [...sel, clip.id]
      set({ selection: sel, rightTab: 'inspector' })
      sendPresence()
      return
    }
    if (!sel.includes(clip.id)) {
      sel = [clip.id]
      set({ selection: sel, rightTab: 'inspector' })
      sendPresence()
    }
    if (readOnly || clip.locked || track.locked) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const local = e.clientX - rect.left
    const kind: DragState['kind'] = local < EDGE ? 'trim-l' : rect.width - local < EDGE ? 'trim-r' : 'move'
    const d = s.doc!
    const originals = new Map<string, DragState['originals'] extends Map<string, infer V> ? V : never>()
    for (const tr of d.tracks)
      for (const c of tr.clips)
        if (sel.includes(c.id))
          originals.set(c.id, {
            start: c.start,
            duration: c.duration,
            in: c.in ?? 0,
            trackId: tr.id,
            keyframes: c.keyframes,
          })
    drag.current = {
      kind,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      primary: clip.id,
      originals,
      ops: null,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onClipMove = (e: React.PointerEvent) => {
    const dr = drag.current
    if (!dr) return
    if (!dr.moved && Math.abs(e.clientX - dr.x0) < 3 && Math.abs(e.clientY - dr.y0) < 3) return
    dr.moved = true
    const d = get().doc!
    const fps = d.fps
    const dt = (e.clientX - dr.x0) / get().pxPerSec
    const ids = new Set(dr.originals.keys())
    const pts = snapPoints(ids)
    const p = dr.originals.get(dr.primary)!
    const ops: Op[] = []
    let line: number | null = null
    if (dr.kind === 'move') {
      // the primary clip leads: snap its start or end, others follow by the same delta
      const a = snap(p.start + dt, pts, fps)
      const b = snap(p.start + p.duration + dt, pts, fps)
      let delta = a.v - p.start
      line = a.line
      if (
        b.line !== null &&
        (a.line === null || Math.abs(b.v - (p.start + p.duration + dt)) < Math.abs(a.v - (p.start + dt)))
      ) {
        delta = b.v - p.start - p.duration
        line = b.line
      }
      const minStart = Math.min(...[...dr.originals.values()].map((o) => o.start))
      delta = Math.max(-minStart, delta)
      // a single clip can change tracks (same kind)
      let destTrack: string | null = null
      if (dr.originals.size === 1) {
        const row = rowAt(e.clientY)
        const own = d.tracks.find((tr) => tr.id === p.trackId)!
        if (row && row.track.kind === own.kind && !row.track.locked) destTrack = row.track.id
      }
      for (const [id, o] of dr.originals) {
        const tid = destTrack ?? o.trackId
        const track = d.tracks.find((tr) => tr.id === tid)!
        let start = round(o.start + delta)
        if (!trackFits(track, start, o.duration, [...ids])) {
          if (dr.originals.size > 1) return
          const fit = freeStart(track, start, o.duration, [...ids])
          if (fit === null) return
          start = fit
          line = null
        }
        ops.push({ op: 'move_clip', id, start, ...(tid !== o.trackId ? { trackId: tid } : {}) })
      }
    } else {
      const clip = d.tracks.flatMap((tr) => tr.clips).find((c) => c.id === dr.primary)!
      const track = d.tracks.find((tr) => tr.id === p.trackId)!
      const others = track.clips.filter((c) => c.id !== clip.id)
      const speed = clip.speed ?? 1
      const asset = clip.assetId ? d.assets[clip.assetId] : undefined
      const srcLen = asset?.duration && clip.type !== 'image' ? asset.duration : null
      if (dr.kind === 'trim-l') {
        const prevEnd = Math.max(
          0,
          ...others.filter((c) => c.start + c.duration <= p.start + 1e-6).map((c) => c.start + c.duration),
        )
        const s = snap(p.start + dt, pts, fps)
        let start = Math.max(prevEnd, Math.min(p.start + p.duration - 1 / fps, s.v))
        if (srcLen !== null) start = Math.max(start, p.start - p.in / speed)
        start = round(start)
        line = s.line === start ? s.line : null
        const shift = start - p.start
        const keyframes = Object.fromEntries(
          Object.entries(p.keyframes ?? {}).map(([k, list]) => [
            k,
            list.map((kf) => ({ ...kf, t: round(kf.t - shift) })).filter((kf) => kf.t >= 0),
          ]),
        )
        ops.push({
          op: 'update_clip',
          id: clip.id,
          patch: {
            start,
            duration: round(p.duration - shift),
            in: round(Math.max(0, p.in + shift * speed)),
            keyframes,
          },
        })
      } else {
        const nextStart = Math.min(
          Number.POSITIVE_INFINITY,
          ...others.filter((c) => c.start >= p.start + p.duration - 1e-6).map((c) => c.start),
        )
        const s = snap(p.start + p.duration + dt, pts, fps)
        let endT = Math.min(nextStart, Math.max(p.start + 1 / fps, s.v))
        if (srcLen !== null) endT = Math.min(endT, p.start + (srcLen - p.in) / speed)
        line = s.line === endT ? s.line : null
        ops.push({ op: 'update_clip', id: clip.id, patch: { duration: round(endT - p.start) } })
      }
    }
    dr.ops = ops
    setSnapLine(line)
    preview(ops)
  }

  const onClipUp = () => {
    const dr = drag.current
    drag.current = null
    setSnapLine(null)
    if (!dr?.moved || !dr.ops) return
    dispatch(dr.ops, { label: dr.kind === 'move' ? 'Move' : 'Trim' })
  }

  // ── drop media from the bin ──────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    if (readOnly || !e.dataTransfer.types.includes('application/x-greenlit-media')) return
    e.preventDefault()
    const row = rowAt(e.clientY)
    setDropAt({ t: timeAt(e.clientX), trackId: row?.track.id ?? null })
  }
  const onDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-greenlit-media')
    setDropAt(null)
    if (!raw) return
    e.preventDefault()
    const s = get()
    if (!s.id || !s.doc) return
    const items = JSON.parse(raw) as (AssetSource & { kind: string })[]
    const at = Math.round(timeAt(e.clientX) * s.doc.fps) / s.doc.fps
    const row = rowAt(e.clientY)
    try {
      const assets = await compositionApi.assets(s.id, items)
      const doc = get().doc!
      const trackId =
        row && assets.every((a) => (a.kind === 'audio') === (row.track.kind === 'audio'))
          ? row.track.id
          : undefined
      const { ops, ids } = mediaClipOps(doc, assets, at, trackId)
      if (dispatch(ops, { label: 'Add media' })) set({ selection: ids })
    } catch (err) {
      toast.error(err)
    }
  }

  const laneMenu = useContextMenu(() => {
    const items: MenuEntry[] = [
      {
        label: t('timeline.addVideoTrack'),
        icon: Plus,
        disabled: readOnly,
        onSelect: () => addTrack('visual'),
      },
      {
        label: t('timeline.addAudioTrack'),
        icon: Plus,
        disabled: readOnly,
        onSelect: () => addTrack('audio'),
      },
    ]
    const clips = get().clipboard
    if (clips.length)
      items.unshift(
        {
          label: t('timeline.paste'),
          shortcut: 'mod+v',
          disabled: readOnly,
          onSelect: () => clipActions.paste(),
        },
        'separator',
      )
    return items
  })

  if (!doc) return null
  const totalH = rows.reduce((s, r) => s + r.h, 0)
  const remoteIds = remote && Date.now() - remote.at < 2500 ? new Set(remote.clipIds) : null

  return (
    <div className="flex min-h-0 flex-col bg-panel" style={{ height }}>
      <TimelineBar snapOn={snapOn} setSnapOn={setSnapOn} scroller={scroller} />
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
        onDragOver={onDragOver}
        onDragLeave={() => setDropAt(null)}
        onDrop={onDrop}
      >
        <div className="relative" style={{ width: HEADER_W + contentW, minHeight: '100%' }}>
          {/* ruler */}
          <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-b border-line bg-panel"
              style={{ width: HEADER_W }}
            />
            <div
              className="relative flex-1 cursor-text border-b border-line bg-[color-mix(in_oklab,var(--panel),var(--canvas)_40%)]"
              onPointerDown={(e) => {
                scrubbing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                scrub(e.clientX)
              }}
              onPointerMove={(e) => scrubbing.current && scrub(e.clientX)}
              onPointerUp={() => {
                scrubbing.current = false
              }}
            >
              <Ruler pps={pps} width={contentW} fps={doc.fps} duration={doc.duration} />
            </div>
          </div>

          {/* tracks */}
          <div className="relative flex" style={{ height: totalH }}>
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel"
              style={{ width: HEADER_W }}
            >
              {rows.map((r) => (
                <TrackHeader key={r.track.id} track={r.track} height={r.h} />
              ))}
            </div>
            <div
              className="relative flex-1"
              {...laneMenu}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target !== e.currentTarget) return
                set({ selection: [] })
                scrubbing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                scrub(e.clientX)
              }}
              onPointerMove={(e) => scrubbing.current && scrub(e.clientX)}
              onPointerUp={() => {
                scrubbing.current = false
              }}
            >
              {rows.map((r) => (
                <div
                  key={r.track.id}
                  className={cn(
                    'pointer-events-none absolute inset-x-0 border-b border-line/60',
                    r.track.kind === 'audio' && 'bg-[color-mix(in_oklab,var(--canvas),transparent_70%)]',
                  )}
                  style={{ top: r.y, height: r.h }}
                />
              ))}
              {rows.map((r) =>
                r.track.clips.map((c) => (
                  <ClipBlock
                    key={c.id}
                    clip={c}
                    track={r.track}
                    y={r.y}
                    h={r.h}
                    pps={pps}
                    media={media}
                    doc={doc}
                    selected={selection.includes(c.id)}
                    flash={!!remoteIds?.has(c.id)}
                    onDown={onClipDown}
                    onMove={onClipMove}
                    onUp={onClipUp}
                  />
                )),
              )}
              {snapLine !== null && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-review"
                  style={{ left: PAD + snapLine * pps }}
                />
              )}
              {dropAt && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]"
                  style={{ left: PAD + dropAt.t * pps }}
                />
              )}
              {presence
                .filter((p) => Date.now() - p.at < 10 * 60_000)
                .map((p) => (
                  <div
                    key={p.clientId}
                    className="pointer-events-none absolute top-0 bottom-0 z-[15] w-px bg-cue/70"
                    style={{ left: PAD + p.time * pps }}
                  />
                ))}
            </div>
          </div>
          <Playhead pps={pps} />
        </div>
      </div>
    </div>
  )
}

function addTrack(kind: 'visual' | 'audio') {
  const d = get().doc
  if (!d) return
  const n = d.tracks.filter((t) => t.kind === kind).length + 1
  const index = kind === 'visual' ? d.tracks.map((t) => t.kind).lastIndexOf('visual') + 1 : d.tracks.length
  dispatch(
    [{ op: 'add_track', track: { name: `${kind === 'audio' ? 'Audio' : 'Video'} ${n}`, kind }, index }],
    { label: 'Add track' },
  )
}

// ── ruler ──────────────────────────────────────────────────────────────────────────

const STEPS = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
const Ruler = memo(function Ruler({
  pps,
  width,
  fps,
  duration,
}: {
  pps: number
  width: number
  fps: number
  duration: number
}) {
  const major = STEPS.find((s) => s * pps >= 84) ?? 600
  const minor = major / (major >= 1 ? (major % 5 === 0 || major === 1 ? 5 : 4) : 5)
  const ticks: { x: number; major: boolean; t: number }[] = []
  const maxT = (width - PAD) / pps
  for (let i = 0; i * minor <= maxT; i++) {
    const t = i * minor
    ticks.push({ x: PAD + t * pps, major: Math.abs(t / major - Math.round(t / major)) < 1e-6, t })
  }
  const label = (t: number) => {
    if (major < 1) return formatTimecode(t, fps)
    const m = Math.floor(t / 60)
    const s = Math.round(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return (
    <svg width={width} height={RULER_H} className="absolute inset-0 select-none" aria-hidden>
      <rect
        x={PAD}
        y={RULER_H - 3}
        width={duration * pps}
        height={3}
        fill="var(--signal)"
        opacity={0.28}
        rx={1.5}
      />
      {ticks.map((k) => (
        <g key={k.x}>
          <line
            x1={k.x}
            x2={k.x}
            y1={k.major ? 12 : RULER_H - 7}
            y2={RULER_H}
            stroke="var(--ink-4)"
            strokeWidth={1}
          />
          {k.major && (
            <text x={k.x + 4} y={13} fontSize={10} fill="var(--ink-3)" fontFamily="var(--gl-font-mono)">
              {label(k.t)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
})

// ── playhead ───────────────────────────────────────────────────────────────────────

function Playhead({ pps }: { pps: number }) {
  const time = useEditor((s) => s.time)
  const x = HEADER_W + PAD + time * pps
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-[25]"
      style={{ transform: `translateX(${x}px)` }}
    >
      <div className="sticky top-0">
        <svg
          width={13}
          height={RULER_H}
          className="-ml-[6.5px] block drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"
          aria-hidden
        >
          <path
            d="M1.5 2.5h10a1 1 0 0 1 1 1v9.2a1 1 0 0 1-.36.77L7.14 17.6a1 1 0 0 1-1.28 0L.86 13.47a1 1 0 0 1-.36-.77V3.5a1 1 0 0 1 1-1Z"
            fill="var(--signal)"
          />
        </svg>
      </div>
      <div className="absolute top-[22px] bottom-0 -ml-px w-0.5 bg-signal shadow-[0_0_8px_color-mix(in_oklab,var(--signal)_60%,transparent)]" />
    </div>
  )
}

// ── track header ───────────────────────────────────────────────────────────────────

function TrackHeader({ track, height }: { track: Track; height: number }) {
  const t = useT('editor')
  const readOnly = useEditor((s) => s.readOnly)
  const upd = (patch: Record<string, unknown>, label: string) =>
    dispatch([{ op: 'update_track', id: track.id, patch }], { label })
  const menu = useContextMenu(
    () => [
      {
        label: track.locked ? t('timeline.unlock') : t('timeline.lock'),
        icon: track.locked ? LockOpen : Lock,
        onSelect: () => upd({ locked: !track.locked }, 'Lock'),
      },
      track.kind === 'visual'
        ? {
            label: track.hidden ? t('timeline.show') : t('timeline.hide'),
            icon: track.hidden ? Eye : EyeOff,
            onSelect: () => upd({ hidden: !track.hidden }, 'Hide'),
          }
        : {
            label: track.muted ? t('timeline.unmute') : t('timeline.mute'),
            icon: track.muted ? Volume2 : VolumeX,
            onSelect: () => upd({ muted: !track.muted }, 'Mute'),
          },
      'separator',
      { label: t('timeline.addVideoTrack'), icon: Plus, onSelect: () => addTrack('visual') },
      { label: t('timeline.addAudioTrack'), icon: Plus, onSelect: () => addTrack('audio') },
      'separator',
      {
        label: t('timeline.deleteTrack'),
        icon: Trash2,
        danger: true,
        onSelect: () => dispatch([{ op: 'remove_track', id: track.id }], { label: 'Delete track' }),
      },
    ],
    { disabled: readOnly },
  )
  return (
    <div
      className="group flex items-center gap-1 border-b border-line/60 pr-1.5 pl-3"
      style={{ height }}
      {...menu}
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full', track.kind === 'audio' ? 'bg-signal/70' : 'bg-ink-3')}
      />
      <InlineEdit
        value={track.name || (track.kind === 'audio' ? t('timeline.audio') : t('timeline.video'))}
        onSave={(name) => upd({ name }, 'Rename track')}
        disabled={readOnly}
        tooltip={null}
        className="ml-1 flex-1 t-caption font-[550] text-ink-2"
      />
      <span
        className={cn(
          'flex items-center opacity-0 transition-opacity group-hover:opacity-100',
          (track.locked || track.hidden || track.muted) && 'opacity-100',
        )}
      >
        {track.kind === 'visual' ? (
          <IconButton
            size="xs"
            icon={track.hidden ? EyeOff : Eye}
            label={track.hidden ? t('timeline.show') : t('timeline.hide')}
            active={track.hidden || undefined}
            disabled={readOnly}
            onClick={() => upd({ hidden: !track.hidden }, 'Hide')}
          />
        ) : (
          <IconButton
            size="xs"
            icon={track.muted ? VolumeX : Volume2}
            label={track.muted ? t('timeline.unmute') : t('timeline.mute')}
            active={track.muted || undefined}
            disabled={readOnly}
            onClick={() => upd({ muted: !track.muted }, 'Mute')}
          />
        )}
        <IconButton
          size="xs"
          icon={track.locked ? Lock : LockOpen}
          label={track.locked ? t('timeline.unlock') : t('timeline.lock')}
          active={track.locked || undefined}
          disabled={readOnly}
          onClick={() => upd({ locked: !track.locked }, 'Lock')}
        />
      </span>
    </div>
  )
}

// ── clip ───────────────────────────────────────────────────────────────────────────

const ClipBlock = memo(function ClipBlock({
  clip,
  track,
  y,
  h,
  pps,
  media,
  doc,
  selected,
  flash,
  onDown,
  onMove,
  onUp,
}: {
  clip: Clip
  track: Track
  y: number
  h: number
  pps: number
  media: Map<string, Media>
  doc: Composition
  selected: boolean
  flash: boolean
  onDown: (e: React.PointerEvent, c: Clip, t: Track) => void
  onMove: (e: React.PointerEvent) => void
  onUp: () => void
}) {
  const asset = clip.assetId ? doc.assets[clip.assetId] : undefined
  const look = TYPE_LOOK[clip.type]
  const Icon = look.icon
  const left = PAD + clip.start * pps
  const width = Math.max(4, clip.duration * pps)
  const inner = h - 8
  const menu = useContextMenu(() => clipActions.menu(clip.id))
  const keys = selected
    ? [...new Set(Object.values(clip.keyframes ?? {}).flatMap((l) => l.map((k) => k.t)))]
    : []
  const muted = track.hidden || track.muted || clip.hidden
  return (
    <div
      {...menu}
      onPointerDown={(e) => onDown(e, clip, track)}
      onPointerMove={(e) => {
        onMove(e)
        // trim cursor at the edges
        const r = e.currentTarget.getBoundingClientRect()
        const lx = e.clientX - r.left
        e.currentTarget.style.cursor = lx < EDGE || r.width - lx < EDGE ? 'ew-resize' : 'default'
      }}
      onPointerUp={onUp}
      onDoubleClick={() => clip.type === 'text' && useEditor.setState({ rightTab: 'inspector' })}
      data-clip={clip.id}
      className={cn(
        'group absolute z-[5] overflow-hidden rounded-[7px] select-none',
        'transition-[box-shadow,filter] duration-150',
        selected
          ? 'z-[6] shadow-[0_0_0_2px_var(--signal),0_6px_18px_-6px_rgba(0,0,0,.6)]'
          : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,.08),0_1px_2px_rgba(0,0,0,.3)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,.22),0_1px_2px_rgba(0,0,0,.3)]',
        flash && 'shadow-[0_0_0_2px_var(--cue),0_0_18px_var(--cue)]',
        muted && 'opacity-45',
        (clip.locked || track.locked) && 'cursor-not-allowed',
      )}
      style={{
        transform: `translate(${left}px, ${y + 4}px)`,
        width,
        height: inner,
        background: `color-mix(in oklab, ${look.tint} 26%, #141614)`,
      }}
    >
      <ClipBody clip={clip} asset={asset} media={media} width={width} height={inner} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />
      <div className="pointer-events-none absolute top-1 right-1.5 left-1.5 flex items-center gap-1.5 text-[11px] leading-4 font-[550] text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
        <Icon size={11} strokeWidth={2} className="shrink-0 opacity-80" />
        {width > 46 && <span className="truncate">{clipLabel(clip, asset)}</span>}
        {clip.speed !== 1 && width > 90 && (
          <span className="ml-auto shrink-0 rounded-[3px] bg-black/40 px-1 t-meta text-[10px]">
            {clip.speed}×
          </span>
        )}
      </div>
      {clip.transitionIn && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/60 to-transparent"
          style={{ width: Math.min(width / 2, clip.transitionIn.duration * pps) }}
        />
      )}
      {clip.transitionOut && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/60 to-transparent"
          style={{ width: Math.min(width / 2, clip.transitionOut.duration * pps) }}
        />
      )}
      {keys.map((k) => (
        <span
          key={k}
          className="pointer-events-none absolute bottom-1 size-[7px] rotate-45 rounded-[1.5px] bg-review shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
          style={{ left: k * pps - 3.5 }}
        />
      ))}
      {/* trim handles */}
      <span className="absolute inset-y-0 left-0 w-[5px] rounded-l-[7px] bg-white/0 transition-colors group-hover:bg-white/25" />
      <span className="absolute inset-y-0 right-0 w-[5px] rounded-r-[7px] bg-white/0 transition-colors group-hover:bg-white/25" />
    </div>
  )
})

// ── transport bar ──────────────────────────────────────────────────────────────────

function TimelineBar({
  snapOn,
  setSnapOn,
  scroller,
}: {
  snapOn: boolean
  setSnapOn: (v: boolean) => void
  scroller: React.RefObject<HTMLDivElement | null>
}) {
  const t = useT('editor')
  const playing = useEditor((s) => s.playing)
  const pps = useEditor((s) => s.pxPerSec)
  const selection = useEditor((s) => s.selection)
  const readOnly = useEditor((s) => s.readOnly)
  const doc = useDoc()
  const fit = useCallback(() => {
    const el = scroller.current
    const d = get().doc
    if (!el || !d) return
    const w = el.clientWidth - HEADER_W - PAD * 2 - 24
    set({ pxPerSec: Math.max(4, Math.min(600, w / Math.max(1, Math.max(d.duration, contentEnd(d))))) })
    el.scrollLeft = 0
  }, [scroller])
  useEffect(() => {
    window.addEventListener('gl-editor-fit', fit)
    return () => window.removeEventListener('gl-editor-fit', fit)
  }, [fit])
  const step = (frames: number) => {
    const s = get()
    const fps = s.doc?.fps ?? 30
    set({ time: Math.max(0, Math.round((s.time + frames / fps) * fps) / fps), playing: false })
  }
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
      <div className="flex items-center" style={{ width: HEADER_W - 8 }}>
        <IconButton
          size="sm"
          icon={SkipBack}
          label="Start"
          shortcut="home"
          onClick={() => set({ time: 0, playing: false })}
        />
        <IconButton
          size="sm"
          icon={StepBack}
          label="Previous frame"
          shortcut="arrowleft"
          onClick={() => step(-1)}
        />
        <Tooltip label={playing ? 'Pause' : 'Play'} shortcut="space">
          <button
            type="button"
            onClick={() => set((s) => ({ playing: !s.playing, rate: 1 }))}
            className="press mx-0.5 grid size-8 place-items-center rounded-full bg-ink text-canvas shadow-[0_1px_3px_rgba(0,0,0,.35)] hover:bg-ink-2"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={14} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={14} fill="currentColor" strokeWidth={0} className="ml-0.5" />
            )}
          </button>
        </Tooltip>
        <IconButton
          size="sm"
          icon={StepForward}
          label="Next frame"
          shortcut="arrowright"
          onClick={() => step(1)}
        />
        <IconButton
          size="sm"
          icon={SkipForward}
          label="End"
          shortcut="end"
          onClick={() => doc && set({ time: Math.max(0, doc.duration - 1 / doc.fps), playing: false })}
        />
      </div>
      <Clock />
      <div className="flex-1" />
      <IconButton
        size="sm"
        icon={Scissors}
        label={t('timeline.split')}
        shortcut="s"
        disabled={readOnly}
        onClick={() => clipActions.split()}
      />
      <IconButton
        size="sm"
        icon={Trash2}
        label={t('timeline.delete')}
        shortcut="backspace"
        disabled={readOnly || !selection.length}
        onClick={() => clipActions.remove()}
      />
      <span className="mx-1.5 h-4 w-px bg-line" />
      <IconButton
        size="sm"
        icon={Magnet}
        label={t('timeline.snap')}
        active={snapOn || undefined}
        onClick={() => setSnapOn(!snapOn)}
      />
      <IconButton
        size="sm"
        icon={Minus}
        label={t('timeline.zoomOut')}
        shortcut="-"
        onClick={() => set({ pxPerSec: Math.max(4, pps / 1.4) })}
      />
      <div className="w-28">
        <Slider
          value={Math.log(pps)}
          min={Math.log(4)}
          max={Math.log(600)}
          step={0.01}
          onChange={(v) => set({ pxPerSec: Math.exp(v) })}
          tone="ink"
          label="Zoom"
        />
      </div>
      <IconButton
        size="sm"
        icon={Plus}
        label={t('timeline.zoomIn')}
        shortcut="="
        onClick={() => set({ pxPerSec: Math.min(600, pps * 1.4) })}
      />
      <IconButton size="sm" icon={Maximize2} label={t('timeline.fit')} shortcut="shift+z" onClick={fit} />
    </div>
  )
}

function Clock() {
  const time = useEditor((s) => s.time)
  const doc = useDoc()
  const fps = doc?.fps ?? 30
  return (
    <div className="flex items-baseline gap-1.5 pl-1">
      <span className="t-meta text-[13px] text-ink tabular">{formatTimecode(time, fps)}</span>
      <span className="t-meta text-ink-4">/ {formatTimecode(doc?.duration ?? 0, fps)}</span>
    </div>
  )
}
