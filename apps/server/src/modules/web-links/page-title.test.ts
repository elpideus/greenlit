import { describe, expect, it } from 'vitest'
import { decodeEntities, isPrivateAddress, titleFromHtml } from './page-title.ts'

describe('titleFromHtml', () => {
  it('prefers og:title, then <title>', () => {
    expect(
      titleFromHtml(
        '<html><head><title>Villa | Acme Studio</title><meta property="og:title" content="Villa con piscina"></head>',
      ),
    ).toBe('Villa con piscina')
    expect(titleFromHtml("<head><meta content='Rev' name='twitter:title'><title>T</title>")).toBe('Rev')
    expect(titleFromHtml('<head><title>\n  Trullo a 6 coni &ndash; Ostuni  </title></head>')).toBe(
      'Trullo a 6 coni – Ostuni',
    )
  })
  it('decodes entities', () => {
    expect(decodeEntities('Citt&agrave; &amp; mare &#8211; &#x2019;s &egrave; &foo;')).toBe(
      'Città & mare – ’s è &foo;',
    )
  })
  it('leaves out titles that only name the site or a wall', () => {
    expect(titleFromHtml('<title>Instagram</title>')).toBe('')
    expect(titleFromHtml('<title>Before you continue to YouTube</title>')).toBe('')
    expect(titleFromHtml('<title>Just a moment...</title>')).toBe('')
    expect(titleFromHtml('<title>Log into Facebook</title>')).toBe('')
    expect(titleFromHtml('<title>Instagram photos of Ostuni</title>')).toBe('Instagram photos of Ostuni')
    expect(titleFromHtml('<p>no head</p>')).toBe('')
  })
})

describe('isPrivateAddress', () => {
  it('blocks the home network and the machine itself', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:c0a8:101',
      'not-an-ip',
    ])
      expect(isPrivateAddress(a), a).toBe(true)
  })
  it('allows public addresses', () => {
    for (const a of ['8.8.8.8', '104.16.1.1', '2606:4700::1111', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(a), a).toBe(false)
  })
})
