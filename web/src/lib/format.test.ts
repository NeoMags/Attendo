import { describe, expect, it } from 'vitest'
import { csvEscape, fmtDuration } from './format'
import { isAdmin, navFor } from './roles'

describe('csvEscape', () => {
  it('neutralises formula injection', () => {
    for (const v of ['=1+1', '+1', '-1', '@x']) expect(csvEscape(v).replace(/"/g, '')).toMatch(/^'/)
  })
  it('quotes commas, quotes and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('a"b')).toBe('"a""b"')
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
  it('handles null', () => expect(csvEscape(null)).toBe(''))
})
describe('fmtDuration', () => {
  it('formats and handles null', () => {
    expect(fmtDuration(3660)).toBe('1h 01m')
    expect(fmtDuration(null)).toBe('—')
  })
})
describe('roles', () => {
  it('gates nav by role', () => {
    const labels = (r: Parameters<typeof navFor>[0]) => navFor(r).map((n) => n.label)
    expect(labels('super_admin')).toContain('Companies')
    expect(labels('company_admin')).not.toContain('Companies')
    expect(labels('manager')).not.toContain('Departments & shifts')
    expect(isAdmin('manager')).toBe(false)
  })
})
