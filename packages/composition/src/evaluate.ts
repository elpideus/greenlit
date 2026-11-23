import type { Clip, Composition, Easing, Keyframe, OutputFormat, Transition } from './schema.ts'

// ── easing ─────────────────────────────────────────────────────────────────

function bezier(x1: number, y1: number, x2: number, y2: number) {
  // Newton-Raphson on x(t), then y(t) — same curve as CSS cubic-bezier.
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) break
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    return sy(Math.max(0, Math.min(1, t)))
  }
}

const curves: Record<string, (x: number) => number> = {
  linear: (x) => x,
  ease: bezier(0.25, 0.1, 0.25, 1),
  'ease-in': bezier(0.42, 0, 1, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1),
  'expo-out': bezier(0.16, 1, 0.3, 1),
  'back-out': bezier(0.34, 1.56, 0.64, 1),
  hold: () => 0,
  // Critically damped-ish spring with a soft overshoot, normalised to land at 1.
  spring: (x) => 1 - Math.exp(-6 * x) * Math.cos(5 * x) * (1 - x) - 0 * x,
}

export function ease(e: Easing | undefined, x: number): number {
  const p = Math.max(0, Math.min(1, x))
  if (!e) return p
  if (Array.isArray(e)) return bezier(e[0], e[1], e[2], e[3])(p)
  return (curves[e] ?? curves.linear!)(p)
}

// ── values ─────────────────────────────────────────────────────────────────

const HEX = /^#([0-9a-f]{3,8})$/i
function parseColor(s: string): [number, number, number, number] | null {
  const m = s.match(HEX)
  if (!m) {
    const r = s.match(/rgba?\(([^)]+)\)/)
    if (!r) return null
    const p = r[1]!
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number)
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
  }
  let h = m[1]!
  if (h.length <= 4) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h.slice(0, 6), 16)
  const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
}

function mix(a: number | string, b: number | string, p: number): number | string {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p
  if (typeof a === 'string' && typeof b === 'string') {
    const ca = parseColor(a)
    const cb = parseColor(b)
    if (ca && cb) {
      const c = ca.map((v, i) => v + (cb[i]! - v) * p)
      return `rgba(${Math.round(c[0]!)}, ${Math.round(c[1]!)}, ${Math.round(c[2]!)}, ${Math.round(c[3]! * 1000) / 1000})`
    }
  }
  return p < 1 ? a : b
}

/** Value of an animated property at `t` seconds into the clip. */
export function sample(keys: Keyframe[] | undefined, t: number): number | string | undefined {
  if (!keys?.length) return undefined
  const ks = keys.length > 1 ? [...keys].sort((a, b) => a.t - b.t) : keys
  if (t <= ks[0]!.t) return ks[0]!.value
  const last = ks[ks.length - 1]!
  if (t >= last.t) return last.value
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]!
    const b = ks[i + 1]!
    if (t >= a.t && t <= b.t) {
      const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
      return mix(a.value, b.value, ease(a.easing ?? 'ease-in-out', p))
    }
  }
  return last.value
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    )
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let o: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!
    if (!o[k] || typeof o[k] !== 'object') o[k] = {}
    o = o[k] as Record<string, unknown>
  }
  o[parts[parts.length - 1]!] = value
}

// ── clips ──────────────────────────────────────────────────────────────────

export const isActive = (c: Clip, t: number) =>
  !c.hidden && t >= c.start - 1e-9 && t < c.start + c.duration - 1e-9

/** The clip as it is for one format: format overrides merged in. */
export function forFormat(clip: Clip, formatId: string): Clip {
  const o = clip.formats?.[formatId]
  if (!o) return clip
  return {
    ...clip,
    hidden: o.hidden ?? clip.hidden,
    transform: { ...clip.transform, ...(o.transform ?? {}) },
    crop: { ...clip.crop, ...(o.crop ?? {}) },
    text: clip.text || o.text ? { ...(clip.text ?? {}), ...(o.text ?? {}) } : undefined,
    keyframes: { ...clip.keyframes, ...(o.keyframes ?? {}) },
  }
}

export interface ClipState {
  clip: Clip
  /** Seconds since the clip started. */
  local: number
  /** Seconds into the source media. */
  mediaTime: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scale: number
  anchorX: number
  anchorY: number
  opacity: number
  /** Extra transform from transitions, in px / multipliers. */
  dx: number
  dy: number
  dscale: number
  blur: number
  /** CSS clip-path from wipe/iris transitions (empty = none). */
  reveal: string
  filter: string
  volume: number
  /** Every animated value resolved, keyed by property path (text.fontSize, focusX, shape.trim...). */
  values: Record<string, number | string>
}

function transitionAmount(tr: Transition | undefined, local: number, duration: number, dir: 'in' | 'out') {
  if (!tr) return null
  const d = Math.min(tr.duration, duration / 2)
  const p = dir === 'in' ? local / d : (duration - local) / d
  if (p >= 1) return null
  return { type: tr.type, k: 1 - ease(tr.easing, Math.max(0, p)) }
}

