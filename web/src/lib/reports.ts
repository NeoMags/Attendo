import { csvEscape, fmtDuration, fmtTime } from './format'

export type Cell = string | number
export interface ReportTable { title: string; subtitle: string; columns: string[]; rows: Cell[][] }

export interface AttendanceDetail {
  work_date: string; status: string; check_in_at: string; check_out_at: string | null
  late_minutes: number | null; worked_seconds: number | null
  employees: { employee_code: string; full_name: string } | null
}
export interface ProductivityRow {
  employee_id: string; employee_code: string; full_name: string; days_present: number; late_days: number
  worked_seconds: number; tracked_seconds: number; distance_m: number; location_points: number
  interruptions: number; interruption_seconds: number
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.min(100, Math.round((a / b) * 100))}%` : '—')

export function dailyReport(rows: AttendanceDetail[], from: string, to: string, tz?: string): ReportTable {
  return {
    title: 'Daily attendance', subtitle: `${from} to ${to}`,
    columns: ['Date', 'Employee ID', 'Name', 'Check-in', 'Check-out', 'Late (min)', 'Worked', 'Status'],
    rows: rows.map((r) => [r.work_date, r.employees?.employee_code ?? '', r.employees?.full_name ?? '', fmtTime(r.check_in_at, tz), fmtTime(r.check_out_at, tz), r.late_minutes ?? 0, fmtDuration(r.worked_seconds), r.status]),
  }
}

/** One row per employee: distinct days present, late days, total worked time. */
export function summaryReport(rows: AttendanceDetail[], from: string, to: string): ReportTable {
  const by = new Map<string, { code: string; name: string; days: Set<string>; late: Set<string>; secs: number }>()
  for (const r of rows) {
    const key = r.employees?.employee_code ?? '?'
    const e = by.get(key) ?? { code: key, name: r.employees?.full_name ?? '', days: new Set(), late: new Set(), secs: 0 }
    e.days.add(r.work_date)
    if ((r.late_minutes ?? 0) > 0) e.late.add(r.work_date)
    e.secs += r.worked_seconds ?? 0
    by.set(key, e)
  }
  return {
    title: 'Attendance summary', subtitle: `${from} to ${to}`,
    columns: ['Employee ID', 'Name', 'Days present', 'Late days', 'Total worked'],
    rows: [...by.values()].sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.code, e.name, e.days.size, e.late.size, fmtDuration(e.secs)]),
  }
}

/** Metrics only. No score, ranking or rating is derived from these figures. */
export function productivityReport(rows: ProductivityRow[], from: string, to: string): ReportTable {
  return {
    title: 'Field activity metrics', subtitle: `${from} to ${to} · measurements only, not a performance rating`,
    columns: ['Employee ID', 'Name', 'Days present', 'Late days', 'Worked', 'Tracked', 'Tracking coverage', 'Distance (km)', 'Location points', 'Interruptions', 'Interrupted'],
    rows: rows.map((r) => [r.employee_code, r.full_name, r.days_present, r.late_days, fmtDuration(r.worked_seconds), fmtDuration(r.tracked_seconds),
      pct(r.tracked_seconds, r.worked_seconds), Math.round(r.distance_m / 10) / 100, r.location_points, r.interruptions, fmtDuration(r.interruption_seconds)]),
  }
}

export function toCsv(t: ReportTable): string {
  return '﻿' + [t.columns, ...t.rows].map((r) => r.map((c) => csvEscape(c)).join(',')).join('\r\n')
}

export const fileName = (t: ReportTable, from: string, to: string, ext: string) =>
  `${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${from}_${to}.${ext}`

export async function toXlsx(t: ReportTable): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet(t.title.slice(0, 31))
  ws.addRow([t.title]).font = { bold: true, size: 14 }
  ws.addRow([t.subtitle])
  ws.addRow([])
  const head = ws.addRow(t.columns)
  head.font = { bold: true }
  // Text cells are written as strings (never formulas) so a name like "=HYPERLINK(...)" stays inert.
  for (const r of t.rows) ws.addRow(r.map((c) => (typeof c === 'string' ? { richText: [{ text: c }] } : c)))
  ws.columns.forEach((c, i) => { c.width = Math.min(40, Math.max(12, t.columns[i].length + 4)) })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export async function toPdf(t: ReportTable): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: t.columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(14); doc.text(t.title, 40, 40)
  doc.setFontSize(9); doc.text(t.subtitle, 40, 56)
  autoTable(doc, { startY: 70, head: [t.columns], body: t.rows.map((r) => r.map(String)), styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] } })
  return doc.output('blob')
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
