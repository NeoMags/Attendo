import { describe, expect, it } from 'vitest'
import { sniffReceipt, submitErrorCode } from '../../../supabase/functions/_shared/receipt'

const pad = (b: number[]) => Uint8Array.from([...b, ...new Array(16).fill(0)])

describe('sniffReceipt', () => {
  it('detects jpeg, png, webp and pdf by magic bytes', () => {
    expect(sniffReceipt(pad([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg')
    expect(sniffReceipt(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png')
    expect(sniffReceipt(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext).toBe('webp')
    expect(sniffReceipt(pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))?.mime).toBe('application/pdf')
  })
  it('rejects RIFF that is not WebP, scripts, html and tiny files', () => {
    expect(sniffReceipt(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull()
    expect(sniffReceipt(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull()
    expect(sniffReceipt(new TextEncoder().encode('MZ executable bytes here....'))).toBeNull()
    expect(sniffReceipt(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull()
  })
})

describe('submitErrorCode', () => {
  it('extracts known RPC codes from a database error message', () => {
    expect(submitErrorCode('UTR_ALREADY_USED')).toBe('UTR_ALREADY_USED')
    expect(submitErrorCode('P0001: INVALID_EMAIL')).toBe('INVALID_EMAIL')
  })
  it('returns null for unknown or empty messages', () => {
    expect(submitErrorCode('connection reset')).toBeNull()
    expect(submitErrorCode(undefined)).toBeNull()
  })
})
