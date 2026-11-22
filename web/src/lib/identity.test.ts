import { describe, expect, it } from 'vitest'
import { aadhaarLast4, aadhaarStatus, formatAadhaar, docPath, isEsiIp, isIfsc, isUan, isValidAadhaar, normalizePhone } from './identity'

describe('aadhaar', () => {
  // 2234 5678 9012 style numbers are not guaranteed valid; build valid ones from the algorithm below.
  function withCheck(base11: string): string {
    for (let c = 0; c <= 9; c++) if (isValidAadhaar(base11 + c)) return base11 + c
    throw new Error('none')
  }
  it('accepts a number with a valid Verhoeff checksum and rejects a changed digit', () => {
    const ok = withCheck('23456789012')
    expect(isValidAadhaar(ok)).toBe(true)
    expect(isValidAadhaar(ok.replace(/\d$/, (d) => String((Number(d) + 1) % 10)))).toBe(false)
  })
  it('exactly one check digit works for a given prefix', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((c) => isValidAadhaar(`23456789012${c}`)).length).toBe(1)
  })
  it('rejects bad shapes', () => {
    expect(isValidAadhaar('123456789012')).toBe(false) // starts with 1
    expect(isValidAadhaar('2345678901')).toBe(false)
    expect(isValidAadhaar('abcd')).toBe(false)
  })
  it('ignores spaces and keeps last 4', () => {
    const ok = withCheck('23456789012')
    expect(isValidAadhaar(`${ok.slice(0, 4)} ${ok.slice(4, 8)} ${ok.slice(8)}`)).toBe(true)
    expect(aadhaarLast4('2345 6789 0123')).toBe('0123')
  })
})

describe('phone + statutory ids', () => {
  it('normalizes Indian numbers', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210')
    expect(normalizePhone('09876543210')).toBe('+919876543210')
    expect(normalizePhone('919876543210')).toBe('+919876543210')
    expect(normalizePhone('+14155550123')).toBe('+14155550123')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
  it('validates UAN, ESI IP, IFSC', () => {
    expect(isUan('123456789012')).toBe(true); expect(isUan('12345')).toBe(false)
    expect(isEsiIp('1234567890')).toBe(true); expect(isEsiIp('12345678901234567')).toBe(true); expect(isEsiIp('12345')).toBe(false)
    expect(isIfsc('HDFC0001234')).toBe(true); expect(isIfsc('hdfc0001234')).toBe(false)
  })
  it('builds storage paths only for allowed types', () => {
    expect(docPath('c', 'e', 'photo', 'image/jpeg')).toBe('c/e/photo.jpg')
    expect(docPath('c', 'e', 'aadhaar', 'application/pdf')).toBe('c/e/aadhaar.pdf')
    expect(docPath('c', 'e', 'photo', 'application/pdf')).toBeNull()
    expect(docPath('c', 'e', 'photo', 'image/gif')).toBeNull()
  })
})

describe('aadhaar typing helpers', () => {
  it('formats digits only, grouped, max 12', () => {
    expect(formatAadhaar('2345a67890123999')).toBe('2345 6789 0123')
    expect(formatAadhaar('')).toBe('')
  })
  it('status: empty / incomplete / unusual (non-blocking) / ok', () => {
    expect(aadhaarStatus('')).toBe('empty')
    expect(aadhaarStatus('2345 67')).toBe('incomplete')
    expect(aadhaarStatus('123456789012')).toBe('unusual')
    let ok = ''
    for (let c = 0; c <= 9; c++) if (isValidAadhaar(`23456789012${c}`)) ok = `23456789012${c}`
    expect(aadhaarStatus(formatAadhaar(ok))).toBe('ok')
  })
})
