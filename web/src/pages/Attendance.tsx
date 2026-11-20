import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, Table, Td } from '@/components/ui'
import { csvEscape, fmtDuration, fmtTime, todayIn } from '@/lib/format'

interface Row {
  id: string; work_date: string; status: string; check_in_at: string; check_out_at: string | null
  late_minutes: number | null; worked_seconds: number | null; employees: { employee_code: string; full_name: string } | null
}

const PAGE = 500

export default function Attendance() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const [from, setFrom] = useState(() => todayIn(tz))
  const [to, setTo] = useState(() => todayIn(tz))
  const bad = from > to

  const q = useQuery({
    queryKey: ['attendance', companyId, from, to],
    enabled: !!companyId && !bad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, work_date, status, check_in_at, check_out_at, late_minutes, worked_seconds, employees(employee_code, full_name)')
        .eq('company_id', companyId!)
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date', { ascending: false })
        .order('check_in_at', { ascending: false })
        .limit(PAGE)
      if (error) throw error
      return data as unknown as Row[]
    },
  })

  function exportCsv() {
    const head = ['Date', 'Employee ID', 'Name', 'Check-in', 'Check-out', 'Late (min)', 'Worked', 'Status']
    const lines = (q.data ?? []).map((r) => [
      r.work_date, r.employees?.employee_code, r.employees?.full_name, fmtTime(r.check_in_at, tz), fmtTime(r.check_out_at, tz),
      r.late_minutes ?? 0, fmtDuration(r.worked_seconds), r.status,
    ].map(csvEscape).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `attendance_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company first.</p>
  const rows = q.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Attendance</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button variant="ghost" disabled={!rows.length} onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>
      {bad && <ErrorNote error={new Error('The start date must not be after the end date.')} />}
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <>
            <Table head={['Date', 'Employee', 'Check-in', 'Check-out', 'Late', 'Worked', 'Status']} empty={rows.length ? undefined : 'No attendance in this period.'}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.work_date}</Td>
                  <Td>{r.employees?.full_name} <span className="text-slate-400">({r.employees?.employee_code})</span></Td>
                  <Td>{fmtTime(r.check_in_at, tz)}</Td>
                  <Td>{fmtTime(r.check_out_at, tz)}</Td>
                  <Td>{r.late_minutes ? <Badge tone="warn">{r.late_minutes} min</Badge> : '—'}</Td>
                  <Td>{fmtDuration(r.worked_seconds)}</Td>
                  <Td><Badge tone={r.status === 'open' ? 'good' : 'muted'}>{r.status}</Badge></Td>
                </tr>
              ))}
            </Table>
            {rows.length === PAGE && <p className="mt-2 text-xs text-amber-700">Showing the latest {PAGE} records. Narrow the date range to see the rest.</p>}
          </>
        )}
      </Card>
    </div>
  )
}
