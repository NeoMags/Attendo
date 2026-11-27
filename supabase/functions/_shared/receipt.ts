// Pure helpers for payment-receipt uploads (no Deno globals, so they can be unit-tested anywhere).
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024

export type ReceiptKind = { ext: 'jpg' | 'png' | 'webp' | 'pdf'; mime: string }

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)

/** Decide the file type from its first bytes. The client-supplied name and MIME type are never trusted. */
export function sniffReceipt(b: Uint8Array): ReceiptKind | null {
  if (b.length < 12) return null
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { ext: 'webp', mime: 'image/webp' }
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' }
  return null
}

/** Error codes raised by public.submit_subscription_request, mapped to an HTTP status. */
export const SUBMIT_ERRORS: Record<string, number> = {
  PLAN_NOT_AVAILABLE: 400, INVALID_NAME: 400, INVALID_COMPANY_NAME: 400, INVALID_EMAIL: 400, INVALID_PHONE: 400,
  INVALID_UTR: 400, INVALID_RECEIPT: 400, COMPANY_NOT_FOUND: 400, UTR_ALREADY_USED: 409, REQUEST_ALREADY_PENDING: 409,
}

export function submitErrorCode(message: string | undefined): string | null {
  const m = (message ?? '').match(/[A-Z][A-Z_]{3,}/g) ?? []
  return m.find((c) => c in SUBMIT_ERRORS) ?? null
}
