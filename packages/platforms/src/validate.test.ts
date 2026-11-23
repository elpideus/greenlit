import { describe, expect, it } from 'vitest'
import { getPlacement, validateForPlacement, worstLevel } from './index.ts'

const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

describe('validateForPlacement', () => {
  it('takes one picture as a plain post, not a short carousel', () => {
    for (const id of ['facebook.feed', 'instagram.feed'])
      expect(codes(validateForPlacement(getPlacement(id), null, { items: 1 }))).not.toContain(
        'carousel.tooFew',
      )
    expect(codes(validateForPlacement(getPlacement('facebook.feed'), null, { items: 11 }))).toContain(
      'carousel.tooMany',
    )
  })

  it('passes a clean vertical reel', () => {
    const issues = validateForPlacement(
      getPlacement('instagram.reel'),
      { width: 1080, height: 1920, fps: 30, durationSec: 20, hasAudio: true },
      { caption: 'Trullo restaurato a Ostuni #puglia #trullo' },
    )
    expect(issues).toEqual([])
    expect(worstLevel(issues)).toBeNull()
  })

  it('flags caption length, hashtags and mentions', () => {
    const long = 'a'.repeat(2201)
    const issues = validateForPlacement(getPlacement('instagram.feed'), null, {
      caption: `${long} #one #two #three @a @b`,
      hashtags: ['four', '#five', 'six', 'one'],
    })
    expect(codes(issues)).toContain('caption.tooLong')
    const tags = issues.find((i) => i.code === 'hashtags.tooMany')!
    expect(tags.params).toMatchObject({ count: 6, max: 5 })
    expect(tags.level).toBe('warning') // the API still documents 30
  })

  it('counts TikTok captions in UTF-16 units', () => {
    const emoji = '😀'.repeat(1101) // 2202 UTF-16 units, 1101 characters
    expect(codes(validateForPlacement(getPlacement('tiktok.video'), null, { caption: emoji }))).toContain(
      'caption.tooLong',
    )
    expect(
      codes(validateForPlacement(getPlacement('instagram.reel'), null, { caption: emoji })),
    ).not.toContain('caption.tooLong')
  })

  it('checks YouTube title, description bytes, forbidden characters, tags and hashtags', () => {
    const yt = getPlacement('youtube.video')
    expect(codes(validateForPlacement(yt, null, { description: 'x' }))).toContain('title.missing')
    const issues = validateForPlacement(yt, null, {
      title: `${'T'.repeat(99)} <b>`,
      description: 'è'.repeat(2501), // 5002 bytes
      tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`),
      hashtags: Array.from({ length: 61 }, (_, i) => `h${i}`),
    })
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'title.tooLong',
        'title.forbiddenChars',
        'description.tooLong',
        'tags.tooLong',
        'hashtags.allIgnored',
      ]),
    )
    expect(issues.find((i) => i.code === 'description.tooLong')!.params.unit).toBe('bytes')
  })

  it('warns about shape, duration, frame rate and size', () => {
    const issues = validateForPlacement(getPlacement('youtube.short'), {
      width: 1920,
      height: 1080,
      fps: 120,
      durationSec: 200,
      hasAudio: true,
    })
    expect(codes(issues)).toEqual(
      expect.arrayContaining(['aspect.outOfRange', 'duration.tooLong', 'fps.reduced']),
    )
    expect(worstLevel(issues)).toBe('error')
    const soft = validateForPlacement(getPlacement('instagram.reel'), {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec: 240,
      hasAudio: true,
    })
    expect(codes(soft)).toEqual(['duration.overSoftMax'])
    const small = validateForPlacement(getPlacement('facebook.reel'), {
      width: 360,
      height: 640,
      fps: 30,
      durationSec: 10,
      hasAudio: true,
    })
    expect(codes(small)).toContain('resolution.belowMin')
    const tooShort = validateForPlacement(getPlacement('facebook.story'), {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec: 1,
      hasAudio: true,
    })
    expect(codes(tooShort)).toContain('duration.tooShort')
  })

  it('knows what a placement takes', () => {
    expect(
      codes(
        validateForPlacement(getPlacement('instagram.reel'), { kind: 'image', width: 1080, height: 1920 }),
      ),
    ).toContain('media.kindNotAccepted')
    expect(
      codes(validateForPlacement(getPlacement('instagram.story'), null, { caption: 'hello' })),
    ).toContain('caption.notPublished')
    expect(codes(validateForPlacement(getPlacement('youtube.post'), null))).toContain('api.unsupported')
    expect(codes(validateForPlacement(getPlacement('instagram.feed'), null, { items: 21 }))).toContain(
      'carousel.tooMany',
    )
    expect(
      codes(validateForPlacement(getPlacement('youtube.video'), null, { title: 'x', items: 2 })),
    ).toContain('carousel.unsupported')
  })

  it('notes HDR conversion and the silent track', () => {
    const issues = validateForPlacement(getPlacement('instagram.reel'), {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec: 10,
      hdr: 'hlg',
    })
    expect(codes(issues)).toEqual(expect.arrayContaining(['hdr.tonemapped', 'audio.silentAdded']))
    expect(
      codes(
        validateForPlacement(
          getPlacement('youtube.video'),
          { width: 3840, height: 2160, fps: 30, durationSec: 10, hdr: 'pq' },
          { title: 'x' },
        ),
      ),
    ).not.toContain('hdr.tonemapped')
  })
})
