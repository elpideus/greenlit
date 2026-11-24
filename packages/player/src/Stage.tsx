import {
  type Asset,
  type ClipState,
  type Composition,
  clipState,
  ease,
  isActive,
  type OutputFormat,
  visibleClips,
} from '@greenlit/composition'
import { type CSSProperties, createContext, memo, useContext, useEffect, useMemo, useRef } from 'react'
import { htmlDocument } from './htmlRuntime.ts'

export interface AssetResolver {
  /** URL the browser can play/show (preview proxy for videos). */
  src: (asset: Asset) => string | null
  poster?: (asset: Asset) => string | null
  /** Render mode: the exact frame of a video clip (frame index counted from the clip start at the composition fps). */
  frame?: (asset: Asset, clipId: string, frameIndex: number, mediaTime: number) => string
}

export type StageMode = 'preview' | 'render'

interface StageCtx {
  comp: Composition
  format: OutputFormat
  time: number
  playing: boolean
  mode: StageMode
  assets: AssetResolver
  volume: number
  register: (p: Promise<unknown>) => void
}
const Ctx = createContext<StageCtx | null>(null)
const useStage = () => useContext(Ctx)!

export interface StageProps {
  comp: Composition
  format: OutputFormat
  time: number
  playing?: boolean
  mode?: StageMode
  assets: AssetResolver
  /** 0..1 preview volume (render mode is silent; audio is mixed separately). */
  volume?: number
  className?: string
  style?: CSSProperties
  /** Called after every time change once every layer finished drawing (render mode uses it to capture frames). */
  onDrawn?: (time: number) => void
  /** Extra elements above the layers (selection handles, guides) in composition pixel space. */
  children?: React.ReactNode
}

/**
 * Draws a composition at a time, in the composition's own pixel space (format.width × format.height).
 * Scale it with CSS around it. The same component runs in the editor preview and in the headless renderer,
 * so what you see while editing is what gets exported.
 */
export function Stage({
  comp,
  format,
  time,
  playing = false,
  mode = 'preview',
  assets,
  volume = 1,
  className,
  style,
  onDrawn,
  children,
}: StageProps) {
  const pending = useRef<Promise<unknown>[]>([])
  pending.current = []
  const ctx = useMemo<StageCtx>(
    () => ({ comp, format, time, playing, mode, assets, volume, register: (p) => pending.current.push(p) }),
    [comp, format, time, playing, mode, assets, volume],
  )
  const layers = visibleClips(comp, time, format)
  // Preload videos that start soon so they don't flash when they begin. They share one keyed list with the visible
  // layers under the same key, so at the cut the warmed-up <video> (already seeked to the clip's first frame) is the
  // one that shows: a fresh element would show its poster or the file's frame 0 until it had seeked.
  const upcoming =
    mode === 'preview'
      ? comp.tracks.flatMap((t) =>
          t.kind === 'visual' && !t.hidden
            ? t.clips
                .filter(
                  (c) => c.type === 'video' && !isActive(c, time) && c.start > time && c.start - time < 2,
                )
                .map((c) => clipState(c, c.start, format))
            : [],
        )
      : []
  const audio =
    mode === 'preview'
      ? comp.tracks.flatMap((t) =>
          t.muted
            ? []
            : t.clips
                .filter((c) => c.type === 'audio' && isActive(c, time))
                .map((c) => ({ s: clipState(c, time, format), vol: t.volume ?? 1 })),
        )
      : []

  useEffect(() => {
    if (!onDrawn) return
    const list = pending.current
    let cancelled = false
    void Promise.all(list).then(async () => {
      if (document.fonts?.ready) await document.fonts.ready
      // The capture itself waits for the next composited frame; a macrotask is enough here
      // (rAF can be throttled in headless background pages).
      await new Promise((r) => setTimeout(r, 0))
      if (!cancelled) onDrawn(time)
    })
    return () => {
      cancelled = true
    }
  })

  return (
    <Ctx.Provider value={ctx}>
      <div
        className={className}
        style={{
          position: 'relative',
          width: format.width,
          height: format.height,
          overflow: 'hidden',
          background: comp.background,
          isolation: 'isolate',
          ...style,
        }}
      >
        {[
          ...layers.map((s, i) => <Layer key={s.clip.id} state={s} z={i} />),
          ...upcoming.map((s) => <Layer key={s.clip.id} state={s} z={-1} hidden />),
        ]}
        {audio.map(({ s, vol }) => (
          <AudioLayer key={s.clip.id} state={s} trackVolume={vol} />
        ))}
        {children}
      </div>
    </Ctx.Provider>
  )
}

