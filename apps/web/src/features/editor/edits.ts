import {
  type Asset,
  type Clip,
  type Composition,
  clipState,
  forFormat,
  getPath,
  type Keyframe,
  newId,
  type Op,
  type OutputFormat,
  type Track,
} from '@greenlit/composition'

/**
 * Builders for the ops the editor sends. They encode the editing rules in one place:
 * - a property with keyframes is edited by setting a keyframe at the playhead;
 * - in any format but the design one (the first), framing edits (transform, focus, crop, text) go into that
 *   format's override, so a 9:16 reframe never disturbs the 16:9 cut;
 * - clips never overlap on a track.
 */

export function findClip(doc: Composition, id: string): { clip: Clip; track: Track } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === id)
    if (clip) return { clip, track }
  }
  return null
}

export function nested(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.')
  const out: Record<string, unknown> = {}
  let cur = out
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value
    else {
      const next: Record<string, unknown> = {}
      cur[p] = next
      cur = next
    }
  })
  return out
}

const OVERRIDABLE = /^(transform\.|text\.|crop\.|focusX$|focusY$)/

/** Keyframes of a property as they apply to a format. */
export function keyframesFor(clip: Clip, path: string, formatId: string, design: string): Keyframe[] {
  if (formatId !== design) {
    const o = clip.formats?.[formatId]?.keyframes?.[path]
    if (o) return o
  }
  return clip.keyframes?.[path] ?? []
}

/** The value of a property at composition time `t` in a format (animated or static). */
export function valueAt(
  clip: Clip,
  path: string,
  t: number,
  format: OutputFormat,
): number | string | undefined {
  const s = clipState(clip, t, format)
  if (path in s.values) return s.values[path]
  const own: Record<string, number | undefined> = {
    'transform.x': s.x,
    'transform.y': s.y,
    'transform.width': s.width,
    'transform.height': s.height,
    'transform.rotation': s.rotation,
    'transform.scale': s.scale,
    'transform.opacity': clip.transform.opacity,
  }
  if (path in own) return own[path]
  return getPath(forFormat(clip, format.id) as unknown as Record<string, unknown>, path) as
    | number
    | string
    | undefined
}

/**
 * Ops that set `path` to `value` on a clip, following the rules above. `t` = composition time of the edit.
 */
export function setProp(
  doc: Composition,
  clipId: string,
  path: string,
  value: unknown,
  t: number,
  formatId: string,
): Op[] {
  const found = findClip(doc, clipId)
  if (!found) return []
  const { clip } = found
  const design = doc.formats[0]?.id ?? 'main'
  const override = formatId !== design && OVERRIDABLE.test(path)
  const keys = keyframesFor(clip, path, formatId, design)
  if (keys.length && (typeof value === 'number' || typeof value === 'string')) {
    const local = round(Math.max(0, Math.min(clip.duration, t - clip.start)))
    const next = upsertKey(keys, local, value)
    return [keyframeOp(clip, path, next, override && !!clip.formats?.[formatId]?.keyframes?.[path], formatId)]
  }
  if (override) {
    if (path === 'focusX' || path === 'focusY')
      return [
        {
          op: 'update_clip',
          id: clipId,
          patch: { formats: { [formatId]: { keyframes: { [path]: [{ t: 0, value }] } } } },
        },
      ]
    return [{ op: 'update_clip', id: clipId, patch: { formats: { [formatId]: nested(path, value) } } }]
  }
  return [{ op: 'update_clip', id: clipId, patch: nested(path, value) }]
}

function keyframeOp(clip: Clip, path: string, keys: Keyframe[], inOverride: boolean, formatId: string): Op {
  if (inOverride)
    return {
      op: 'update_clip',
      id: clip.id,
      patch: { formats: { [formatId]: { keyframes: { [path]: keys } } } },
    }
  return { op: 'set_keyframes', id: clip.id, prop: path, keyframes: keys }
}

function upsertKey(keys: Keyframe[], t: number, value: number | string): Keyframe[] {
  const near = keys.findIndex((k) => Math.abs(k.t - t) < 1 / 120)
  if (near >= 0) return keys.map((k, i) => (i === near ? { ...k, value } : k))
  const prev = [...keys].reverse().find((k) => k.t < t)
  return [...keys, { t, value, easing: prev?.easing ?? 'ease-in-out' }].sort((a, b) => a.t - b.t)
}

/** Adds a keyframe at the playhead with the current value, or removes the one that is there. */
export function toggleKeyframe(
  doc: Composition,
  clipId: string,
  path: string,
  t: number,
  format: OutputFormat,
): Op[] {
  const found = findClip(doc, clipId)
  if (!found) return []
  const { clip } = found
  const design = doc.formats[0]?.id ?? 'main'
  const override = format.id !== design && OVERRIDABLE.test(path)
  const keys = keyframesFor(clip, path, format.id, design)
  const local = round(Math.max(0, Math.min(clip.duration, t - clip.start)))
  const at = keys.findIndex((k) => Math.abs(k.t - local) < 1 / 60)
  if (at >= 0)
    return [
      keyframeOp(
        clip,
        path,
        keys.filter((_, i) => i !== at),
        override,
        format.id,
      ),
    ]
  const value = valueAt(clip, path, t, format)
  if (value === undefined) return []
  return [keyframeOp(clip, path, upsertKey(keys, local, value), override, format.id)]
}

export function keyAtPlayhead(clip: Clip, path: string, t: number, formatId: string, design: string) {
  const local = t - clip.start
  return keyframesFor(clip, path, formatId, design).some((k) => Math.abs(k.t - local) < 1 / 60)
}

// ── timeline geometry ────────────────────────────────────────────────────────────────

