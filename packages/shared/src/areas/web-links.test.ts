import { describe, expect, it } from 'vitest'
import { cleanWebLinks, normalizeWebUrl, webLinkAddress, webLinkLabel, webLinkPlatform } from './web-links.ts'

describe('normalizeWebUrl', () => {
  it('keeps http and https addresses', () => {
    expect(normalizeWebUrl('https://example.it/immobili')).toBe('https://example.it/immobili')
    expect(normalizeWebUrl('  http://example.com  ')).toBe('http://example.com/')
    expect(normalizeWebUrl('HTTPS://Example.com/A?b=1#c')).toBe('https://example.com/A?b=1#c')
  })
  it('adds https:// to a bare address', () => {
    expect(normalizeWebUrl('example.it/immobili')).toBe('https://example.it/immobili')
    expect(normalizeWebUrl('www.youtube.com/watch?v=abc')).toBe('https://www.youtube.com/watch?v=abc')
    expect(normalizeWebUrl('//example.com/x')).toBe('https://example.com/x')
  })
  it('refuses what is not a web address', () => {
    for (const bad of [
      '',
      '   ',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
      'ftp://example.com',
      'mailto:someone@example.com',
      'hello',
      'two words.com',
      'https://',
    ])
      expect(normalizeWebUrl(bad), bad).toBeNull()
  })
})

describe('cleanWebLinks', () => {
  it('normalises, trims and drops repeats and junk', () => {
    expect(
      cleanWebLinks([
        { url: 'example.com', title: '  Example   site ' },
        { url: 'https://example.com/', title: 'Again' },
        { url: 'javascript:alert(1)', title: 'Bad' },
        { url: 'https://youtu.be/xyz' },
      ]),
    ).toEqual([
      { url: 'https://example.com/', title: 'Example site' },
      { url: 'https://youtu.be/xyz', title: '' },
    ])
  })
})

describe('labels and platforms', () => {
  it('shows the title, else a short address', () => {
    expect(webLinkLabel({ url: 'https://www.example.com/a/b/', title: '' })).toBe('example.com/a/b')
    expect(webLinkLabel({ url: 'https://example.com/', title: 'Home' })).toBe('Home')
    expect(webLinkAddress('https://example.com/')).toBe('example.com')
  })
  it('knows the social platforms', () => {
    expect(webLinkPlatform('https://www.youtube.com/watch?v=1')).toBe('youtube')
    expect(webLinkPlatform('https://youtu.be/1')).toBe('youtube')
    expect(webLinkPlatform('https://m.facebook.com/reel/1')).toBe('facebook')
    expect(webLinkPlatform('https://www.instagram.com/p/1')).toBe('instagram')
    expect(webLinkPlatform('https://vm.tiktok.com/1')).toBe('tiktok')
    expect(webLinkPlatform('https://notyoutube.com/x')).toBeNull()
    expect(webLinkPlatform('https://example.it')).toBeNull()
  })
})