function boxStyle(s: ClipState, z: number): CSSProperties {
  const st = s.clip.style ?? {}
  return {
    position: 'absolute',
    left: s.x,
    top: s.y,
    width: s.width,
    height: s.height,
    zIndex: z,
    opacity: s.opacity,
    transform: `translate(${s.dx}px, ${s.dy}px) rotate(${s.rotation}deg) scale(${s.scale * s.dscale})`,
    transformOrigin: `${s.anchorX * 100}% ${s.anchorY * 100}%`,
    filter: s.filter || undefined,
    mixBlendMode:
      st.blendMode && st.blendMode !== 'normal' ? (st.blendMode as CSSProperties['mixBlendMode']) : undefined,
    borderRadius: num(s, 'style.radius', st.radius ?? 0) || undefined,
    boxShadow: st.shadow || undefined,
    border: st.border || undefined,
    clipPath: [s.reveal, st.clipPath].filter(Boolean)[0] || undefined,
    overflow: 'hidden',
    willChange: 'transform, opacity',
  }
}

function num(s: ClipState, path: string, fallback: number) {
  const v = s.values[path]
  return typeof v === 'number' ? v : fallback
}

const Layer = memo(function Layer({ state, z, hidden }: { state: ClipState; z: number; hidden?: boolean }) {
  const style = boxStyle(state, z)
  if (hidden) Object.assign(style, { opacity: 0, pointerEvents: 'none' })
  const c = state.clip
  return (
    <div style={style} data-clip={c.id}>
      {c.type === 'video' && <VideoLayer state={state} preload={hidden} />}
      {c.type === 'image' && <ImageLayer state={state} />}
      {c.type === 'text' && <TextLayer state={state} />}
      {c.type === 'shape' && <ShapeLayer state={state} />}
      {c.type === 'solid' && <div style={{ position: 'absolute', inset: 0, background: c.fill ?? '#000' }} />}
      {c.type === 'html' && <HtmlLayer state={state} />}
    </div>
  )
})

function mediaStyle(s: ClipState): CSSProperties {
  const c = s.clip
  const fx = num(s, 'focusX', c.focusX ?? 0.5)
  const fy = num(s, 'focusY', c.focusY ?? 0.5)
  const crop = c.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const hasCrop = crop.top || crop.right || crop.bottom || crop.left
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: c.fit === 'none' ? 'none' : (c.fit ?? 'cover'),
    objectPosition: `${fx * 100}% ${fy * 100}%`,
    clipPath: hasCrop
      ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
      : undefined,
    display: 'block',
  }
}

function useAsset(state: ClipState) {
  const { comp } = useStage()
  return state.clip.assetId ? comp.assets[state.clip.assetId] : undefined
}

function ImageLayer({ state }: { state: ClipState }) {
  const { assets, register } = useStage()
  const asset = useAsset(state)
  const ref = useRef<HTMLImageElement>(null)
  const src = asset ? assets.src(asset) : null
  useEffect(() => {
    const img = ref.current
    if (img && !img.complete) register(img.decode().catch(() => {}))
  })
  if (!src) return <Missing />
  return <img ref={ref} src={src} alt="" draggable={false} style={mediaStyle(state)} />
}

