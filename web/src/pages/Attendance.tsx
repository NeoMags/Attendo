import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PersonCell, Select, Spinner, Table, Td } from '@/components/ui'
import EmployeePanel from '@/components/EmployeePanel'
import { shiftSeconds, underOver } from '@/lib/worktime'
import { isAdmin } from '@/lib/roles'
import { utcIsoToZoned, zonedToUtcIso } from '@/lib/tz'
import { csvEscape, fmtDuration, fmtTime, todayIn } from '@/lib/format'

interface Row {
  id: string; employee_id: string; work_date: string; status: string; check_in_at: string; check_out_at: string | null
  late_minutes: number | null; worked_seconds: number | null; day_fraction_override: number | null; employees: { employee_code: string; full_name: string; shifts: { start_time: string; end_time: string } | null } | null
}

const PAGE = 500

const CORRECT_ERRORS: Record<string, string> = {
  ATTENDANCE_NOT_FOUND: 'Record not found.', FORBIDDEN: 'Only company admins can correct attendance.',
  REASON_REQUIRED: 'Enter a reason (at least 5 characters).', INVALID_TIMES: 'Check-out must be after check-in.',
  TIMESTAMP_IN_FUTURE: 'Times cannot be in the future.',
}

/** How much this attendance row counts for payroll. Automatic follows the shift's full/half-day hours. */
function DayValue({ row, onDone }: { row: Row; onDone: () => void }) {
  const [v, setV] = useState(row.day_fraction_override === null ? '' : String(row.day_fraction_override))
  const [why, setWhy] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_attendance_fraction', { p_attendance: row.id, p_fraction: v === '' ? null : Number(v), p_reason: why.trim() || null })
      if (error) throw new Error(error.message.includes('FORBIDDEN') ? 'Only company admins can change this.' : error.message)
    },
    onSuccess: onDone, onError: (e: Error) => setErr(e.message),
  })
  return (
    <form className="mt-4 space-y-2 border-t border-slate-200 pt-3" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate() }}>
      <Field label="Counts for payroll as" hint="Automatic uses the shift's full-day / half-day hours.">
        <Select value={v} onChange={(e) => setV(e.target.value)}><option value="">Automatic</option><option value="1">Full day</option><option value="0.5">Half day</option><option value="0">Not counted</option></Select>
      </Field>
      <Field label="Reason (optional)"><Input value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} /></Field>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <Button type="submit" variant="ghost" disabled={save.isPending}>Save day value</Button>
    </form>
  )
}

function CorrectModal({ row, tz, onClose, onDone }: { row: Row; tz: string; onClose: () => void; onDone: () => void }) {
  const [cin, setCin] = useState(utcIsoToZoned(row.check_in_at, tz))
  const [cout, setCout] = useState(row.check_out_at ? utcIsoToZoned(row.check_out_at, tz) : '')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      const inIso = zonedToUtcIso(cin, tz)
      const outIso = cout ? zonedToUtcIso(cout, tz) : null
      if (!inIso || (cout && !outIso)) throw new Error('Enter valid date and time values.')
      if (reason.trim().length < 5) throw new Error(CORRECT_ERRORS.REASON_REQUIRED)
      const { error } = await supabase.rpc('admin_correct_attendance', { p_attendance_id: row.id, p_check_in_at: inIso, p_check_out_at: outIso, p_reason: reason.trim() })
      if (error) { const k = Object.keys(CORRECT_ERRORS).find((c) => error.message.includes(c)); throw new Error(k ? CORRECT_ERRORS[k] : error.message) }
    },
    onSuccess: onDone, onError: (e) => setErr(e.message),
  })
  return (
    <Modal title={`Correct attendance — ${row.employees?.full_name ?? ''}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate() }} className="space-y-3">
        <p className="text-xs text-slate-500">Times are in the company timezone ({tz}). The original values and your reason are kept in the audit trail.</p>
        <Field label="Check-in"><Input type="datetime-local" required value={cin} onChange={(e) => setCin(e.target.value)} /></Field>
        <Field label="Check-out" hint="Leave empty to keep the record open"><Input type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} /></Field>
        <Field label="Reason"><Input required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending}>Save correction</Button></div>
      </form>
      <DayValue row={row} onDone={onDone} />
    </Modal>
  )
}

export default function Attendance() {
  const { companyId, company, role } = useAuth()
  const tz = company?.timezone
  const admin = isAdmin(role)
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Row | null>(null)
  const [openEmp, setOpenEmp] = useState<string | null>(null)
  const uo = (r: Row) => { const sh = r.employees?.shifts; return sh ? underOver(r.worked_seconds, shiftSeconds(sh.start_time, sh.end_time)) : null }
  const [from, setFrom] = useState(() => todayIn(tz))
  const [to, setTo] = useState(() => todayIn(tz))
  const bad = from > to

  const q = useQuery({
    queryKey: ['attendance', companyId, from, to],
    enabled: !!companyId && !bad,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, employee_id, work_date, status, check_in_at, check_out_at, late_minutes, worked_seconds, day_fraction_override, employees(employee_code, full_name, shifts(start_time, end_time))')
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
    const head = ['Date', 'Employee ID', 'Name', 'Check-in', 'Check-out', 'Late (min)', 'Worked', 'Under', 'Over', 'Status']
    const lines = (q.data ?? []).map((r) => [
      r.work_date, r.employees?.employee_code, r.employees?.full_name, fmtTime(r.check_in_at, tz), fmtTime(r.check_out_at, tz),
      r.late_minutes ?? 0, fmtDuration(r.worked_seconds), uo(r) ? fmtDuration(uo(r)!.underS) : '', uo(r) ? fmtDuration(uo(r)!.overS) : '', r.status,
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
            <Table head={['Date', 'Employee', 'Check-in', 'Check-out', 'Late', 'Worked', 'Under', 'Over', 'Status', '']} empty={rows.length ? undefined : 'No attendance in this period.'}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.work_date}</Td>
                  <Td><PersonCell name={r.employees?.full_name ?? '—'} code={r.employees?.employee_code} onClick={() => setOpenEmp(r.employee_id)} /></Td>
                  <Td>{fmtTime(r.check_in_at, tz)}</Td>
                  <Td>{fmtTime(r.check_out_at, tz)}</Td>
                  <Td>{r.late_minutes ? <Badge tone="warn">{r.late_minutes} min</Badge> : '—'}</Td>
                  <Td>{fmtDuration(r.worked_seconds)}</Td>
                  <Td>{uo(r) && uo(r)!.underS ? <span className="text-amber-700">{fmtDuration(uo(r)!.underS)}</span> : '—'}</Td>
                  <Td>{uo(r) && uo(r)!.overS ? <span className="text-emerald-700">{fmtDuration(uo(r)!.overS)}</span> : '—'}</Td>
                  <Td><Badge tone={r.status === 'open' ? 'good' : 'muted'}>{r.status}</Badge></Td>
                  <Td className="text-right">{admin && <Button variant="ghost" onClick={() => setEditing(r)}>Correct</Button>}</Td>
                </tr>
              ))}
            </Table>
            {rows.length === PAGE && <p className="mt-2 text-xs text-amber-700">Showing the latest {PAGE} records. Narrow the date range to see the rest.</p>}
          </>
        )}
      </Card>
      {openEmp && <EmployeePanel employeeId={openEmp} onClose={() => setOpenEmp(null)} />}
      {editing && <CorrectModal row={editing} tz={tz ?? 'UTC'} onClose={() => setEditing(null)} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['attendance'] }) }} />}
    </div>
  )
}
