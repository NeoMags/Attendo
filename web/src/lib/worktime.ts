/** Seconds between 'HH:MM[:SS]' start and end; an end at/before the start is an overnight shift. */
export function shiftSeconds(start: string, end: string): number | null {
  const p = (t: string) => {
    const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t)
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null
  }
  const s = p(start), e = p(end)
  if (s == null || e == null) return null
  return e > s ? e - s : e + 86400 - s
}

/**
 * Worked time compared with the scheduled shift length. Unpaid breaks are not modelled,
 * so this is "vs shift length", not payroll overtime. Null while the shift is still open.
 */
export function underOver(workedS: number | null | undefined, shiftS: number | null | undefined): { underS: number; overS: number } | null {
  if (workedS == null || shiftS == null) return null
  const d = workedS - shiftS
  return { underS: d < 0 ? -d : 0, overS: d > 0 ? d : 0 }
}
