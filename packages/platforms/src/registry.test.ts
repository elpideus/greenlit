import { describe, expect, it } from 'vitest'
import {
  allHashtags,
  composeCaption,
  cutToLength,
  extractHashtags,
  extractMentions,
  getPlacement,
  PlacementKey,
  PlacementSpec,
  pickBestFormat,
  placements,
  platformList,
  textLength,
  truncateForDisplay,
  youtubeTagsLength,
} from './index.ts'

// The package has no Node types (it runs in the browser too), so fs is loaded untyped.
const fsModule = 'node:fs'
const { readFileSync } = (await import(fsModule)) as { readFileSync: (p: URL, enc: 'utf8') => string }
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('registry', () => {
  it('has every placement once, each valid and with documented sources', () => {
    expect(placements.map((p) => p.key).sort()).toEqual([...PlacementKey.options].sort())
    for (const p of placements) {
      expect(() => PlacementSpec.parse(p)).not.toThrow()
      expect(p.key.startsWith(`${p.platform}.`)).toBe(true)
      expect(p.aspect.min).toBeLessThanOrEqual(p.aspect.recommended)
      expect(p.aspect.max).toBeGreaterThanOrEqual(p.aspect.recommended)
      for (const s of p.sources) expect(readme, `README source ${s} for ${p.key}`).toContain(`\`${s}\``)
      for (const k of p.media.kinds)
        if (k !== 'text') expect(p.encode[k], `${p.key} encodes ${k}`).toBeDefined()
      if (p.safeZone) {
        expect(p.safeZone.top + p.safeZone.bottom).toBeLessThan(1)
        expect(p.safeZone.left + p.safeZone.right).toBeLessThan(1)
      }
    }
    expect(platformList.map((p) => p.id)).toEqual(['instagram', 'facebook', 'tiktok', 'youtube'])
  })

  it('holds the figures everyone asks about', () => {
    expect(getPlacement('youtube.video').text.title?.max).toBe(100)
    expect(getPlacement('youtube.video').text.tags?.maxTotal).toBe(500)
    expect(getPlacement('instagram.reel').text.caption?.max).toBe(2200)
    expect(getPlacement('tiktok.photo').carousel?.max).toBe(35)
    expect(getPlacement('youtube.short').duration?.maxSec).toBe(180)
    expect(getPlacement('instagram.reel').safeZone).toMatchObject({ top: 0.14, bottom: 0.35 })
    expect(getPlacement('instagram', 'nope')).toBeUndefined()
  })

  it('picks the best rendition for a placement', () => {
    const formats = [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1350 },
    ]
    expect(pickBestFormat(getPlacement('instagram.reel'), formats)).toBe(1)
    expect(pickBestFormat(getPlacement('youtube.video'), formats)).toBe(0)
    expect(pickBestFormat(getPlacement('instagram.feed'), formats)).toBe(2)
    expect(pickBestFormat(getPlacement('facebook.feed'), formats.slice(0, 2))).toBe(0)
    expect(pickBestFormat(getPlacement('tiktok.video'), [{ width: null, height: null }])).toBe(-1)
  })
})

describe('text helpers', () => {
  it('counts the way platforms do', () => {
    expect(textLength('è😀')).toBe(2)
    expect(textLength('è😀', 'utf16')).toBe(3)
    expect(textLength('è😀', 'bytes')).toBe(6)
    expect(cutToLength('ab😀cd', 3, 'utf16')).toBe('ab')
  })

  it('finds hashtags and mentions', () => {
    expect(extractHashtags('Casa #Ostuni, #puglia_2026 #2026 a#b #trullo!')).toEqual([
      'Ostuni',
      'puglia_2026',
      'trullo',
    ])
    expect(extractMentions('con @studio.acme e mail a@b.it @x_')).toEqual(['studio.acme', 'x_'])
    expect(allHashtags('#Puglia', ['puglia', '#mare'])).toEqual(['Puglia', 'mare'])
    expect(composeCaption('Ciao #mare', ['mare', 'sole'])).toBe('Ciao #mare\n\n#sole')
  })

  it('counts YouTube tags like YouTube', () => {
    expect(youtubeTagsLength(['Foo Baz'])).toBe(9)
    expect(youtubeTagsLength(['Foo-Baz'])).toBe(7)
    expect(youtubeTagsLength(['a', 'b c'])).toBe(1 + 1 + 5)
  })

  it('truncates for display by lines, then characters, at a word', () => {
    const t = truncateForDisplay('one two three four five six seven eight nine ten', {
      chars: 20,
      more: 'more',
    })
    expect(t).toEqual({ visible: 'one two three four', truncated: true })
    expect(truncateForDisplay('a\nb\nc', { lines: 2, more: 'more' })).toEqual({
      visible: 'a\nb',
      truncated: true,
    })
    expect(truncateForDisplay('short', { chars: 125, lines: 2, more: 'more' })).toEqual({
      visible: 'short',
      truncated: false,
    })
  })
})
