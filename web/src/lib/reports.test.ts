import { describe, expect, it } from 'vitest'
import { dailyReport, productivityReport, summaryReport, toCsv, toXlsx, toPdf, fileName, type AttendanceDetail, type ProductivityRow } from './reports'

const A = (o: Partial<AttendanceDetail> = {}): AttendanceDetail => ({
  work_date: '2026-11-02', status: 'closed', check_in_at: '2026-11-02T04:00:00Z', check_out_at: '2026-11-02T12:00:00Z',
  late_minutes: 0, worked_seconds: 28800, employees: { employee_code: 'E1', full_name: 'Asha' }, ...o,
})
describe('reports', () => {
  it('summary counts distinct days and late days', () => {
    const t = summaryReport([A(), A({ late_minutes: 5 }), A({ work_date: '2026-11-03', late_minutes: 9 })], '2026-11-01', '2026-11-30')
    expect(t.rows).toEqual([['E1', 'Asha', 2, 2, '24h 00m']])
  })
  it('daily uses company timezone', () => {
    const t = dailyReport([A()], 'a', 'b', 'Asia/Kolkata')
    expect(JSON.stringify(t.rows[0])).toContain('Asha')
    expect(t.columns).toHaveLength(t.rows[0].length)
  })
  it('productivity shows coverage and km, and carries no score column', () => {
    const p: ProductivityRow = { employee_id: 'x', employee_code: 'E1', full_name: 'Asha', days_present: 2, late_days: 0, worked_seconds: 1000, tracked_seconds: 500, distance_m: 12345, location_points: 9, interruptions: 1, interruption_seconds: 60 }
    const t = productivityReport([p], 'a', 'b')
    expect(t.rows[0][6]).toBe('50%')
    expect(t.rows[0][7]).toBe(12.35)
    expect(t.columns.join(' ').toLowerCase()).not.toMatch(/score|rank|rating|productiv/)
    expect(t.columns).toHaveLength(t.rows[0].length)
  })
  it('coverage is capped at 100% and safe when nothing worked', () => {
    const base = { employee_id: 'x', employee_code: 'E', full_name: 'N', days_present: 0, late_days: 0, distance_m: 0, location_points: 0, interruptions: 0, interruption_seconds: 0 }
    expect(productivityReport([{ ...base, worked_seconds: 100, tracked_seconds: 400 }], 'a', 'b').rows[0][6]).toBe('100%')
    expect(productivityReport([{ ...base, worked_seconds: 0, tracked_seconds: 0 }], 'a', 'b').rows[0][6]).toBe('—')
  })
  it('csv neutralises formulas, keeps Kannada/Hindi, starts with BOM', () => {
    const t = summaryReport([A({ employees: { employee_code: 'E1', full_name: '=cmd|x' } }), A({ employees: { employee_code: 'E2', full_name: 'ಆಶಾ, आशा' } })], 'a', 'b')
    const csv = toCsv(t)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).not.toMatch(/(^|,)=cmd/m)
    expect(csv).toContain('"ಆಶಾ, आशा"')
  })
  it('file names are safe', () => expect(fileName({ title: 'Daily attendance', subtitle: '', columns: [], rows: [] }, '2026-11-01', '2026-11-30', 'csv')).toBe('daily-attendance_2026-11-01_2026-11-30.csv'))
})
describe('binary exports', () => {
  const t = summaryReport([A(), A({ employees: { employee_code: 'E2', full_name: '=1+1' } })], 'a', 'b')
  it('xlsx is a valid zip containing the data as text', async () => {
    const b = await toXlsx(t)
    const bytes = new Uint8Array(await b.arrayBuffer())
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b])
    const { Workbook } = await import('exceljs')
    const wb = new Workbook(); await wb.xlsx.load(await b.arrayBuffer())
    const ws = wb.worksheets[0]
    const vals: unknown[] = []; ws.eachRow((r) => r.eachCell((c) => vals.push(c.value)))
    expect(JSON.stringify(vals)).toContain('Asha')
    ws.eachRow((r) => r.eachCell((c) => expect(typeof c.value === 'object' && c.value && 'formula' in c.value).toBeFalsy()))
  })
  it('pdf starts with %PDF', async () => {
    const b = await toPdf(t)
    expect(new TextDecoder().decode((await b.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
  })
})