function VideoLayer({ state, preload }: { state: ClipState; preload?: boolean }) {
  const { assets, mode, playing, register, volume, comp } = useStage()
  const asset = useAsset(state)
  const ref = useRef<HTMLVideoElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const c = state.clip
  const target = state.mediaTime

  useEffect(() => {
    if (mode !== 'preview') return
    const v = ref.current
    if (!v) return
    const tol = 1 / comp.fps
    v.muted = preload || volume === 0 || state.volume === 0
    v.volume = Math.max(0, Math.min(1, state.volume * volume))
    v.playbackRate = c.speed ?? 1
    if (playing && !preload) {
      if (v.paused) void v.play().catch(() => {})
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target
    } else {
      if (!v.paused) v.pause()
      if (Math.abs(v.currentTime - target) > tol / 2) {
        v.currentTime = target
        register(
          new Promise<void>((r) => {
            const done = () => r()
            v.addEventListener('seeked', done, { once: true })
            setTimeout(done, 1500)
          }),
        )
      }
    }
  })
  useEffect(() => {
    const i = img.current
    if (mode === 'render' && i && !i.complete) register(i.decode().catch(() => {}))
  })
  if (!asset) return <Missing />
  if (mode === 'render' && assets.frame) {
    return (
      <img
        ref={img}
        src={assets.frame(asset, c.id, Math.round(state.local * comp.fps), target)}
        alt=""
        style={mediaStyle(state)}
      />
    )
  }
  const src = assets.src(asset)
  if (!src) return <Missing />
  return (
    <video
      ref={ref}
      src={src}
      poster={assets.poster?.(asset) ?? undefined}
      playsInline
      preload="auto"
      muted
      style={mediaStyle(state)}
    />
  )
}

function AudioLayer({ state, trackVolume }: { state: ClipState; trackVolume: number }) {
  const { assets, playing, volume } = useStage()
  const asset = useAsset(state)
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const a = ref.current
    if (!a) return
    a.volume = Math.max(0, Math.min(1, state.volume * trackVolume * volume))
    a.playbackRate = state.clip.speed ?? 1
    if (playing) {
      if (a.paused) void a.play().catch(() => {})
      if (Math.abs(a.currentTime - state.mediaTime) > 0.3) a.currentTime = state.mediaTime
    } else {
      if (!a.paused) a.pause()
      if (Math.abs(a.currentTime - state.mediaTime) > 0.05) a.currentTime = state.mediaTime
    }
  })
  const src = asset ? assets.src(asset) : null
  return src ? <audio ref={ref} src={src} preload="auto" /> : null
}

function Missing() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'repeating-linear-gradient(45deg,#222 0 12px,#2a2a2a 12px 24px)',
        color: '#888',
        font: '600 24px system-ui',
      }}
    >
      Missing media
    </div>
  )
}

// ── text ───────────────────────────────────────────────────────────────────

type Piece = { text: string; index: number }

