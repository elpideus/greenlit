import { z } from 'zod'
import { Asset, Clip, Composition, Keyframe, OutputFormat, Track } from './schema.ts'

/**
 * Edits are small semantic operations. The editor, the API and Claude (MCP) all send the same ops, the server
 * applies them in order and broadcasts them, so every open editor updates live without re-rendering anything.
 */
const DeepPartialClip = z.record(z.string(), z.unknown())

export const Op = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_clip'),
    /** Track to put it on; omitted = a new track on top (visual) or at the bottom (audio). */
    trackId: z.string().optional(),
    clip: z.record(z.string(), z.unknown()).describe('A Clip; id is generated when missing'),
  }),
  z.object({
    op: z.literal('update_clip'),
    id: z.string(),
    patch: DeepPartialClip.describe('Deep-merged into the clip; arrays are replaced'),
  }),
  z.object({ op: z.literal('remove_clip'), id: z.string() }),
  z.object({
    op: z.literal('move_clip'),
    id: z.string(),
    start: z.number().min(0).optional(),
    trackId: z.string().optional(),
  }),
  z.object({
    op: z.literal('split_clip'),
    id: z.string(),
    at: z.number().describe('Composition time in seconds'),
    newId: z.string().optional(),
  }),
  z.object({
    op: z.literal('set_keyframes'),
    id: z.string(),
    prop: z.string(),
    keyframes: z.array(Keyframe).describe('Empty array removes the animation'),
  }),
  z.object({
    op: z.literal('add_track'),
    track: z.record(z.string(), z.unknown()),
    index: z.number().int().optional(),
  }),
  z.object({ op: z.literal('update_track'), id: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('remove_track'), id: z.string() }),
  z.object({ op: z.literal('reorder_tracks'), order: z.array(z.string()) }),
  z.object({ op: z.literal('add_asset'), asset: Asset }),
  z.object({ op: z.literal('remove_asset'), id: z.string() }),
  z.object({
    op: z.literal('set'),
    /** Composition-level field: fps, duration, background, formats, markers, fonts */
    key: z.enum(['fps', 'duration', 'background', 'formats', 'markers', 'fonts']),
    value: z.unknown(),
  }),
  z.object({ op: z.literal('replace'), composition: z.record(z.string(), z.unknown()) }),
])
export type Op = z.infer<typeof Op>

let counter = 0
export function newId(prefix = 'c') {
  counter = (counter + 1) % 1e6
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Deep merge; arrays and primitives replace; `null` deletes optional keys. */
export function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else out[k] = v
  }
  return out as T
}

export class OpError extends Error {}

/** Applies ops to a composition and returns the new, validated composition (the input is not modified). */
export function applyOps(doc: Composition, ops: Op[]): Composition {
  let c: Composition = structuredClone(doc)
  for (const op of ops) c = applyOne(c, op)
  const parsed = Composition.safeParse(c)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new OpError(`Invalid result: ${first?.path.join('.')}: ${first?.message}`)
  }
  return parsed.data
}

function locate(c: Composition, id: string) {
  for (const t of c.tracks) {
    const i = t.clips.findIndex((x) => x.id === id)
    if (i >= 0) return { track: t, i }
  }
  throw new OpError(`No clip with id ${id}`)
}

function trackFor(c: Composition, clipType: string, trackId?: string): Track {
  if (trackId) {
    const t = c.tracks.find((x) => x.id === trackId)
    if (!t) throw new OpError(`No track with id ${trackId}`)
    return t
  }
  const kind = clipType === 'audio' ? 'audio' : 'visual'
  const n = c.tracks.filter((t) => t.kind === kind).length + 1
  const track = Track.parse({
    id: newId(kind === 'audio' ? 'a' : 'v'),
    name: `${kind === 'audio' ? 'Audio' : 'Video'} ${n}`,
    kind,
  })
  if (kind === 'visual') {
    // above every existing visual track
    const lastVisual = c.tracks.map((t) => t.kind).lastIndexOf('visual')
    c.tracks.splice(lastVisual + 1, 0, track)
  } else c.tracks.push(track)
  return track
}

