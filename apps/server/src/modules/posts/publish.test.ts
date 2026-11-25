import { postThumbnail } from '@greenlit/shared'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  bestMatch,
  coverIndexOf,
  coverSources,
  dhash,
  hasTextToSync,
  scheduleQuestion,
  thumbnailAtOf,
  timeToWaitFor,
} from './publish.ts'
import { PostsService } from './service.ts'

describe('a version with a time', () => {
  const now = new Date('2026-11-22T12:00:00Z').getTime()

  it('waits only for a time still to come', () => {
    expect(timeToWaitFor(null, now)).toBeNull()
    expect(timeToWaitFor(new Date(now - 60_000), now)).toBeNull()
    // A minute away or less goes now.
    expect(timeToWaitFor(new Date(now + 30_000), now)).toBeNull()
    expect(timeToWaitFor('2026-11-22T13:00:00Z', now)?.toISOString()).toBe('2026-11-22T13:00:00.000Z')
  })

  it('asks the connectors about what the version carries', () => {
    const q = scheduleQuestion(
      {
        accountId: 'a1',
        placement: 'reel',
        music: { trackId: 't1', title: 'Song' },
        location: null,
        firstComment: null,
        thumbnail: { mode: 'frame', atSeconds: 2 },
        translations: { it: { title: 'Titolo', caption: 'Testo' } },
      },
      { en: { title: 'Title', caption: 'Text' } },
    )
    expect(q).toEqual({
      accountId: 'a1',
      placement: 'reel',
      music: { trackId: 't1', title: 'Song' },
      location: null,
      firstComment: '',
      thumbnailPath: 'cover',
      translations: { en: { title: 'Title', caption: 'Text' }, it: { title: 'Titolo', caption: 'Testo' } },
    })
    const auto = scheduleQuestion(
      {
        accountId: 'a1',
        placement: 'feed',
        music: null,
        location: null,
        firstComment: 'hi',
        thumbnail: { mode: 'auto' },
        translations: {},
      },
      null,
    )
    expect(auto.thumbnailPath).toBeNull()
    expect(auto.firstComment).toBe('hi')
    expect(auto.translations).toEqual({})
  })
})

describe('a post’s status', () => {
  const now = new Date('2026-11-22T12:00:00Z').getTime()
  const v = (state: string, scheduleAt: string | null = null) =>
    ({ enabled: true, state, scheduleAt }) as never
  const later = '2026-11-22T14:00:00Z'

  it('is scheduled while Greenlit holds a version for its time', () => {
    expect(PostsService.statusOf([v('queued', later)], now)).toBe('scheduled')
    expect(PostsService.statusOf([v('queued', later), v('scheduled', later)], now)).toBe('scheduled')
    expect(PostsService.statusOf([v('queued', later), v('published')], now)).toBe('scheduled')
  })
  it('is publishing once that time comes', () => {
    expect(PostsService.statusOf([v('queued', '2026-11-22T11:59:00Z')], now)).toBe('publishing')
    expect(PostsService.statusOf([v('queued', later), v('uploading')], now)).toBe('publishing')
  })
})

describe('a version’s cover', () => {
  it('is a frame time only when the cover is a frame of the video', () => {
    expect(thumbnailAtOf({ thumbnail: { mode: 'frame', time: 6.5 } })).toBe(6.5)
    expect(thumbnailAtOf({ thumbnail: { mode: 'frame', time: 0 } })).toBe(0)
    expect(thumbnailAtOf({ thumbnail: { mode: 'auto' } })).toBeNull()
    expect(thumbnailAtOf({ thumbnail: { mode: 'media', mediaId: 'x' } })).toBeNull()
    expect(thumbnailAtOf({ thumbnail: null })).toBeNull()
  })
})

describe('bringing a version on a platform up to date', () => {
  it('skips a story’s text, which no platform shows, but keeps its time while scheduled there', () => {
    expect(hasTextToSync({ placement: 'feed', state: 'published' })).toBe(true)
    expect(hasTextToSync({ placement: 'reel', state: 'scheduled' })).toBe(true)
    expect(hasTextToSync({ placement: 'story', state: 'published' })).toBe(false)
    expect(hasTextToSync({ placement: 'story', state: 'scheduled' })).toBe(true)
  })
})

describe('a photo post’s cover', () => {
  it('is the place of the chosen picture among the post’s own, when it is one of them', () => {
    expect(coverIndexOf({ mode: 'media', mediaId: 'b' }, ['a', 'b', 'c'])).toBe(1)
    expect(coverIndexOf({ mode: 'media', mediaId: 'z' }, ['a', 'b'])).toBeNull()
    expect(coverIndexOf({ mode: 'frame', time: 2 }, ['a', 'b'])).toBeNull()
    expect(coverIndexOf({ mode: 'auto' }, ['a'])).toBeNull()
  })
})

