import { describe, expect, it } from 'vitest'
import { durationLabel, formatInr, normalizePhone, normalizeUtr, perMonth, upiLink, validateSubscribe } from './subscribe'

const ok = { name: 'Asha Rao', company: 'Rao Traders', email: 'asha@raotraders.in', phone: '98450 12345', utr: '4251 9087 6543' }
const receipt = { name: 'pay.png', size: 200_000 }

describe('validateSubscribe', () => {
  it('accepts a complete, well-formed request (spaces in phone and UTR are fine)', () => {
    expect(validateSubscribe(ok, receipt)).toEqual({})
  })
  it('flags each bad field', () => {
    const e = validateSubscribe({ name: ' ', company: '', email: 'nope', phone: '123', utr: 'short' }, null)
    expect(Object.keys(e).sort()).toEqual(['company', 'email', 'name', 'phone', 'receipt', 'utr'])
  })
  it('rejects oversize and wrong-type receipts', () => {
    expect(validateSubscribe(ok, { name: 'a.png', size: 3 * 1024 * 1024 + 1 }).receipt).toMatch(/3 MB/)
    expect(validateSubscribe(ok, { name: 'a.exe', size: 10 }).receipt).toMatch(/JPG/)
    expect(validateSubscribe(ok, { name: 'a.PDF', size: 10 }).receipt).toBeUndefined()
  })
  it('accepts +91 phone numbers', () => { expect(validateSubscribe({ ...ok, phone: '+91 98450-12345' }, receipt).phone).toBeUndefined() })
})

describe('normalisers and formatting', () => {
  it('normalises UTR and phone like the database does', () => {
    expect(normalizeUtr(' 4251-9087 6543 ')).toBe('425190876543')
    expect(normalizeUtr('ab12cd34ef56')).toBe('AB12CD34EF56')
    expect(normalizePhone('+91 98450-12345')).toBe('+919845012345')
  })
  it('formats prices and durations', () => {
    expect(formatInr(2999)).toBe('₹2,999')
    expect(formatInr(1499.5)).toBe('₹1,499.50')
    expect(durationLabel(1)).toBe('1 month')
    expect(durationLabel(12)).toBe('1 year')
    expect(durationLabel(6)).toBe('6 months')
    expect(perMonth({ price_inr: 29990, duration_months: 12 })).toBe(2499)
    expect(perMonth({ price_inr: 999, duration_months: 1 })).toBeNull()
  })
  it('builds a UPI link, or none without a UPI ID', () => {
    const l = upiLink({ upi_id: 'shop@okhdfc', payee_name: 'Attendo Labs', qr_path: null }, 2999)!
    expect(l.startsWith('upi://pay?')).toBe(true)
    expect(l).toContain('pa=shop%40okhdfc')
    expect(l).toContain('am=2999.00')
    expect(l).toContain('pn=Attendo%20Labs')
    expect(upiLink({ upi_id: null, payee_name: null, qr_path: 'qr/x.png' }, 100)).toBeNull()
  })
})
