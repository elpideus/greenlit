import { platformKeepsSchedule } from '@greenlit/shared/areas/connectors'
import { describe, expect, it } from 'vitest'
import { facebookApi } from './drivers/facebook-api.ts'
import { instagramApi } from './drivers/instagram-api.ts'
import { tiktokApi } from './drivers/tiktok-api.ts'
import { noCapabilities } from './drivers/types.ts'
import { mergeCapabilities, pickConnector, planMerges, sameJson } from './merge.ts'

const caps = (over: Partial<typeof noCapabilities> = {}) =>
  ({ ...noCapabilities, placements: [], ...over }) as never
let n = 0
const row = (over: Record<string, unknown>) =>
  ({
    id: `r${++n}`,
    platform: 'facebook',
    driver: 'facebook',
    externalId: String(n),
    handle: '',
    platformIds: {},
    state: 'connected',
    capabilities: caps(),
    createdAt: new Date(2026, 10, n),
    mergedInto: null,
    ...over,
  }) as never

describe('merging one account reached through two connectors', () => {
  // As saved for the GEM accounts: facebook.com and Business Suite reach the same Page and Instagram account.
  const bsPage = row({
    driver: 'meta-business-suite',
    externalId: '108477347434387',
    platformIds: { pageId: '108477347434387' },
  })
  const fbPage = row({
    externalId: '100063648724866',
    platformIds: { kind: 'page', actorId: '100063648724866', pageId: '108477347434387' },
  })
  const fbProfile = row({ externalId: '61596705001051', platformIds: { kind: 'profile' } })
  const bsIg = row({
    platform: 'instagram',
    driver: 'meta-business-suite',
    externalId: '17841431498898211',
    handle: '@studio_associato_gem',
    platformIds: {
      igUserId: '17841431498898211',
      pageId: '108477347434387',
      username: 'studio_associato_gem',
    },
  })
  const ig = row({
    platform: 'instagram',
    driver: 'instagram',
    externalId: '31505689963',
    handle: '@studio_associato_gem',
    platformIds: { userId: '31505689963', igUserId: '17841431498898211' },
  })

  it('merges each into the platform’s own connector, and leaves the rest alone', () => {
    const plan = planMerges([bsPage, fbPage, fbProfile, bsIg, ig])
    expect(Object.fromEntries(plan)).toEqual({
      [(bsPage as { id: string }).id]: (fbPage as { id: string }).id,
      [(bsIg as { id: string }).id]: (ig as { id: string }).id,
    })
  })

  it('changes nothing once merged', () => {
    const merged = [
      { ...(bsPage as object), mergedInto: (fbPage as { id: string }).id },
      fbPage,
      fbProfile,
    ] as never[]
    expect(planMerges(merged).size).toBe(0)
  })

  it('unmerges a row whose match is gone', () => {
    const stale = { ...(bsPage as object), mergedInto: 'gone' } as never
    expect([...planMerges([stale, fbProfile])]).toEqual([[(bsPage as { id: string }).id, null]])
  })

  it('does not merge two Pages that only share a name', () => {
    const other = row({ driver: 'meta-business-suite', externalId: '999', platformIds: { pageId: '999' } })
    expect(planMerges([other, fbPage]).size).toBe(0)
  })
})

describe('publishing through the connector that can', () => {
  const main = row({ capabilities: caps({ publish: true, placements: ['feed'], nativeSchedule: true }) })
  const bs = row({
    driver: 'meta-business-suite',
    capabilities: caps({
      placements: ['feed', 'reel', 'story'],
      music: true,
      location: true,
      firstComment: true,
    }),
  })
  const needs = (over: Record<string, unknown> = {}) =>
    ({
      placement: 'feed',
      music: false,
      location: false,
      firstComment: false,
      thumbnail: false,
      translations: false,
      ...over,
    }) as never

  it('keeps to the main connector when it can do it all', () => {
    expect(pickConnector([main, bs], needs())).toBe(main)
  })
  it('fills the main connector’s holes with the other one', () => {
    expect(pickConnector([main, bs], needs({ placement: 'reel' }))).toBe(bs)
    expect(pickConnector([main, bs], needs({ music: true }))).toBe(bs)
  })
  it('passes over a connector that is off or signed out', () => {
    const off = { ...(bs as object), state: 'disabled' } as never
    expect(pickConnector([main, off], needs({ placement: 'reel' }))).toBeNull()
    const out = { ...(main as object), state: 'needs_login' } as never
    expect(pickConnector([out, bs], needs())).toBe(bs)
  })
  it('shows what any of them can do, counting only connectors that publish', () => {
    const readOnly = row({
      capabilities: caps({ publish: false, placements: ['feed', 'reel'], sync: true, music: true }),
    })
    const c = mergeCapabilities([main, readOnly])!
    expect(c.publish).toBe(true)
    expect(c.placements).toEqual(['feed'])
    expect(c.music).toBe(false)
    expect(c.sync).toBe(true)
    expect(mergeCapabilities([main, bs])!.placements.sort()).toEqual(['feed', 'reel', 'story'])
  })
})

