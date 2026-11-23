import { describe, expect, it } from 'vitest'
import { depthMapFor, depthMismatch, depthNameCandidates, depthNameKey } from './depth.ts'
import type { MediaFormat } from './media.ts'

const fmt = (p: Partial<MediaFormat>): MediaFormat =>
  ({
    key: 'main',
    version: '',
    kind: 'image',
    width: 1920,
    height: 1080,
    duration: null,
    processing: { state: 'ready', progress: 1, error: null },
    ...p,
  }) as MediaFormat

describe('depth map names', () => {
  it('tries the whole name first, then without the words depth tools add', () => {
    expect(depthNameCandidates('IMG_0412_depth_16bit.png')).toEqual([
      'img_0412_depth_16bit',
      'img_0412_depth',
      'img_0412',
    ])
    expect(depthNameCandidates('clip_vis.mp4')).toEqual(['clip_vis', 'clip'])
    expect(depthNameCandidates('Trullo-pred.png')).toEqual(['trullo-pred', 'trullo'])
    expect(depthNameCandidates('scene.depth.exr')).toEqual(['scene.depth', 'scene'])
  })
  it('strips words at the start too', () => {
    expect(depthNameCandidates('depth_IMG_0412.png')).toEqual(['depth_img_0412', 'img_0412'])
    expect(depthNameCandidates('disp-trullo_depth.png')).toEqual([
      'disp-trullo_depth',
      'disp-trullo',
      'trullo',
    ])
  })
  it('keeps names without markers as they are', () => {
    expect(depthNameCandidates('folder/IMG_0412.png')).toEqual(['img_0412'])
    expect(depthNameCandidates('depth.png')).toEqual(['depth'])
  })
  it('keys a format by its file name without the extension', () => {
    expect(depthNameKey('IMG_0412.JPG')).toBe('img_0412')
    expect(depthNameKey('Villa.final.mov')).toBe('villa.final')
  })
})

describe('depthMapFor', () => {
  const main = fmt({ key: 'main' })
  const vertical = fmt({ key: 'vertical', width: 1080, height: 1920 })
  const depth = fmt({ key: 'main', width: 960, height: 540 })
  const m = { formats: [main, vertical], depthMaps: [depth] }

  it('finds the format’s own depth map', () => {
    expect(depthMapFor(m, main)).toEqual({ map: depth, inherited: false })
    expect(depthMapFor(m, vertical)).toBeNull()
  })
  it('lends the main version’s map to another version of the same size', () => {
    const english = fmt({ key: 'main', version: 'english' })
    expect(depthMapFor(m, english)).toEqual({ map: depth, inherited: true })
    expect(depthMapFor(m, { ...english, width: 1280, height: 720 })).toBeNull()
  })
  it('prefers a version’s own map', () => {
    const own = fmt({ key: 'main', version: 'english' })
    const english = fmt({ key: 'main', version: 'english' })
    expect(depthMapFor({ ...m, depthMaps: [depth, own] }, english)).toEqual({ map: own, inherited: false })
  })
  it('does not lend a video map to a version of another length', () => {
    const v = fmt({ kind: 'video', duration: 10 })
    const d = fmt({ kind: 'video', duration: 10 })
    const mv = { formats: [v], depthMaps: [d] }
    expect(depthMapFor(mv, fmt({ kind: 'video', version: 'cut', duration: 10.05 }))?.inherited).toBe(true)
    expect(depthMapFor(mv, fmt({ kind: 'video', version: 'cut', duration: 8 }))).toBeNull()
  })
})

describe('depthMismatch', () => {
  it('accepts a smaller map of the same shape', () => {
    expect(depthMismatch(fmt({}), fmt({ width: 518, height: 291 }))).toBeNull()
  })
  it('flags another shape or length', () => {
    expect(depthMismatch(fmt({}), fmt({ width: 1080, height: 1920 }))?.kind).toBe('shape')
    expect(
      depthMismatch(fmt({ kind: 'video', duration: 12 }), fmt({ kind: 'video', duration: 9 }))?.kind,
    ).toBe('length')
  })
  it('waits for the map to be read', () => {
    expect(
      depthMismatch(
        fmt({}),
        fmt({ width: 10, height: 90, processing: { state: 'processing', progress: 0, error: null } }),
      ),
    ).toBeNull()
  })
})
