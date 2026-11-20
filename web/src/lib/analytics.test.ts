import { describe, expect, it } from 'vitest'
import { dailyStats } from './analytics'

describe('dailyStats', () => {
  it('counts distinct employees and averages closed shifts', () => {
    const r = dailyStats([
      { work_date: '2026-11-02', employee_id: 'a', late_minutes: 5, worked_seconds: 28800 },
      { work_date: '2026-11-02', employee_id: 'a', late_minutes: 0, worked_seconds: 3600 },
      { work_date: '2026-11-02', employee_id: 'b', late_minutes: 0, worked_seconds: null },
      { work_date: '2026-11-01', employee_id: 'a', late_minutes: null, worked_seconds: 7200 },
    ])
    expect(r.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(r[1]).toEqual({ date: '2026-11-02', present: 2, late: 1, avgHours: 4.5 })
    expect(dailyStats([])).toEqual([])
  })
})
