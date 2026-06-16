import { describe, it, expect } from 'vitest'
import { HDate } from '@hebcal/core'
import { gregorianToHebrew, nextHebrewBirthday } from '../hebrewDate'

describe('gregorianToHebrew', () => {
  it('converts a known Gregorian date to its Hebrew gematriya date', () => {
    // 13 Nov 2008 === 15 Cheshvan 5769 (from @hebcal docs)
    expect(gregorianToHebrew('2008-11-13')).toBe('ט״ו חשון תשס״ט')
  })

  it('can drop the year', () => {
    expect(gregorianToHebrew('2008-11-13', false)).toBe('ט״ו חשון')
  })

  it('returns empty string for bad input', () => {
    expect(gregorianToHebrew('')).toBe('')
    expect(gregorianToHebrew(undefined)).toBe('')
    expect(gregorianToHebrew('not-a-date')).toBe('')
  })
})

describe('nextHebrewBirthday', () => {
  it('returns null for an unparseable date', () => {
    expect(nextHebrewBirthday(undefined, new Date(2024, 0, 1))).toBeNull()
    expect(nextHebrewBirthday('nope', new Date(2024, 0, 1))).toBeNull()
  })

  it('lands on the same Hebrew day & month as the birth date', () => {
    const birth = '2008-11-13' // 15 Cheshvan 5769
    const birthHd = new HDate(new Date(2008, 10, 13))
    const today = new Date(2024, 0, 1)
    const res = nextHebrewBirthday(birth, today)
    expect(res).not.toBeNull()
    const nextHd = new HDate(res!.nextDate)
    expect(nextHd.getDate()).toBe(birthHd.getDate())
    expect(nextHd.getMonthName()).toBe(birthHd.getMonthName())
  })

  it('returns a date on or after today', () => {
    const today = new Date(2024, 0, 1)
    const res = nextHebrewBirthday('1990-06-15', today)
    expect(res).not.toBeNull()
    expect(res!.nextDate.getTime()).toBeGreaterThanOrEqual(today.getTime())
  })

  it('computes a sensible Hebrew age', () => {
    // born 15 Cheshvan 5769; the anniversary in late 2024 is 5785 → 16/17.
    const res = nextHebrewBirthday('2008-11-13', new Date(2024, 0, 1))
    expect(res).not.toBeNull()
    expect(res!.turning).toBeGreaterThanOrEqual(15)
    expect(res!.turning).toBeLessThanOrEqual(18)
  })

  it('rolls to next year when this year’s anniversary already passed', () => {
    // today just after a birthday → next occurrence must be ~next year
    const birth = '1980-09-10'
    const thisYear = nextHebrewBirthday(birth, new Date(2024, 0, 1))!
    const dayAfter = new Date(thisYear.nextDate.getTime() + 86400000)
    const rolled = nextHebrewBirthday(birth, dayAfter)!
    expect(rolled.nextDate.getTime()).toBeGreaterThan(thisYear.nextDate.getTime())
  })
})