describe('keeping a post’s time', () => {
  const now = new Date('2026-11-22T12:00:00Z').getTime()
  const inMinutes = (m: number) => new Date(now + m * 60_000)
  const keeps = (c: Parameters<typeof platformKeepsSchedule>[0], placement: string, m: number) =>
    platformKeepsSchedule(c, placement, inMinutes(m), now)
  const fbPage = facebookApi.capabilities('facebook', { platformIds: { kind: 'page' } } as never)

  it('leaves to Greenlit what the platform does not schedule', () => {
    expect(keeps(noCapabilities, 'feed', 60)).toBe(false)
    expect(keeps(instagramApi.capabilities('instagram'), 'feed', 60)).toBe(false)
    expect(keeps(instagramApi.capabilities('instagram'), 'reel', 60)).toBe(false)
    // A Page's posts are scheduled on Facebook; its reels wait in Greenlit.
    expect(keeps(fbPage, 'feed', 60)).toBe(true)
    expect(keeps(fbPage, 'reel', 60)).toBe(false)
  })

  it('leaves to Greenlit a time too soon or too far for the platform', () => {
    expect(keeps(fbPage, 'feed', 5)).toBe(false)
    expect(keeps(fbPage, 'feed', 30 * 24 * 60)).toBe(true)
    const tiktok = tiktokApi.capabilities('tiktok')
    expect(keeps(tiktok, 'video', 10)).toBe(false)
    expect(keeps(tiktok, 'video', 60)).toBe(true)
    expect(keeps(tiktok, 'video', 10 * 24 * 60 - 1)).toBe(true)
    expect(keeps(tiktok, 'video', 11 * 24 * 60)).toBe(false)
  })

  it('shows on a merged account what the connector that publishes keeps', () => {
    // Facebook's own requests publish a Page's posts, reels and stories; Business Suite adds nothing to schedule.
    const fb = row({ capabilities: fbPage })
    const bs = row({
      driver: 'meta-business-suite',
      capabilities: caps({ placements: ['feed', 'reel', 'story'], nativeSchedule: true }),
    })
    const c = mergeCapabilities([fb, bs])!
    expect(c.nativeSchedule).toBe(true)
    expect(c.scheduleOn).toEqual(['feed'])
    expect(c.scheduleWindow).toEqual({ minMinutes: 10 })
    expect(keeps(c, 'reel', 60)).toBe(false)
    // Instagram's own requests publish everything and schedule nothing.
    const ig = row({ platform: 'instagram', capabilities: instagramApi.capabilities('instagram') })
    const bsIg = row({
      platform: 'instagram',
      driver: 'meta-business-suite',
      capabilities: caps({ placements: ['feed', 'reel', 'story'], nativeSchedule: true }),
    })
    const i = mergeCapabilities([ig, bsIg])!
    expect(i.nativeSchedule).toBe(false)
    expect(keeps(i, 'feed', 60)).toBe(false)
    // One connector that schedules every placement: no list.
    expect(mergeCapabilities([bs])!.scheduleOn).toBeUndefined()
  })
})

describe('capabilities saved in the database', () => {
  it('match whatever order the database keeps their keys in', () => {
    const saved = { placements: ['feed'], scheduleWindow: { minMinutes: 10 }, nativeSchedule: true }
    expect(
      sameJson(saved, { nativeSchedule: true, scheduleWindow: { minMinutes: 10 }, placements: ['feed'] }),
    ).toBe(true)
    expect(sameJson(saved, { ...saved, scheduleOn: ['feed'] })).toBe(false)
    expect(sameJson(saved, { ...saved, placements: ['reel'] })).toBe(false)
  })
})
