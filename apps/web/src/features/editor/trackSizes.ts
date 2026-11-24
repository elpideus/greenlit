import type { Composition, Track } from '@greenlit/composition'

/**
 * Track heights in the timeline, as in Premiere, Resolve or Final Cut: every track has a height of its own (drag the
 * lower edge of its header, Alt + wheel over it), and a size for all tracks at once (small / medium / large, Alt +
 * Shift + wheel) that resets them. Clips scale with their track: filmstrips, waveforms and labels follow its height.
 *
 * Heights are a way of looking at an edit, not part of it, so they stay out of the document (no op, no revision, no
 * history entry, nothing sent to the other people in the editor or to Claude, and viewers can change them too).
 * They are kept per editing project on this device (localStorage), next to the editor's other view settings (the
 * timeline's height, snapping).
 */
export interface TrackSizes {
  /** The size of every track that has none of its own. */
  all: { visual: number; audio: number }
  /** Tracks resized one by one: track id → height in px. */
  tracks: Record<string, number>
}

export type SizePreset = 'small' | 'medium' | 'large'

export const SIZE_PRESETS: Record<SizePreset, TrackSizes['all']> = {
  small: { visual: 36, audio: 30 },
  medium: { visual: 60, audio: 44 },
  large: { visual: 104, audio: 76 },
}

/** A track never gets lower than one line of text with its buttons, nor taller than a filmstrip needs. */
export const MIN_TRACK_H = 26
export const MAX_TRACK_H = 240

export const DEFAULT_SIZES: TrackSizes = { all: SIZE_PRESETS.medium, tracks: {} }

export const clampHeight = (h: number) => Math.round(Math.min(MAX_TRACK_H, Math.max(MIN_TRACK_H, h)))

export function trackHeight(sizes: TrackSizes, track: Pick<Track, 'id' | 'kind'>) {
  return clampHeight(sizes.tracks[track.id] ?? sizes.all[track.kind])
}

/** One track at a new height. Tracks that are gone are forgotten (`keep`: the ids the edit has now). */
export function resizeTrack(sizes: TrackSizes, trackId: string, h: number, keep?: string[]): TrackSizes {
  const tracks = { ...sizes.tracks, [trackId]: clampHeight(h) }
  if (keep) for (const id of Object.keys(tracks)) if (!keep.includes(id)) delete tracks[id]
  return { ...sizes, tracks }
}

/** Back to the size of all tracks. */
export function resetTrack(sizes: TrackSizes, trackId: string): TrackSizes {
  const { [trackId]: _gone, ...tracks } = sizes.tracks
  return { ...sizes, tracks }
}

/** Every track at one size (a preset, or the current one scaled): tracks resized one by one follow too. */
export function sizeAll(sizes: TrackSizes, to: SizePreset | number): TrackSizes {
  const all =
    typeof to === 'number'
      ? { visual: clampHeight(sizes.all.visual * to), audio: clampHeight(sizes.all.audio * to) }
      : SIZE_PRESETS[to]
  return { all, tracks: {} }
}

/** The preset all tracks are at, if they are at one and none has a size of its own. */
export function currentPreset(sizes: TrackSizes): SizePreset | null {
  if (Object.keys(sizes.tracks).length) return null
  for (const [k, p] of Object.entries(SIZE_PRESETS) as [SizePreset, TrackSizes['all']][])
    if (p.visual === sizes.all.visual && p.audio === sizes.all.audio) return k
  return null
}

/** Whatever was stored (by an older build, or edited by hand) as sizes that can be used. */
export function readSizes(raw: unknown): TrackSizes {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TrackSizes>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clampHeight(v) : d)
  const tracks: Record<string, number> = {}
  if (r.tracks && typeof r.tracks === 'object')
    for (const [id, h] of Object.entries(r.tracks))
      if (typeof h === 'number' && Number.isFinite(h)) tracks[id] = clampHeight(h)
  return {
    all: {
      visual: num(r.all?.visual, DEFAULT_SIZES.all.visual),
      audio: num(r.all?.audio, DEFAULT_SIZES.all.audio),
    },
    tracks,
  }
}

export interface Row {
  track: Track
  /** Top of the row from the top of the first track, in px. */
  y: number
  h: number
}

/** Display order: the top visual track first (it draws above the others), then audio; each at its height. */
export function rowsOf(doc: Pick<Composition, 'tracks'>, sizes: TrackSizes): Row[] {
  const visual = doc.tracks.filter((t) => t.kind === 'visual').reverse()
  const audio = doc.tracks.filter((t) => t.kind === 'audio')
  let y = 0
  return [...visual, ...audio].map((track) => {
    const h = trackHeight(sizes, track)
    const row = { track, y, h }
    y += h
    return row
  })
}

/** The row at `y` px from the top of the first track. */
export const rowAtY = (rows: Row[], y: number) => rows.find((r) => y >= r.y && y < r.y + r.h) ?? null

/**
 * How a clip of this inner height draws: `compact` keeps the label on one centred line and drops what doesn't fit
 * (keyframe marks, the speed badge); `pad` is the gap above and below it in its track.
 */
export function clipLayout(trackH: number) {
  const pad = trackH < 40 ? 2 : 4
  const inner = trackH - pad * 2
  return { pad, inner, compact: inner < 34 }
}
