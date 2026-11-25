import { describe, expect, it } from 'vitest'
import { identities } from '../merge.ts'
import { instagramUser, lightPrefString, prefString } from './device-apps.ts'

/** A Java DataOutputStream string: two bytes of length, then the bytes. */
const utf = (s: string) => {
  const b = Buffer.from(s, 'utf8')
  const n = Buffer.alloc(2)
  n.writeUInt16BE(b.length)
  return Buffer.concat([n, b])
}

describe('what the apps on the device keep about who is signed in', () => {
  it('reads the Instagram app’s current user from its preferences', () => {
    const current = JSON.stringify({
      id: '31000000001',
      username: 'acme_studio',
      full_name: 'Acme & Co',
      fbid_v2: 1789,
    })
    const xml = `<?xml version='1.0'?><map><string name="current_user_id">31000000001</string><string name="current">${current
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')}</string></map>`
    expect(prefString(xml, 'current_user_id')).toBe('31000000001')
    expect(instagramUser(xml)).toMatchObject({
      id: '31000000001',
      username: 'acme_studio',
      full_name: 'Acme & Co',
    })
    expect(instagramUser('<map></map>')).toBeNull()
  })

  it('reads a string of a Facebook light preferences file, a 44-character name included', () => {
    const name = 'Acme Studio ristrutturazioni Ostuni'
    const buf = Buffer.concat([
      Buffer.from([1, 0, 0, 0, 4, 3]),
      utf('access_token'),
      utf('secret-token'),
      Buffer.from([3]),
      utf('uid'),
      utf('100000000000001'),
      Buffer.from([3]),
      utf('username'),
      utf(name),
    ])
    expect(lightPrefString(buf, 'uid')).toBe('100000000000001')
    expect(lightPrefString(buf, 'username')).toBe(name)
    expect(lightPrefString(buf, 'missing')).toBeNull()
  })

  it('matches the Facebook app’s profile to the Page facebook.com acts as', () => {
    const web = {
      platform: 'facebook' as const,
      externalId: '100000000000001',
      handle: '',
      platformIds: { actorId: '100000000000001', pageId: '1' },
    }
    const app = {
      platform: 'facebook' as const,
      externalId: 'app:100000000000001',
      handle: '',
      platformIds: { actorId: '100000000000001' },
    }
    expect(identities(app).some((x) => identities(web).includes(x))).toBe(true)
  })
})