function applyOne(c: Composition, op: Op): Composition {
  switch (op.op) {
    case 'add_clip': {
      const raw = { id: newId(), ...op.clip } as Record<string, unknown>
      const clip = Clip.parse(raw)
      if (findClipIndex(c, clip.id)) throw new OpError(`A clip with id ${clip.id} already exists`)
      if (clip.assetId && !c.assets[clip.assetId])
        throw new OpError(`Unknown assetId ${clip.assetId}; add_asset first`)
      trackFor(c, clip.type, op.trackId).clips.push(clip)
      if (clip.start + clip.duration > c.duration) c.duration = round(clip.start + clip.duration)
      return c
    }
    case 'update_clip': {
      const { track, i } = locate(c, op.id)
      const { id: _ignore, ...patch } = op.patch
      const next = Clip.parse(deepMerge(track.clips[i]!, patch))
      track.clips[i] = next
      if (next.start + next.duration > c.duration) c.duration = round(next.start + next.duration)
      return c
    }
    case 'remove_clip': {
      const { track, i } = locate(c, op.id)
      track.clips.splice(i, 1)
      return c
    }
    case 'move_clip': {
      const { track, i } = locate(c, op.id)
      const clip = track.clips[i]!
      if (op.start !== undefined) clip.start = round(op.start)
      if (op.trackId && op.trackId !== track.id) {
        const dest = c.tracks.find((t) => t.id === op.trackId)
        if (!dest) throw new OpError(`No track with id ${op.trackId}`)
        track.clips.splice(i, 1)
        dest.clips.push(clip)
      }
      if (clip.start + clip.duration > c.duration) c.duration = round(clip.start + clip.duration)
      return c
    }
    case 'split_clip': {
      const { track, i } = locate(c, op.id)
      const a = track.clips[i]!
      const cut = op.at - a.start
      if (cut <= 0.01 || cut >= a.duration - 0.01) throw new OpError('Split time must be inside the clip')
      const b: typeof a = structuredClone(a)
      b.id = op.newId ?? newId()
      b.start = round(op.at)
      b.duration = round(a.duration - cut)
      b.in = round((a.in ?? 0) + cut * (a.speed ?? 1))
      b.transitionIn = undefined
      a.duration = round(cut)
      a.transitionOut = undefined
      // keyframes: keep each half's own part, shifted for the second half
      const splitKeys = (
        keys: Record<string, { t: number; value: number | string; easing?: unknown }[]>,
        first: boolean,
      ) =>
        Object.fromEntries(
          Object.entries(keys).map(([k, list]) => [
            k,
            list
              .filter((kf) => (first ? kf.t <= cut : kf.t >= cut))
              .map((kf) => (first ? kf : { ...kf, t: round(kf.t - cut) })),
          ]),
        )
      a.keyframes = splitKeys(a.keyframes as never, true) as never
      b.keyframes = splitKeys(b.keyframes as never, false) as never
      track.clips.splice(i + 1, 0, b)
      return c
    }
    case 'set_keyframes': {
      const { track, i } = locate(c, op.id)
      const clip = track.clips[i]!
      const keys = { ...clip.keyframes }
      if (op.keyframes.length) keys[op.prop] = [...op.keyframes].sort((x, y) => x.t - y.t)
      else delete keys[op.prop]
      track.clips[i] = { ...clip, keyframes: keys }
      return c
    }
    case 'add_track': {
      const track = Track.parse({ id: newId('t'), ...op.track })
      if (c.tracks.some((t) => t.id === track.id)) throw new OpError(`Track ${track.id} exists`)
      if (op.index === undefined) c.tracks.push(track)
      else c.tracks.splice(op.index, 0, track)
      return c
    }
    case 'update_track': {
      const i = c.tracks.findIndex((t) => t.id === op.id)
      if (i < 0) throw new OpError(`No track with id ${op.id}`)
      const { id: _i, clips: _c, ...patch } = op.patch
      c.tracks[i] = Track.parse(deepMerge(c.tracks[i]!, patch))
      return c
    }
    case 'remove_track': {
      c.tracks = c.tracks.filter((t) => t.id !== op.id)
      return c
    }
    case 'reorder_tracks': {
      const byId = new Map(c.tracks.map((t) => [t.id, t]))
      const ordered = op.order.map((id) => byId.get(id)).filter((t): t is Track => !!t)
      const rest = c.tracks.filter((t) => !op.order.includes(t.id))
      c.tracks = [...ordered, ...rest]
      return c
    }
    case 'add_asset': {
      c.assets[op.asset.id] = op.asset
      return c
    }
    case 'remove_asset': {
      delete c.assets[op.id]
      return c
    }
    case 'set': {
      if (op.key === 'formats') z.array(OutputFormat).min(1).parse(op.value)
      ;(c as Record<string, unknown>)[op.key] = op.value
      return c
    }
    case 'replace':
      return Composition.parse(op.composition)
  }
}

function findClipIndex(c: Composition, id: string) {
  return c.tracks.some((t) => t.clips.some((x) => x.id === id))
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** A readable outline for humans and LLMs: tracks, clips, times. */
export function describe(c: Composition): string {
  const lines = [
    `fps ${c.fps}, duration ${c.duration}s, background ${c.background}`,
    `formats: ${c.formats.map((f) => `${f.id} ${f.width}x${f.height}`).join(', ')}`,
    `assets: ${
      Object.values(c.assets)
        .map(
          (a) =>
            `${a.id}=${a.kind} "${a.name}" (media ${a.mediaId}${a.version ? `, version ${a.version}` : ''}${a.duration ? `, ${a.duration}s` : ''})`,
        )
        .join('; ') || 'none'
    }`,
    'tracks (bottom → top):',
  ]
  for (const t of c.tracks) {
    lines.push(`  ${t.id} [${t.kind}] ${t.name}${t.hidden ? ' (hidden)' : ''}${t.muted ? ' (muted)' : ''}`)
    for (const k of [...t.clips].sort((a, b) => a.start - b.start)) {
      const what =
        k.type === 'text'
          ? `"${(k.text?.content ?? '').slice(0, 40)}"`
          : k.assetId
            ? `asset ${k.assetId}${k.in ? ` from ${k.in}s` : ''}`
            : k.type
      const anim = Object.keys(k.keyframes ?? {})
      lines.push(
        `    ${k.id} ${k.type} ${what} @${k.start}s for ${k.duration}s${anim.length ? ` animates ${anim.join(',')}` : ''}${Object.keys(k.formats ?? {}).length ? ` overrides ${Object.keys(k.formats).join(',')}` : ''}`,
      )
    }
  }
  return lines.join('\n')
}
