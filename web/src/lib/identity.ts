// Verhoeff checksum tables (used by Aadhaar numbers).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/** Aadhaar: 12 digits, first digit 2-9, valid Verhoeff checksum. Spaces/dashes ignored. */
export function isValidAadhaar(input: string): boolean {
  const s = input.replace(/[\s-]/g, '')
  if (!/^[2-9][0-9]{11}$/.test(s)) return false
  let c = 0
  const digits = s.split('').reverse().map(Number)
  digits.forEach((d, i) => { c = D[c][P[i % 8][d]] })
  return c === 0
}

/** Only the last 4 digits are ever kept; the full number is not sent anywhere. */
export const aadhaarLast4 = (input: string) => input.replace(/\D/g, '').slice(-4)

/** Indian mobile or already-international number -> +E.164, or null when invalid. 10 digits starting 6-9 become +91. */
export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/[\s()-]/g, '')
  if (!raw) return null
  if (/^[6-9][0-9]{9}$/.test(raw)) return `+91${raw}`
  if (/^0[6-9][0-9]{9}$/.test(raw)) return `+91${raw.slice(1)}`
  if (/^91[6-9][0-9]{9}$/.test(raw)) return `+${raw}`
  return /^\+[1-9][0-9]{6,14}$/.test(raw) ? raw : null
}

export const isUan = (s: string) => /^[0-9]{12}$/.test(s)
/** ESI insurance numbers are 10 digits (older) or 17 digits. Unverified against ESIC documentation. */
export const isEsiIp = (s: string) => /^([0-9]{10}|[0-9]{17})$/.test(s)
export const isIfsc = (s: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)

export const DOC_MAX_BYTES = 2 * 1024 * 1024
export function docPath(companyId: string, employeeId: string, kind: 'photo' | 'aadhaar', mime: string): string | null {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime]
  if (!ext || (kind === 'photo' && ext === 'pdf')) return null
  return `${companyId}/${employeeId}/${kind}.${ext}`
}
