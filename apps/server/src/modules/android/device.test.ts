import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { inputText, rawFrame, tokenIn } from './device.ts'

describe('typing on the Android device', () => {
  it('escapes what the device’s shell would read, and spaces as input wants them', () => {
    expect(inputText('abc123')).toBe('abc123')
    expect(inputText('a b')).toBe('a%sb')
    expect(inputText(`p@ss$word'"!`)).toBe(`p@ss\\$word\\'\\"\\!`)
    expect(inputText('50%;rm -rf')).toBe('50\\%\\;rm%s-rf')
  })
})

describe('an app’s token on the Android device', () => {
  it('is read for the app’s package and scope, of a Google account', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gl-accounts-'))
    try {
      const file = join(dir, 'accounts_ce.db')
      const db = new DatabaseSync(file)
      db.exec(`create table accounts (_id integer primary key, name text, type text);
        create table authtokens (_id integer primary key, accounts_id integer, type text, authtoken text);
        insert into accounts values (1, 'someone@example.com', 'com.google'), (2, 'other', 'com.other');
        insert into authtokens (accounts_id, type, authtoken) values
          (1, 'com.google.android.youtube:abc123:oauth2:https://www.googleapis.com/auth/notifications', 'wrong-scope'),
          (2, 'com.google.android.youtube:abc123:oauth2:scope-a', 'wrong-account'),
          (1, 'com.google.android.youtube:abc123:oauth2:scope-a', 'the-token'),
          (1, 'com.example:abc123:oauth2:scope-a', 'wrong-app');`)
      db.close()
      expect(tokenIn(file, 'com.google.android.youtube', 'oauth2:scope-a')).toBe('the-token')
      expect(tokenIn(file, 'com.google.android.youtube', 'oauth2:scope-b')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('a raw screen frame', () => {
  it('reads the size from its header (16 bytes since Android 10, 12 before) and keeps the pixels', () => {
    const pixels = Buffer.alloc(2 * 3 * 4, 7)
    for (const header of [16, 12]) {
      const h = Buffer.alloc(header)
      h.writeUInt32LE(2, 0)
      h.writeUInt32LE(3, 4)
      h.writeUInt32LE(1, 8)
      const f = rawFrame(Buffer.concat([h, pixels]))
      expect([f.width, f.height, f.pixels.length]).toEqual([2, 3, 24])
    }
    expect(() => rawFrame(Buffer.alloc(8))).toThrow()
  })
})
