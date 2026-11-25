import { describe, expect, it } from 'vitest'
import { googleFontUrls } from './fonts.ts'

describe('a Google font of an edit', () => {
  it('asks for the styles the edit uses, sorted, then for the family alone', () => {
    expect(googleFontUrls('Cinzel', ['700'])).toEqual([
      'https://fonts.googleapis.com/css2?family=Cinzel:ital,wght@0,700&display=block',
      'https://fonts.googleapis.com/css2?family=Cinzel&display=block',
    ])
    expect(googleFontUrls('Playfair Display', ['italic 400', '700', '400', '700'])[0]).toBe(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=block',
    )
  })

  it('never asks for weights or italics the edit doesn’t use', () => {
    for (const url of googleFontUrls('Cinzel', ['700', 'italic 500'])) {
      expect(url).not.toContain('100..900')
      expect(url).not.toContain('1,700')
    }
  })

  it('asks for the family alone when no text uses it yet', () => {
    expect(googleFontUrls('Cinzel')).toEqual([
      'https://fonts.googleapis.com/css2?family=Cinzel&display=block',
    ])
  })
})