function TextLayer({ state }: { state: ClipState }) {
  const c = state.clip
  const t = c.text ?? {}
  const fontSize = num(state, 'text.fontSize', t.fontSize ?? 72)
  const color = (state.values['text.color'] as string | undefined) ?? t.color ?? '#fff'
  const letterSpacing = num(state, 'text.letterSpacing', t.letterSpacing ?? 0)
  const content = t.content ?? ''
  const animIn = t.animateIn
  const animOut = t.animateOut
  const by = animIn?.by ?? animOut?.by ?? 'block'
  const pieces = useMemo(() => split(content, by), [content, by])
  const wrap: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      t.verticalAlign === 'top' ? 'flex-start' : t.verticalAlign === 'bottom' ? 'flex-end' : 'center',
    textAlign: t.align ?? 'center',
    padding: t.padding ?? 0,
  }
  const textStyle: CSSProperties = {
    fontFamily: `"${t.fontFamily ?? 'Inter Variable'}", system-ui, sans-serif`,
    fontSize,
    fontWeight: t.fontWeight ?? 700,
    fontStyle: t.italic ? 'italic' : undefined,
    color,
    lineHeight: t.lineHeight ?? 1.1,
    letterSpacing: `${letterSpacing}em`,
    textTransform: t.textTransform ?? 'none',
    whiteSpace: 'pre-wrap',
    textShadow: t.shadow || undefined,
    WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth}px ${t.strokeColor || '#000'}` : undefined,
    paintOrder: 'stroke fill',
    background: t.background || undefined,
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
    fontKerning: 'normal',
  }
  if (by === 'block' || (!animIn && !animOut)) {
    const a = animate(state, animIn, animOut, 0, 1)
    return (
      <div style={wrap}>
        <span style={{ ...textStyle, display: 'inline', ...a }}>{content}</span>
      </div>
    )
  }
  return (
    <div style={wrap}>
      <span style={textStyle}>
        {pieces.map((p) =>
          p.text === '\n' ? (
            <br key={p.index} />
          ) : (
            <span
              key={p.index}
              style={{
                display: 'inline-block',
                whiteSpace: 'pre',
                ...animate(state, animIn, animOut, p.index, pieces.length),
              }}
            >
              {p.text}
            </span>
          ),
        )}
      </span>
    </div>
  )
}

function split(text: string, by: string): Piece[] {
  if (by === 'char') return [...text].map((ch, index) => ({ text: ch === '\n' ? '\n' : ch, index }))
  if (by === 'word')
    return text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((w, index) => ({ text: w.includes('\n') ? '\n' : w, index }))
  if (by === 'line')
    return text.split('\n').flatMap((l, i, arr) =>
      i < arr.length - 1
        ? [
            { text: l, index: i * 2 },
            { text: '\n', index: i * 2 + 1 },
          ]
        : [{ text: l, index: i * 2 }],
    )
  return [{ text, index: 0 }]
}

type Anim = { preset?: string; duration?: number; stagger?: number; easing?: unknown }
function animate(
  state: ClipState,
  inA: Anim | undefined,
  outA: Anim | undefined,
  index: number,
  count: number,
): CSSProperties {
  const local = state.local
  const total = state.clip.duration
  let style: CSSProperties = {}
  const apply = (a: Anim, p: number) => {
    const k = 1 - p // 1 = hidden, 0 = shown
    switch (a.preset) {
      case 'fade':
        return { opacity: p }
      case 'rise':
        return { opacity: p, transform: `translateY(${k * 0.6}em)` }
      case 'drop':
        return { opacity: p, transform: `translateY(${-k * 0.6}em)` }
      case 'pop':
        return { opacity: p, transform: `scale(${0.6 + 0.4 * p})` }
      case 'scale-up':
        return { opacity: p, transform: `scale(${1.4 - 0.4 * p})` }
      case 'blur':
        return { opacity: p, filter: `blur(${k * 16}px)` }
      case 'slide-left':
        return { opacity: p, transform: `translateX(${k * 1.2}em)` }
      case 'slide-right':
        return { opacity: p, transform: `translateX(${-k * 1.2}em)` }
      case 'typewriter':
        return { opacity: p > 0.5 ? 1 : 0 }
      case 'wipe':
        return { clipPath: `inset(0 ${k * 100}% 0 0)` }
      default:
        return {}
    }
  }
  if (inA?.preset && inA.preset !== 'none') {
    const d = inA.duration ?? 0.6
    const start = index * (inA.stagger ?? 0.04)
    const p = ease((inA.easing as never) ?? 'expo-out', (local - start) / d)
    if (p < 1) style = apply(inA, p)
  }
  if (outA?.preset && outA.preset !== 'none') {
    const d = outA.duration ?? 0.6
    const start = total - d - (count - 1 - index) * (outA.stagger ?? 0.04)
    if (local > start) style = apply(outA, 1 - ease((outA.easing as never) ?? 'ease-in', (local - start) / d))
  }
  return style
}

// ── shapes ─────────────────────────────────────────────────────────────────

function ShapeLayer({ state }: { state: ClipState }) {
  const s = state.clip.shape ?? {}
  const w = state.width
  const h = state.height
  const fill = (state.values['shape.fill'] as string | undefined) ?? s.fill ?? '#fff'
  const stroke = s.stroke || undefined
  const sw = num(state, 'shape.strokeWidth', s.strokeWidth ?? 0)
  const trim = num(state, 'shape.trim', s.trim ?? 1)
  const dash = trim < 1 ? { pathLength: 1, strokeDasharray: `${trim} 1` } : {}
  const kind = s.kind ?? 'rect'
  const inset = sw / 2
  let el: React.ReactNode
  if (kind === 'ellipse')
    el = (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - inset)}
        ry={Math.max(0, h / 2 - inset)}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        {...dash}
      />
    )
  else if (kind === 'line')
    el = (
      <line
        x1={inset}
        y1={h / 2}
        x2={w - inset}
        y2={h / 2}
        stroke={stroke ?? fill}
        strokeWidth={sw || 4}
        strokeLinecap="round"
        {...dash}
      />
    )
  else if (kind === 'path')
    el = (
      <path
        d={s.path ?? ''}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...dash}
      />
    )
  else if (kind === 'polygon') {
    const n = s.sides ?? 6
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      return `${w / 2 + Math.cos(a) * (w / 2 - inset)},${h / 2 + Math.sin(a) * (h / 2 - inset)}`
    }).join(' ')
    el = (
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" {...dash} />
    )
  } else
    el = (
      <rect
        x={inset}
        y={inset}
        width={Math.max(0, w - sw)}
        height={Math.max(0, h - sw)}
        rx={num(state, 'style.radius', state.clip.style?.radius ?? 0)}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        {...dash}
      />
    )
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      aria-hidden="true"
    >
      {el}
    </svg>
  )
}

// ── code layers ────────────────────────────────────────────────────────────

let seekSeq = 0

function HtmlLayer({ state }: { state: ClipState }) {
  const { mode, register, playing } = useStage()
  const frame = useRef<HTMLIFrameElement>(null)
  const loaded = useRef<Promise<void> | null>(null)
  const h = state.clip.html ?? {}
  const width = Math.round(state.width)
  const height = Math.round(state.height)
  const doc = useMemo(
    () => htmlDocument(h.code ?? '', { width, height, transparent: h.transparent ?? true }),
    [h.code, width, height, h.transparent],
  )
  const props = h.props ?? {}

  const resolveLoaded = useRef<(() => void) | null>(null)
  useMemo(() => {
    // A fresh promise per document; the iframe's load event resolves it.
    loaded.current = new Promise<void>((resolve) => {
      resolveLoaded.current = resolve
      setTimeout(resolve, 5000)
    })
  }, [doc])

  useEffect(() => {
    const win = frame.current?.contentWindow
    if (!win || !loaded.current) return
    const id = ++seekSeq
    const t = state.local
    const p = loaded.current.then(
      () =>
        new Promise<void>((resolve) => {
          const on = (e: MessageEvent) => {
            if (
              e.source === frame.current?.contentWindow &&
              e.data?.type === 'greenlit:ready' &&
              e.data.id === id
            ) {
              window.removeEventListener('message', on)
              resolve()
            }
          }
          window.addEventListener('message', on)
          frame.current?.contentWindow?.postMessage(
            { type: 'greenlit:seek', t, props, id, width, height },
            '*',
          )
          setTimeout(
            () => {
              window.removeEventListener('message', on)
              resolve()
            },
            mode === 'render' ? 5000 : 1000,
          )
        }),
    )
    if (mode === 'render' || !playing) register(p)
  })

  return (
    <iframe
      ref={frame}
      title={state.clip.name || 'Code layer'}
      sandbox="allow-scripts"
      srcDoc={doc}
      onLoad={() => resolveLoaded.current?.()}
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        border: 0,
        background: 'transparent',
        pointerEvents: 'none',
        colorScheme: 'normal',
      }}
    />
  )
}
