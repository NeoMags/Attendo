import { describe, expect, it } from 'vitest'
import { taxError, taxYearLabel, taxYearOf } from './tax'
describe('tax year', () => {
  it('starts on 1 April', () => { expect(taxYearOf(new Date(2026, 2, 31))).toBe(2025); expect(taxYearOf(new Date(2026, 3, 1))).toBe(2026); expect(taxYearOf(new Date(2027, 0, 5))).toBe(2026) })
  it('labels', () => { expect(taxYearLabel(2026)).toBe('2026-27'); expect(taxYearLabel(2099)).toBe('2099-00') })
  it('maps error codes', () => { expect(taxError('x INVALID_REGIME')).toMatch(/regime/); expect(taxError('boom')).toBe('boom') })
})
