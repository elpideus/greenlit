import { describe, expect, it } from 'vitest'
import { coverIndexOf, hasTextToSync, scheduleQuestion, thumbnailAtOf, timeToWaitFor } from './publish.ts'
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
