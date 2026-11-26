import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import {
  dailyReport, download, fileName, productivityReport, summaryReport, toCsv, toPdf, toXlsx,
  type AttendanceDetail, type ProductivityRow, type ReportTable,
} from '@/lib/reports'
import { Button, Card, ErrorNote, Field, Input, Select, Skeleton, Table, Td } from '@/components/ui'

type Kind = 'summary' | 'daily' | 'activity'
const PAGE = 1000, MAX_PAGES = 20
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export default function Reports() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)
  const [kind, setKind] = useState<Kind>('summary')
  const [from, setFrom] = useState(() => addDays(today, -29))
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [exportErr, setExportErr] = useState<unknown>(null)
  const bad = from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92

  const q = useQuery({
    queryKey: ['report', companyId, kind, from, to], enabled: !!companyId && !bad,
    queryFn: async (): Promise<{ table: ReportTable; truncated: boolean }> => {
      if (kind === 'activity') {
        const { data, error } = await supabase.rpc('productivity_report', { p_company_id: companyId!, p_from: from, p_to: to })
        if (error) throw error
        return { table: productivityReport(data as ProductivityRow[], from, to), truncated: false }
      }
      const rows: AttendanceDetail[] = []
      let truncated = false
      for (let p = 0; p < MAX_PAGES; p++) {
        const { data, error } = await supabase.from('attendance')
          .select('work_date, status, check_in_at, check_out_at, late_minutes, worked_seconds, employees(employee_code, full_name)')
          .eq('company_id', companyId!).gte('work_date', from).lte('work_date', to)
          .order('work_date').order('check_in_at').range(p * PAGE, p * PAGE + PAGE - 1)
        if (error) throw error
        rows.push(...(data as unknown as AttendanceDetail[]))
        if (data.length < PAGE) break
        if (p === MAX_PAGES - 1) truncated = true
      }
      return { table: kind === 'daily' ? dailyReport(rows, from, to, tz) : summaryReport(rows, from, to), truncated }
    },
  })

  async function exportAs(fmt: 'csv' | 'xlsx' | 'pdf') {
    const t = q.data?.table
    if (!t) return
    setBusy(true); setExportErr(null)
    try {
      const blob = fmt === 'csv' ? new Blob([toCsv(t)], { type: 'text/csv;charset=utf-8' }) : fmt === 'xlsx' ? await toXlsx(t) : await toPdf(t)
      download(blob, fileName(t, from, to, fmt))
    } catch (e) { setExportErr(e) } finally { setBusy(false) }
  }

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const t = q.data?.table

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Reports</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Report">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="summary">Attendance summary</option>
              <option value="daily">Daily attendance</option>
              <option value="activity">Field activity metrics</option>
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
      {bad && <ErrorNote error={new Error('Choose a range of at most 92 days, with the start before the end.')} />}
      {kind === 'activity' && <p className="text-xs text-slate-500">Measurements only: presence, tracked time, distance and tracking interruptions. No score or ranking is calculated. Distance ignores inaccurate, mock and implausible fixes.</p>}
      <Card title={t ? `${t.title} · ${t.rows.length} rows` : 'Preview'}>
        {q.isLoading ? <Skeleton /> : q.error ? <ErrorNote error={q.error} /> : t && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="ghost" disabled={busy || !t.rows.length} onClick={() => exportAs('csv')}>CSV</Button>
              <Button variant="ghost" disabled={busy || !t.rows.length} onClick={() => exportAs('xlsx')}>Excel</Button>
              <Button variant="ghost" disabled={busy || !t.rows.length} onClick={() => exportAs('pdf')}>PDF</Button>
            </div>
            <ErrorNote error={exportErr} />
            {q.data!.truncated && <p className="mb-2 text-xs text-amber-700">Too many rows: output was cut off. Narrow the date range.</p>}
            <Table head={t.columns} empty={t.rows.length ? undefined : 'No data in this period.'}>
              {t.rows.slice(0, 200).map((r, i) => <tr key={i} className="tr-hoverable">{r.map((c, j) => <Td key={j}>{c}</Td>)}</tr>)}
            </Table>
            {t.rows.length > 200 && <p className="mt-2 text-xs text-slate-500">Preview shows the first 200 rows; exports contain all {t.rows.length}.</p>}
            <p className="mt-2 text-xs text-slate-500">PDF uses a Latin font: Kannada/Hindi names may not display in PDF. Use Excel or CSV for those.</p>
          </>
        )}
      </Card>
    </div>
  )
}
