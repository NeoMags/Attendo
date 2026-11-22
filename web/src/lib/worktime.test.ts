import { describe, expect, it } from 'vitest'
import { shiftSeconds, underOver } from './worktime'
import { classifyDay, isoWeekday, leadingBlanks, monthDays, shiftMonth } from './calendar'

describe('worktime', () => {
  it('computes day and overnight shift length', () => {
    expect(shiftSeconds('09:00', '18:00')).toBe(9 * 3600)
    expect(shiftSeconds('09:00:00', '17:30:00')).toBe(8.5 * 3600)
    expect(shiftSeconds('22:00', '06:00')).toBe(8 * 3600)
    expect(shiftSeconds('bad', '06:00')).toBeNull()
  })
  it('splits under and over', () => {
    expect(underOver(7 * 3600, 9 * 3600)).toEqual({ underS: 7200, overS: 0 })
    expect(underOver(10 * 3600, 9 * 3600)).toEqual({ underS: 0, overS: 3600 })
    expect(underOver(9 * 3600, 9 * 3600)).toEqual({ underS: 0, overS: 0 })
    expect(underOver(null, 9 * 3600)).toBeNull()
    expect(underOver(100, null)).toBeNull()
  })
})

describe('calendar', () => {
  it('builds months', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2028-02')).toHaveLength(29)
    expect(monthDays('2026-11')[29]).toBe('2026-11-30')
  })
  it('weekday and blanks (Monday-first)', () => {
    expect(isoWeekday('2026-11-22')).toBe(7) // Sunday
    expect(isoWeekday('2026-11-23')).toBe(1) // Monday
    expect(leadingBlanks('2026-11')).toBe(6) // 1 Nov 2026 is a Sunday
  })
  it('shifts months across year ends', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('classifies days', () => {
    const wd = [1, 2, 3, 4, 5, 6]
    const today = '2026-11-20'
    expect(classifyDay('2026-11-10', today, wd, [{ late_minutes: 0, open: false }])).toBe('present')
    expect(classifyDay('2026-11-10', today, wd, [{ late_minutes: 12, open: false }])).toBe('late')
    expect(classifyDay('2026-11-20', today, wd, [{ late_minutes: 0, open: true }])).toBe('open')
    expect(classifyDay('2026-11-09', today, wd, [])).toBe('absent')
    expect(classifyDay('2026-11-15', today, wd, [])).toBe('off') // Sunday
    expect(classifyDay('2026-11-20', today, wd, [])).toBe('future') // today, not yet in
    expect(classifyDay('2026-11-25', today, wd, [])).toBe('future')
    expect(classifyDay('2026-11-09', today, wd, [], true)).toBe('leave')
    expect(classifyDay('2026-11-25', today, wd, [], true)).toBe('leave')
    expect(classifyDay('2026-11-10', today, wd, [{ late_minutes: 0, open: false }], true)).toBe('present')
  })
})
