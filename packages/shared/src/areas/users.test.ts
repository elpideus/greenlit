import { describe, expect, it } from 'vitest'
import { CreateUserInput, Username } from './users.ts'

describe('Username', () => {
  it('is stored trimmed and lower-case', () => {
    expect(Username.parse('  Capo ')).toBe('capo')
    expect(Username.parse('Giuseppe.Rossi_2')).toBe('giuseppe.rossi_2')
  })

  it('never looks like an email, so sign-in can tell the two apart', () => {
    expect(Username.safeParse('capo@studio.it').success).toBe(false)
  })

  it('refuses spaces, one letter and names over 32 characters', () => {
    expect(Username.safeParse('il capo').success).toBe(false)
    expect(Username.safeParse('c').success).toBe(false)
    expect(Username.safeParse('a'.repeat(33)).success).toBe(false)
    expect(Username.safeParse('.capo').success).toBe(false)
  })
})

describe('CreateUserInput', () => {
  const base = { displayName: 'Il Capo', role: 'reviewer', password: 'long-enough-1' } as const

  it('takes a username without an email', () => {
    expect(CreateUserInput.parse({ ...base, username: 'capo' })).toMatchObject({ username: 'capo' })
  })

  it('needs an email or a username', () => {
    expect(CreateUserInput.safeParse(base).success).toBe(false)
    expect(CreateUserInput.safeParse({ ...base, email: null, username: null }).success).toBe(false)
  })
})
