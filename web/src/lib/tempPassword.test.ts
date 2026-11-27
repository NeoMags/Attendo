import { describe, expect, it } from 'vitest'
import { generateTempPassword } from '../../../supabase/functions/_shared/temp-password'

describe('generateTempPassword', () => {
  it('is 12 characters by default with at least one letter and one digit', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateTempPassword()
      expect(p).toHaveLength(12)
      expect(p).toMatch(/[A-Za-z]/)
      expect(p).toMatch(/[0-9]/)
    }
  })
  it('never uses ambiguous characters', () => {
    for (let i = 0; i < 500; i++) expect(generateTempPassword(40)).not.toMatch(/[01OIl]/)
  })
  it('does not repeat across calls', () => {
    expect(new Set(Array.from({ length: 200 }, () => generateTempPassword())).size).toBe(200)
  })
  it('rejects lengths the auth rules would refuse', () => {
    expect(() => generateTempPassword(7)).toThrow()
    expect(() => generateTempPassword(73)).toThrow()
  })
})
