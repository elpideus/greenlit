import { describe, expect, it } from 'vitest'
import { monthOf, parseShownDate } from './tiktok.ts'

describe('TikTok Studio’s schedule pickers', () => {
  it('read month names in Italian and English, long and short', () => {
    expect(monthOf('Novembre')).toBe(11)
    expect(monthOf('dicembre')).toBe(12)
    expect(monthOf('Gennaio')).toBe(1)
    expect(monthOf('Jan')).toBe(1)
    expect(monthOf('May')).toBe(5)
    expect(monthOf('maggio')).toBe(5)
    expect(monthOf('Settembre')).toBe(9)
    expect(monthOf('October')).toBe(10)
    expect(monthOf('2026')).toBeNull()
  })
  it('read the date the picker shows', () => {
    expect(parseShownDate('25 nov 2026')).toEqual({ day: 25, month: 11, year: 2026 })
    expect(parseShownDate('4 dic 2026')).toEqual({ day: 4, month: 12, year: 2026 })
    expect(parseShownDate('Nov 27, 2026')).toEqual({ day: 27, month: 11, year: 2026 })
    expect(parseShownDate('1 gen. 2027')).toEqual({ day: 1, month: 1, year: 2027 })
    expect(parseShownDate('10:50')).toBeNull()
    expect(parseShownDate('')).toBeNull()
  })
})