/** Everything needed to draw a clip at composition time `t` for one format. */
export function clipState(raw: Clip, t: number, format: OutputFormat): ClipState {
  const clip = forFormat(raw, format.id)
  const local = Math.max(0, t - clip.start)
  const values: Record<string, number | string> = {}
  for (const [path, keys] of Object.entries(clip.keyframes ?? {})) {
    const v = sample(keys, local)
    if (v !== undefined) values[path] = v
  }
  const num = (path: string, fallback: number) => {
    const v = values[path] ?? getPath(clip as unknown as Record<string, unknown>, path)
    return typeof v === 'number' ? v : fallback
  }
  const tr = clip.transform
  // Media clips default to filling the frame when no size was given.
  const animW = values['transform.width']
  const animH = values['transform.height']
  const width = typeof animW === 'number' ? animW : tr.width || format.width
  const height = typeof animH === 'number' ? animH : tr.height || format.height
  let opacity = num('transform.opacity', tr.opacity ?? 1)
  let dx = 0
  let dy = 0
  let dscale = 1
  let blur = 0
  let reveal = ''
  for (const [dir, def] of [
    ['in', clip.transitionIn],
    ['out', clip.transitionOut],
  ] as const) {
    const a = transitionAmount(def, local, clip.duration, dir)
    if (!a) continue
    const s = dir === 'in' ? 1 : -1
    switch (a.type) {
      case 'fade':
        opacity *= 1 - a.k
        break
      case 'slide-left':
        dx += format.width * a.k * s
        break
      case 'slide-right':
        dx -= format.width * a.k * s
        break
      case 'slide-up':
        dy += format.height * a.k * s
        break
      case 'slide-down':
        dy -= format.height * a.k * s
        break
      case 'zoom-in':
        dscale *= 1 - 0.25 * a.k * s
        opacity *= 1 - a.k
        break
      case 'zoom-out':
        dscale *= 1 + 0.25 * a.k * s
        opacity *= 1 - a.k
        break
      case 'blur':
        blur += 40 * a.k
        opacity *= 1 - a.k
        break
      case 'wipe-left':
        reveal = dir === 'in' ? `inset(0 0 0 ${a.k * 100}%)` : `inset(0 ${a.k * 100}% 0 0)`
        break
      case 'wipe-right':
        reveal = dir === 'in' ? `inset(0 ${a.k * 100}% 0 0)` : `inset(0 0 0 ${a.k * 100}%)`
        break
      case 'iris':
        reveal = `circle(${(1 - a.k) * 75}% at 50% 50%)`
        break
    }
  }
  const f = clip.style?.filters ?? {}
  const fv = (k: string, d: number) => num(`style.filters.${k}`, (f as Record<string, number>)[k] ?? d)
  const parts: string[] = []
  const b = fv('blur', 0) + blur
  if (b > 0) parts.push(`blur(${b}px)`)
  for (const [k, css, d] of [
    ['brightness', 'brightness', 1],
    ['contrast', 'contrast', 1],
    ['saturate', 'saturate', 1],
    ['grayscale', 'grayscale', 0],
    ['sepia', 'sepia', 0],
  ] as const) {
    const v = fv(k, d)
    if (v !== d) parts.push(`${css}(${v})`)
  }
  const hue = fv('hue', 0)
  if (hue) parts.push(`hue-rotate(${hue}deg)`)
  const a = clip.audio ?? {}
  let volume = a.muted ? 0 : num('audio.volume', a.volume ?? 1)
  if (a.fadeIn && local < a.fadeIn) volume *= local / a.fadeIn
  if (a.fadeOut && clip.duration - local < a.fadeOut)
    volume *= Math.max(0, (clip.duration - local) / a.fadeOut)
  return {
    clip,
    local,
    mediaTime: (clip.in ?? 0) + local * (clip.speed ?? 1),
    x: num('transform.x', tr.x),
    y: num('transform.y', tr.y),
    width,
    height,
    rotation: num('transform.rotation', tr.rotation),
    scale: num('transform.scale', tr.scale ?? 1),
    anchorX: tr.anchorX ?? 0.5,
    anchorY: tr.anchorY ?? 0.5,
    opacity: Math.max(0, Math.min(1, opacity)),
    dx,
    dy,
    dscale,
    blur,
    reveal,
    filter: parts.join(' '),
    volume: Math.max(0, volume),
    values,
  }
}

/** Visual clips to draw at `t`, bottom first. */
export function visibleClips(comp: Composition, t: number, format: OutputFormat): ClipState[] {
  const out: ClipState[] = []
  for (const track of comp.tracks) {
    if (track.hidden || track.kind !== 'visual') continue
    for (const c of track.clips) {
      if (c.type === 'audio' || !isActive(c, t)) continue
      const s = clipState(c, t, format)
      if (s.clip.hidden) continue
      out.push(s)
    }
  }
  return out
}

/** Clips that make sound at `t` (audio clips and videos with sound) with their track volume. */
export function audibleClips(comp: Composition, t: number, format: OutputFormat) {
  const out: { state: ClipState; trackVolume: number }[] = []
  for (const track of comp.tracks) {
    if (track.muted) continue
    for (const c of track.clips) {
      if (!isActive(c, t)) continue
      if (c.type !== 'audio' && c.type !== 'video') continue
      const asset = c.assetId ? comp.assets[c.assetId] : undefined
      if (c.type === 'video' && asset && !asset.hasAudio) continue
      out.push({ state: clipState(c, t, format), trackVolume: track.volume ?? 1 })
    }
  }
  return out
}

export function allClips(comp: Composition): (Clip & { trackId: string })[] {
  return comp.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, trackId: t.id })))
}

export function findClip(comp: Composition, id: string) {
  for (const t of comp.tracks) {
    const i = t.clips.findIndex((c) => c.id === id)
    if (i >= 0) return { track: t, clip: t.clips[i]!, index: i }
  }
  return null
}

/** End of the last clip (useful to suggest a duration). */
export function contentEnd(comp: Composition) {
  return Math.max(0, ...allClips(comp).map((c) => c.start + c.duration))
}

export function frameCount(comp: Composition) {
  return Math.max(1, Math.round(comp.duration * comp.fps))
}

export { getPath, setPath }
