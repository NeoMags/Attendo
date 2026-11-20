export interface AttRow { work_date: string; employee_id: string; late_minutes: number | null; worked_seconds: number | null }
export interface DayStat { date: string; present: number; late: number; avgHours: number }

/** One row per date: distinct employees present, how many were late, mean worked hours (closed shifts only). */
export function dailyStats(rows: AttRow[]): DayStat[] {
  const by = new Map<string, { emps: Set<string>; late: Set<string>; secs: number; n: number }>()
  for (const r of rows) {
    const d = by.get(r.work_date) ?? { emps: new Set(), late: new Set(), secs: 0, n: 0 }
    d.emps.add(r.employee_id)
    if ((r.late_minutes ?? 0) > 0) d.late.add(r.employee_id)
    if (r.worked_seconds != null) { d.secs += r.worked_seconds; d.n++ }
    by.set(r.work_date, d)
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
    date, present: d.emps.size, late: d.late.size, avgHours: d.n ? Math.round((d.secs / d.n / 3600) * 10) / 10 : 0,
  }))
}
