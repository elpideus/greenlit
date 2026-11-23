import type { Clip, Composition, Op, Track } from '@greenlit/composition'

/**
 * Ops that turn document `a` into document `b`, touching only what differs. Undo/redo use it: undoing an action
 * applies diffOps(after, before) to the *current* document, so edits made meanwhile by someone else (or Claude)
 * elsewhere in the document survive.
 */
export function diffOps(a: Composition, b: Composition): Op[] {
  const ops: Op[] = []
  const tail: Op[] = []

  for (const key of ['fps', 'duration', 'background', 'formats', 'markers', 'fonts'] as const) {
    if (!equal(a[key], b[key])) ops.push({ op: 'set', key, value: b[key] })
  }

  for (const [id, asset] of Object.entries(b.assets)) {
    if (!equal(a.assets[id], asset)) ops.push({ op: 'add_asset', asset })
  }
  for (const id of Object.keys(a.assets)) if (!b.assets[id]) tail.push({ op: 'remove_asset', id })

  const aTracks = new Map(a.tracks.map((t) => [t.id, t]))
  const bTracks = new Map(b.tracks.map((t) => [t.id, t]))
  const newTracks = new Set<string>()
  b.tracks.forEach((t, index) => {
    if (!aTracks.has(t.id)) {
      newTracks.add(t.id)
      ops.push({ op: 'add_track', track: t as unknown as Record<string, unknown>, index })
    }
  })
  for (const t of b.tracks) {
    const prev = aTracks.get(t.id)
    if (!prev) continue
    const patch = objectPatch(trackProps(prev), trackProps(t))
    if (patch) ops.push({ op: 'update_track', id: t.id, patch })
  }

  const aClips = clipIndex(a)
  const bClips = clipIndex(b)
  for (const [id, { clip, trackId }] of bClips) {
    const prev = aClips.get(id)
    if (!prev) {
      if (!newTracks.has(trackId))
        ops.push({ op: 'add_clip', trackId, clip: clip as unknown as Record<string, unknown> })
      continue
    }
    if (prev.trackId !== trackId) ops.push({ op: 'move_clip', id, trackId })
    const patch = objectPatch(
      prev.clip as unknown as Record<string, unknown>,
      clip as unknown as Record<string, unknown>,
    )
    if (patch) ops.push({ op: 'update_clip', id, patch })
  }
  for (const [id, { trackId }] of aClips) {
    if (!bClips.has(id) && bTracks.has(trackId)) ops.push({ op: 'remove_clip', id })
    else if (!bClips.has(id) && !bTracks.has(trackId)) {
      /* goes with its track */
    }
  }
  for (const t of a.tracks) if (!bTracks.has(t.id)) tail.push({ op: 'remove_track', id: t.id })

  const common = b.tracks.filter((t) => aTracks.has(t.id)).map((t) => t.id)
  const before = a.tracks.filter((t) => bTracks.has(t.id)).map((t) => t.id)
  if (!equal(common, before)) ops.push({ op: 'reorder_tracks', order: b.tracks.map((t) => t.id) })

  return [...ops, ...tail]
}

function trackProps(t: Track) {
  const { clips: _c, id: _i, ...rest } = t
  return rest as Record<string, unknown>
}

function clipIndex(c: Composition) {
  const m = new Map<string, { clip: Clip; trackId: string }>()
  for (const t of c.tracks) for (const clip of t.clips) m.set(clip.id, { clip, trackId: t.id })
  return m
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A deep-merge patch turning `a` into `b` (null removes a key), or null when equal. */
export function objectPatch(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b)) {
    if (k === 'id') continue
    const prev = a[k]
    if (isObj(prev) && isObj(v)) {
      const inner = objectPatch(prev, v)
      if (inner) out[k] = inner
    } else if (!equal(prev, v)) out[k] = v
  }
  for (const k of Object.keys(a)) if (!(k in b) && a[k] !== undefined) out[k] = null
  return Object.keys(out).length ? out : null
}

export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => equal(v, bb[i]))
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
