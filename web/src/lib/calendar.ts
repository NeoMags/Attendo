export type DayKind = 'present' | 'late' | 'open' | 'absent' | 'off' | 'future'

const pad = (n: number) => String(n).padStart(2, '0')

/** All dates (YYYY-MM-DD) of a 'YYYY-MM' month. Pure calendar arithmetic, no time zone involved. */
export function monthDays(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`)
}

/** ISO weekday 1 = Monday … 7 = Sunday, matching shifts.working_days. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return w === 0 ? 7 : w
}

/** Empty cells before day 1 in a Monday-first grid. */
export const leadingBlanks = (ym: string) => isoWeekday(`${ym}-01`) - 1

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export interface DayRecord { late_minutes: number | null; open: boolean }

/** `today` is the company-local date. Days with no record are 'absent' only on past working days. */
export function classifyDay(date: string, today: string, workingDays: number[], recs: DayRecord[]): DayKind {
  if (recs.length) {
    if (recs.some((r) => r.open)) return 'open'
    return recs.some((r) => (r.late_minutes ?? 0) > 0) ? 'late' : 'present'
  }
  if (date > today) return 'future'
  if (!workingDays.includes(isoWeekday(date))) return 'off'
  return date === today ? 'future' : 'absent'
}
