import type { Locator } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { firstVisible } from './util.ts'

/** A stand-in for a Playwright locator whose matches are visible or hidden. */
const fake = (name: string, visible: boolean[]): Locator => {
  const at = (i: number) => ({ name: `${name}#${i}`, isVisible: async () => visible[i] ?? false })
  return {
    count: async () => visible.length,
    first: () => at(0),
    nth: (i: number) => at(i),
  } as unknown as Locator
}
const nameOf = (l: Locator | null) => (l as unknown as { name: string } | null)?.name ?? null

describe('firstVisible', () => {
  it('takes the first visible match of the first candidate that has one', async () => {
    expect(nameOf(await firstVisible([fake('a', [true]), fake('b', [true])], 300))).toBe('a#0')
    expect(nameOf(await firstVisible([fake('a', []), fake('b', [false, true])], 300))).toBe('b#1')
  })
  it('looks past hidden copies (TikTok’s cover editor left in the page)', async () => {
    expect(nameOf(await firstVisible([fake('save', [false, false, true])], 300))).toBe('save#2')
  })
  it('gives up when nothing shows', async () => {
    expect(await firstVisible([fake('a', [false]), fake('b', [])], 300)).toBeNull()
  })
})
