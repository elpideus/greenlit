import { describe, expect, it } from 'vitest'
import {
  applyOps,
  Composition,
  clipState,
  emptyComposition,
  FORMAT_SIZES,
  forFormat,
  OpError,
  describe as outline,
  sample,
  visibleClips,
} from './index.ts'

const base = () =>
  applyOps(emptyComposition([{ ...FORMAT_SIZES.landscape }, { ...FORMAT_SIZES.vertical }], 30, 10), [
    {
      op: 'add_asset',
      asset: {
        id: 'm1',
        mediaId: '00000000-0000-0000-0000-000000000001',
        kind: 'video',
        name: 'Clip',
        duration: 20,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    },
    {
      op: 'add_clip',
      trackId: 'v1',
      clip: { id: 'vid', type: 'video', assetId: 'm1', start: 0, duration: 8, in: 2 },
    },
    {
      op: 'add_clip',
      clip: { id: 'txt', type: 'text', start: 1, duration: 3, text: { content: 'Hello', fontSize: 80 } },
    },
  ])

describe('ops', () => {
  it('adds clips, creating a top track when none is given', () => {
    const c = base()
    expect(c.tracks.map((t) => t.kind)).toEqual(['visual', 'visual', 'audio'])
    expect(c.tracks[1]!.clips[0]!.id).toBe('txt')
  })

  it('rejects clips that use an unknown asset, and leaves the input untouched', () => {
    const c = base()
    expect(() =>
      applyOps(c, [{ op: 'add_clip', clip: { type: 'video', assetId: 'nope', start: 0, duration: 1 } }]),
    ).toThrow(OpError)
    expect(c.tracks[0]!.clips).toHaveLength(1)
  })

  it('splits a clip and shifts the source in-point and keyframes of the second half', () => {
    let c = base()
    c = applyOps(c, [
      {
        op: 'set_keyframes',
        id: 'vid',
        prop: 'transform.opacity',
        keyframes: [
          { t: 0, value: 0 },
          { t: 6, value: 1 },
        ],
      },
    ])
    c = applyOps(c, [{ op: 'split_clip', id: 'vid', at: 3, newId: 'vid2' }])
    const [a, b] = c.tracks[0]!.clips
    expect(a!.duration).toBe(3)
    expect(b!.start).toBe(3)
    expect(b!.in).toBe(5)
    expect(b!.keyframes['transform.opacity']!.map((k) => k.t)).toEqual([3])
  })

  it('deep-merges updates and deletes keys with null', () => {
    let c = base()
    c = applyOps(c, [
      {
        op: 'update_clip',
        id: 'txt',
        patch: { text: { color: '#ff0000' }, transitionIn: { type: 'fade', duration: 0.5 } },
      },
    ])
    expect(c.tracks[1]!.clips[0]!.text?.content).toBe('Hello')
    expect(c.tracks[1]!.clips[0]!.text?.color).toBe('#ff0000')
    c = applyOps(c, [{ op: 'update_clip', id: 'txt', patch: { transitionIn: null } }])
    expect(c.tracks[1]!.clips[0]!.transitionIn).toBeUndefined()
  })

  it('extends the duration when a clip goes past the end', () => {
    const c = applyOps(base(), [{ op: 'move_clip', id: 'vid', start: 5 }])
    expect(c.duration).toBe(13)
  })

  it('round-trips through the schema and describes itself', () => {
    const c = base()
    expect(Composition.parse(JSON.parse(JSON.stringify(c)))).toEqual(c)
    expect(outline(c)).toContain('txt text "Hello" @1s for 3s')
  })
})

describe('evaluation', () => {
  it('interpolates keyframes with easing and holds outside the range', () => {
    const keys = [
      { t: 0, value: 0, easing: 'linear' as const },
      { t: 2, value: 100 },
    ]
    expect(sample(keys, -1)).toBe(0)
    expect(sample(keys, 1)).toBe(50)
    expect(sample(keys, 5)).toBe(100)
  })

  it('mixes colours', () => {
    expect(
      sample(
        [
          { t: 0, value: '#000000', easing: 'linear' },
          { t: 1, value: '#ffffff' },
        ],
        0.5,
      ),
    ).toBe('rgba(128, 128, 128, 1)')
  })

  it('maps composition time to source time with in-point and speed', () => {
    const c = applyOps(base(), [{ op: 'update_clip', id: 'vid', patch: { speed: 2 } }])
    const s = clipState(c.tracks[0]!.clips[0]!, 3, c.formats[0]!)
    expect(s.mediaTime).toBe(8)
  })

  it('fills the frame when a media clip has no size', () => {
    const c = base()
    const s = clipState(c.tracks[0]!.clips[0]!, 1, c.formats[1]!)
    expect([s.width, s.height]).toEqual([1080, 1920])
  })

  it('applies fade transitions', () => {
    const c = applyOps(base(), [
      {
        op: 'update_clip',
        id: 'txt',
        patch: { transitionIn: { type: 'fade', duration: 1, easing: 'linear' } },
      },
    ])
    const s = clipState(c.tracks[1]!.clips[0]!, 1.5, c.formats[0]!)
    expect(s.opacity).toBeCloseTo(0.5, 2)
  })

  it('only shows clips active at a time, bottom first', () => {
    const c = base()
    expect(visibleClips(c, 0.5, c.formats[0]!).map((s) => s.clip.id)).toEqual(['vid'])
    expect(visibleClips(c, 2, c.formats[0]!).map((s) => s.clip.id)).toEqual(['vid', 'txt'])
  })
})

describe('format overrides', () => {
  it('change only what they name', () => {
    const c = applyOps(base(), [
      {
        op: 'update_clip',
        id: 'txt',
        patch: { formats: { vertical: { text: { fontSize: 120 }, transform: { y: 900 } } } },
      },
    ])
    const clip = c.tracks[1]!.clips[0]!
    expect(clip.formats.vertical).toEqual({ text: { fontSize: 120 }, transform: { y: 900 } })
    const v = forFormat(clip, 'vertical')
    expect(v.text?.content).toBe('Hello')
    expect(v.text?.fontSize).toBe(120)
    expect(v.transform.y).toBe(900)
    expect(forFormat(clip, 'main').text?.fontSize).toBe(80)
  })

  it('animate the framing of one format', () => {
    const c = applyOps(base(), [
      {
        op: 'update_clip',
        id: 'vid',
        patch: {
          formats: {
            vertical: {
              keyframes: {
                focusX: [
                  { t: 0, value: 0.2, easing: 'linear' },
                  { t: 4, value: 0.6 },
                ],
              },
            },
          },
        },
      },
    ])
    const clip = c.tracks[0]!.clips[0]!
    expect(clipState(clip, 2, c.formats[1]!).values.focusX).toBeCloseTo(0.4)
    expect(clipState(clip, 2, c.formats[0]!).values.focusX).toBeUndefined()
  })
})