describe('a post found on a channel that is turned off', () => {
  const off = new Set(['viral'])
  it('is not listed when every account it is on is turned off', () => {
    const found = (...accounts: string[]) => ({
      origin: 'platform',
      targets: accounts.map((accountId) => ({ accountId })),
    })
    expect(PostsService.hiddenBy(off, found('viral'))).toBe(true)
    expect(PostsService.hiddenBy(off, found('viral', 'acme'))).toBe(false)
    expect(PostsService.hiddenBy(off, found('acme'))).toBe(false)
    expect(PostsService.hiddenBy(off, found())).toBe(false)
  })
  it('is still listed when it was made in Greenlit', () => {
    expect(PostsService.hiddenBy(off, { origin: 'greenlit', targets: [{ accountId: 'viral' }] })).toBe(false)
  })
})

describe('the cover a platform shows', () => {
  it('is linked only once Greenlit keeps a copy', () => {
    expect(PostsService.coverUrlOf({ id: 't', postId: 'p', remoteCover: 'abc123' })).toBe(
      '/api/posts/p/targets/t/cover?v=abc123',
    )
    expect(PostsService.coverUrlOf({ id: 't', postId: 'p', remoteCover: '' })).toBeNull()
    expect(PostsService.coverUrlOf({ id: 't', postId: 'p', remoteCover: null })).toBeNull()
  })
})

describe('the library item a platform thumbnail shows', () => {
  // A frame with some structure: a diagonal light-to-dark gradient with a bright block.
  const frame = async (w: number, h: number) => {
    const px = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x > w * 0.6 && y < h * 0.4 ? 240 : Math.round(30 + (180 * (x + y)) / (w + h))
        px.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3)
      }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer()
  }

  it('is found through the black bars a platform puts around a vertical frame', async () => {
    const poster = await frame(270, 480)
    const thumb = await sharp(poster)
      .resize(480, 360, { fit: 'contain', background: '#000' })
      .jpeg({ quality: 70 })
      .toBuffer()
    const a = await dhash(poster)
    expect(bestMatch(await dhash(thumb), [{ id: 'poster', hash: a }])).toBe('poster')
  })

  it('is only one that is clearly the same picture', () => {
    const t = 0n
    const bits = (n: number) => (1n << BigInt(n)) - 1n
    expect(bestMatch(t, [{ id: 'same', hash: bits(2) }])).toBe('same')
    // 11 bits apart: the cat short and the room photo
    expect(bestMatch(t, [{ id: 'room', hash: bits(11) }])).toBeNull()
    expect(bestMatch(t, [{ id: 'near', hash: bits(7) }])).toBeNull()
    // two logo variants as close as each other: no way to tell which
    expect(
      bestMatch(t, [
        { id: 'logo-black', hash: bits(3) },
        { id: 'logo-white', hash: bits(4) },
      ]),
    ).toBeNull()
    // the same item's other formats do not count as rivals
    expect(
      bestMatch(t, [
        { id: 'film', hash: bits(1) },
        { id: 'film', hash: bits(2) },
        { id: 'other', hash: bits(9) },
      ]),
    ).toBe('film')
  })
})

describe('a post’s picture', () => {
  const media = [{ thumbnailUrl: '/media.webp', formats: [] }] as never
  const targets = [{ coverUrl: '/cover.webp' }] as never
  it('is what the platform shows for a post found there, the library item for one made here', () => {
    expect(postThumbnail({ origin: 'platform', media, targets })).toBe('/cover.webp')
    expect(postThumbnail({ origin: 'greenlit', media, targets })).toBe('/media.webp')
    expect(postThumbnail({ origin: 'greenlit', media: [], targets })).toBe('/cover.webp')
    expect(postThumbnail({ origin: 'platform', media: [], targets: [] })).toBeNull()
  })
})

describe('where a cover is read', () => {
  it('is YouTube’s larger picture of a video first, then what the listing gave', () => {
    expect(coverSources('youtube', 'jLmdBq7uZMA', 'https://i9.ytimg.com/vi/jLmdBq7uZMA/default.jpg')).toEqual(
      ['https://i.ytimg.com/vi/jLmdBq7uZMA/hqdefault.jpg', 'https://i9.ytimg.com/vi/jLmdBq7uZMA/default.jpg'],
    )
    expect(coverSources('youtube', 'jLmdBq7uZMA', null)).toEqual([
      'https://i.ytimg.com/vi/jLmdBq7uZMA/hqdefault.jpg',
    ])
    expect(coverSources('instagram', '4036624653855278652_31505689963', 'https://cdn/x.jpg')).toEqual([
      'https://cdn/x.jpg',
    ])
    expect(coverSources('instagram', '1', null)).toEqual([])
  })
})
