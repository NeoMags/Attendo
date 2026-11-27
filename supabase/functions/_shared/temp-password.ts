// Temporary passwords for newly approved customers. Pure (Web Crypto only) so it is unit-testable.
// Ambiguous characters (0/O, 1/l/I) are left out because the owner reads or types these by hand.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'
const ALL = LETTERS + DIGITS

/** Uniform random index in [0, n) without modulo bias. */
function pick(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  do { crypto.getRandomValues(buf) } while (buf[0] >= limit)
  return buf[0] % n
}

export function generateTempPassword(length = 12): string {
  if (length < 8 || length > 72) throw new Error('length must be 8-72')
  const chars = Array.from({ length }, () => ALL[pick(ALL.length)])
  // The auth rules require at least one letter and one digit; force one of each at random positions.
  const a = pick(length)
  let b = pick(length)
  while (b === a) b = pick(length)
  chars[a] = LETTERS[pick(LETTERS.length)]
  chars[b] = DIGITS[pick(DIGITS.length)]
  return chars.join('')
}