/** The closest start for a clip of `duration` on `track` near `want`, never overlapping others (null: no room). */
export function freeStart(
  track: Track,
  want: number,
  duration: number,
  ignore: string[] = [],
): number | null {
  const others = track.clips.filter((c) => !ignore.includes(c.id)).sort((a, b) => a.start - b.start)
  const gaps: [number, number][] = []
  let cursor = 0
  for (const c of others) {
    if (c.start - cursor >= duration - 1e-6) gaps.push([cursor, c.start - duration])
    cursor = Math.max(cursor, c.start + c.duration)
  }
  gaps.push([cursor, Number.POSITIVE_INFINITY])
  let best: number | null = null
  for (const [a, b] of gaps) {
    const s = Math.max(a, Math.min(b, want))
    if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s
  }
  return best === null ? null : round(Math.max(0, best))
}

export function trackFits(track: Track, start: number, duration: number, ignore: string[] = []) {
  return track.clips.every(
    (c) =>
      ignore.includes(c.id) || c.start + c.duration <= start + 1e-6 || c.start >= start + duration - 1e-6,
  )
}

// ── clip templates ───────────────────────────────────────────────────────────────────

export type NewKind = 'text' | 'shape' | 'ellipse' | 'solid' | 'html'

export function templateClip(
  kind: NewKind,
  at: number,
  format: OutputFormat,
  duration = 4,
): Record<string, unknown> {
  const w = format.width
  const h = format.height
  const base = { id: newId(), start: round(at), duration }
  switch (kind) {
    case 'text':
      return {
        ...base,
        type: 'text',
        name: 'Title',
        transform: { x: w * 0.1, y: h * 0.38, width: w * 0.8, height: h * 0.24 },
        text: {
          content: 'Your title',
          fontFamily: 'Inter Variable',
          fontSize: Math.round(Math.min(w, h) * 0.09),
          fontWeight: 700,
          letterSpacing: -0.02,
          animateIn: { preset: 'rise', by: 'word', duration: 0.7, stagger: 0.06 },
          animateOut: { preset: 'fade', duration: 0.4 },
        },
      }
    case 'shape':
    case 'ellipse':
      return {
        ...base,
        type: 'shape',
        name: kind === 'ellipse' ? 'Circle' : 'Rectangle',
        transform: {
          x: w / 2 - Math.min(w, h) * 0.15,
          y: h / 2 - Math.min(w, h) * 0.15,
          width: Math.min(w, h) * 0.3,
          height: Math.min(w, h) * 0.3,
        },
        shape: { kind: kind === 'ellipse' ? 'ellipse' : 'rect', fill: '#42D77B' },
      }
    case 'solid':
      return { ...base, type: 'solid', name: 'Background', fill: 'linear-gradient(160deg, #1b1d1b, #0a0b0a)' }
    case 'html':
      return {
        ...base,
        type: 'html',
        name: 'Motion graphic',
        duration: 5,
        html: { transparent: true, code: CODE_TEMPLATE },
      }
  }
}

const CODE_TEMPLATE = `<style>
  /* No backdrop-filter: code layers are transparent frames, so there is nothing behind them to blur. */
  body { display: grid; place-items: center; font-family: 'Inter Variable', system-ui, sans-serif; }
  .card { padding: 48px 72px; border-radius: 28px; background: rgba(12,13,12,.82); color: #edefed;
          box-shadow: 0 30px 80px rgba(0,0,0,.35); animation: in 900ms cubic-bezier(.22,1,.36,1) both; }
  .card h1 { margin: 0; font-size: 96px; letter-spacing: -0.04em; }
  .card p { margin: 12px 0 0; font-size: 36px; color: #a8aca9; animation: in 900ms 250ms cubic-bezier(.22,1,.36,1) both; }
  .lamp { display: inline-block; width: .5em; height: .5em; border-radius: 50%; background: #42d77b;
          box-shadow: 0 0 24px #42d77b; margin-left: .2em; vertical-align: .15em; }
  @keyframes in { from { opacity: 0; transform: translateY(40px) scale(.98); filter: blur(8px) } }
</style>
<div class="card">
  <h1>Greenlit<span class="lamp"></span></h1>
  <p>Every frame, drawn live — no render needed.</p>
</div>
<script>
  // Time comes from Greenlit: derive everything from t (CSS animations are moved to t for you).
  greenlit.onFrame((t) => { document.body.style.setProperty('--progress', String(Math.min(1, t / 5))) })
</script>
`

/** add_asset + add_clip for library media dropped at `at` (videos back to back, pictures 4 s). */
export function mediaClipOps(
  doc: Composition,
  assets: Asset[],
  at: number,
  trackId?: string,
): { ops: Op[]; ids: string[] } {
  const ops: Op[] = []
  const ids: string[] = []
  let t = at
  const visual = trackId
    ? doc.tracks.find((tr) => tr.id === trackId)
    : doc.tracks.find((tr) => tr.kind === 'visual')
  const audio = doc.tracks.find((tr) => tr.kind === 'audio')
  for (const a of assets) {
    ops.push({ op: 'add_asset', asset: a })
    const duration = a.kind === 'image' ? 4 : Math.max(0.5, a.duration ?? 4)
    const id = newId()
    ids.push(id)
    const track = a.kind === 'audio' ? audio : visual
    const start = track ? freeStart(track, t, duration, []) : t
    ops.push({
      op: 'add_clip',
      ...(track && start !== null ? { trackId: track.id } : {}),
      clip: { id, type: a.kind, name: a.name, assetId: a.id, start: start ?? t, duration },
    })
    t = (start ?? t) + duration
  }
  return { ops, ids }
}

export function round(n: number) {
  return Math.round(n * 1000) / 1000
}

export function snapToFrame(t: number, fps: number) {
  return Math.round(t * fps) / fps
}
