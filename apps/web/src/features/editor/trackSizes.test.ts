import { emptyComposition, Track } from '@greenlit/composition'
import { describe, expect, it } from 'vitest'
import {
  clipLayout,
  currentPreset,
  DEFAULT_SIZES,
  MAX_TRACK_H,
  MIN_TRACK_H,
  readSizes,
  resetTrack,
  resizeTrack,
  rowAtY,
  rowsOf,
  SIZE_PRESETS,
  sizeAll,
} from './trackSizes.ts'

/** Two video tracks and two audio tracks: v1 at the bottom of the picture, v2 above it. */
const doc = () => {
  const d = emptyComposition()
  d.tracks.splice(1, 0, Track.parse({ id: 'v2', kind: 'visual' }))
  d.tracks.push(Track.parse({ id: 'a2', kind: 'audio' }))
  return d
}

describe('track heights', () => {
  it('lays tracks out top visual track first, then audio, each at its height', () => {
    const rows = rowsOf(doc(), DEFAULT_SIZES)
    expect(rows.map((r) => [r.track.id, r.y, r.h])).toEqual([
      ['v2', 0, 60],
      ['v1', 60, 60],
      ['a1', 120, 44],
      ['a2', 164, 44],
    ])
  })

  it('moves the tracks below when one is resized, so the pointer finds the right track', () => {
    const sizes = resizeTrack(DEFAULT_SIZES, 'v1', 120)
    const rows = rowsOf(doc(), sizes)
    expect(rows.map((r) => [r.track.id, r.y, r.h])).toEqual([
      ['v2', 0, 60],
      ['v1', 60, 120],
      ['a1', 180, 44],
      ['a2', 224, 44],
    ])
    // dropping or moving a clip at y = 150 lands on v1 now (it was a1 before)
    expect(rowAtY(rows, 150)?.track.id).toBe('v1')
    expect(rowAtY(rowsOf(doc(), DEFAULT_SIZES), 150)?.track.id).toBe('a1')
    expect(rowAtY(rows, 268)).toBeNull()
  })

  it('keeps every track between the smallest usable height and the largest', () => {
    expect(rowsOf(doc(), resizeTrack(DEFAULT_SIZES, 'a1', 3))[2]!.h).toBe(MIN_TRACK_H)
    expect(rowsOf(doc(), resizeTrack(DEFAULT_SIZES, 'a1', 5000))[2]!.h).toBe(MAX_TRACK_H)
    expect(sizeAll(DEFAULT_SIZES, 0.01).all).toEqual({ visual: MIN_TRACK_H, audio: MIN_TRACK_H })
  })

  it('sets every track at once from a preset, or scales them, dropping sizes of their own', () => {
    const one = resizeTrack(DEFAULT_SIZES, 'v2', 150)
    const large = sizeAll(one, 'large')
    expect(large).toEqual({ all: SIZE_PRESETS.large, tracks: {} })
    expect(currentPreset(large)).toBe('large')
    expect(currentPreset(one)).toBeNull()
    expect(sizeAll(DEFAULT_SIZES, 1.5).all).toEqual({ visual: 90, audio: 66 })
    expect(currentPreset(sizeAll(DEFAULT_SIZES, 1.5))).toBeNull()
  })

  it('resets one track to the size of all tracks, and forgets tracks that are gone', () => {
    const sized = resizeTrack(resizeTrack(DEFAULT_SIZES, 'v2', 150), 'old', 90)
    expect(resetTrack(sized, 'v2').tracks).toEqual({ old: 90 })
    expect(resizeTrack(sized, 'v1', 80, ['v1', 'v2', 'a1']).tracks).toEqual({ v2: 150, v1: 80 })
  })

  it('reads whatever was stored without breaking the timeline', () => {
    expect(readSizes(null)).toEqual(DEFAULT_SIZES)
    expect(readSizes('large')).toEqual(DEFAULT_SIZES)
    expect(
      readSizes({ all: { visual: 'x', audio: 1 }, tracks: { v1: 70.4, v2: 'big', a1: Number.NaN } }),
    ).toEqual({
      all: { visual: DEFAULT_SIZES.all.visual, audio: MIN_TRACK_H },
      tracks: { v1: 70 },
    })
  })

  it('draws clips smaller in a small track: less padding, and one centred line', () => {
    expect(clipLayout(60)).toEqual({ pad: 4, inner: 52, compact: false })
    expect(clipLayout(MIN_TRACK_H)).toEqual({ pad: 2, inner: MIN_TRACK_H - 4, compact: true })
    expect(clipLayout(SIZE_PRESETS.small.visual).compact).toBe(true)
    expect(clipLayout(SIZE_PRESETS.large.visual)).toEqual({ pad: 4, inner: 96, compact: false })
  })
})
