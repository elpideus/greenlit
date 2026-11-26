import { describe, expect, it } from 'vitest'
import { checkTarget } from './check.ts'
import { PostsService } from './service.ts'

const page = (n: number) => ({
  mediaId: `m${n}`,
  kind: 'image' as const,
  formats: [{ key: 'vertical', width: 1080, height: 1920, duration: null }],
  versions: [],
})
const post = (pages: number) => ({
  caption: 'Una villa con trullo',
  title: '',
  hashtags: [],
  media: Array.from({ length: pages }, (_, i) => page(i)) as never,
})
const target = (platform: 'instagram' | 'facebook', placement: 'story' | 'feed') => ({
  platform,
  placement,
  caption: null,
  title: null,
  hashtags: null,
  formats: {},
  versions: {},
})
const connected = { state: 'connected', capabilities: { publish: true } } as never

describe('what a platform will say about a version', () => {
  it('a story takes one picture or one video: a photo set is refused before its time', () => {
    for (const platform of ['instagram', 'facebook'] as const) {
      const issues = checkTarget(post(6), target(platform, 'story'), connected)
      expect(issues.filter((i) => i.level === 'error').map((i) => i.code)).toEqual(['carousel.unsupported'])
      expect(issues.find((i) => i.code === 'carousel.unsupported')?.message).toMatch(
        /Story takes one item, not 6/,
      )
    }
    expect(
      checkTarget(post(1), target('instagram', 'story'), connected).filter((i) => i.level === 'error'),
    ).toEqual([])
  })

  it('the same photo set is a carousel in the feed', () => {
    expect(
      checkTarget(post(6), target('instagram', 'feed'), connected).filter((i) => i.level === 'error'),
    ).toEqual([])
  })

  it('an account turned off or read-only is said first', () => {
    expect(
      checkTarget(post(1), target('instagram', 'story'), {
        state: 'disabled',
        capabilities: { publish: true },
      } as never).map((i) => i.code),
    ).toEqual(['account_off'])
    expect(
      checkTarget(post(1), target('instagram', 'story'), {
        state: 'connected',
        capabilities: { publish: false },
      } as never).map((i) => i.code),
    ).toEqual(['account_read_only'])
  })
})

describe('a version turned off', () => {
  it('is a draft again when it failed or waits in Greenlit, its error gone', () => {
    expect(PostsService.turnedOffState({ state: 'failed' }, false)).toEqual({ state: 'draft', error: null })
    expect(PostsService.turnedOffState({ state: 'queued' }, false)).toEqual({ state: 'draft', error: null })
  })

  it('keeps what is on the platform, and nothing changes while it is on', () => {
    for (const state of ['scheduled', 'published', 'draft', 'preparing', 'uploading'])
      expect(PostsService.turnedOffState({ state }, false)).toEqual({})
    expect(PostsService.turnedOffState({ state: 'failed' }, true)).toEqual({})
    expect(PostsService.turnedOffState({ state: 'queued' }, true)).toEqual({})
  })
})
