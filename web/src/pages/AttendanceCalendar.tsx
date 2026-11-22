import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import { classifyDay, leadingBlanks, monthDays, shiftMonth, type DayKind } from '@/lib/calendar'
import { Button, Card, ErrorNote, Field, Select, Spinner, Stat } from '@/components/ui'

interface Rec { work_date: string; late_minutes: number | null; status: string }
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STYLE: Record<DayKind, string> = {
  leave: 'bg-violet-100 text-violet-900', present: 'bg-emerald-100 text-emerald-900', late: 'bg-amber-100 text-amber-900', open: 'bg-sky-100 text-sky-900',
  absent: 'bg-red-100 text-red-900', off: 'bg-slate-100 text-slate-400', future: 'bg-white text-slate-400',
}
const LABEL: Record<DayKind, string> = { present: 'Present', late: 'Late', open: 'Checked in', leave: 'On leave', absent: 'Absent', off: 'Day off', future: 'Upcoming / pending' }

export default function AttendanceCalendar() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)
  const [ym, setYm] = useState(today.slice(0, 7))
  const [empId, setEmpId] = useState('')

  const emps = useQuery({
    queryKey: ['cal-emps', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, employee_code, full_name, shifts(working_days)').eq('company_id', companyId!).order('full_name')
      if (error) throw error
      return data as unknown as { id: string; employee_code: string; full_name: string; shifts: { working_days: number[] } | null }[]
    },
  })
  const days = useMemo(() => monthDays(ym), [ym])
  const att = useQuery({
    queryKey: ['cal-att', companyId, empId, ym], enabled: !!companyId && !!empId,
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('work_date, late_minutes, status')
        .eq('company_id', companyId!).eq('employee_id', empId).gte('work_date', days[0]).lte('work_date', days[days.length - 1])
      if (error) throw error
      return data as Rec[]
    },
  })

  const leave = useQuery({
    queryKey: ['cal-leave', companyId, empId, ym], enabled: !!companyId && !!empId,
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests').select('start_date, end_date')
        .eq('company_id', companyId!).eq('employee_id', empId).eq('status', 'approved').lte('start_date', days[days.length - 1]).gte('end_date', days[0])
      if (error) throw error
      return data as { start_date: string; end_date: string }[]
    },
  })

  const emp = emps.data?.find((e) => e.id === empId)
  // Without an assigned shift we do not know working days, so absence is not asserted: every no-record past day shows as a day off.
  const workingDays = emp?.shifts?.working_days ?? []
  const byDay = new Map<string, Rec[]>()
  att.data?.forEach((r) => byDay.set(r.work_date, [...(byDay.get(r.work_date) ?? []), r]))
  const kinds = days.map((d) => classifyDay(d, today, workingDays, (byDay.get(d) ?? []).map((r) => ({ late_minutes: r.late_minutes, open: r.status === 'open' })),
    (leave.data ?? []).some((l) => d >= l.start_date && d <= l.end_date)))
  const count = (k: DayKind) => kinds.filter((x) => x === k).length
  const monthLabel = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Attendance calendar</h1>
        <div className="flex items-end gap-2">
          <Field label="Employee">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)} className="w-56">
              <option value="">Select…</option>
              {emps.data?.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </Select>
          </Field>
          <Button variant="ghost" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}>‹</Button>
          <span className="w-36 pb-2 text-center text-sm font-medium">{monthLabel}</span>
          <Button variant="ghost" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}>›</Button>
        </div>
      </div>
      <ErrorNote error={emps.error ?? att.error ?? leave.error} />
      {!empId ? <Card><p className="py-8 text-center text-sm text-slate-500">Choose an employee to see their month.</p></Card> : att.isLoading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Present" value={count('present') + count('late') + count('open')} tone="good" icon="check" />
            <Stat label="Late" value={count('late')} tone={count('late') ? 'warn' : undefined} icon="clock" />
            <Stat label="Absent" value={count('absent')} tone={count('absent') ? 'bad' : undefined} icon="userx" />
            <Stat label="On leave" value={count('leave')} icon="calendar" hint={`${count('off')} days off`} />
          </div>
          <Card>
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
              {WD.map((w) => <div key={w} className="pb-1 font-medium text-slate-500">{w}</div>)}
              {Array.from({ length: leadingBlanks(ym) }, (_, i) => <div key={`b${i}`} />)}
              {days.map((d, i) => (
                <div key={d} title={`${d}: ${LABEL[kinds[i]]}`} className={`rounded-md py-3 text-sm ${STYLE[kinds[i]]} ${d === today ? 'ring-2 ring-amber-400' : ''}`}>{Number(d.slice(8))}</div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600">
              {(Object.keys(LABEL) as DayKind[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${STYLE[k]} border border-slate-200`} />{LABEL[k]}</span>)}
            </div>
            {!workingDays.length && <p className="mt-3 text-xs text-amber-700">This employee has no shift assigned, so working days are unknown and absences are not shown.</p>}
            <p className="mt-2 text-xs text-slate-500">Approved leave is shown. Public holidays are not tracked yet, so a holiday on a working day shows as absent.</p>
          </Card>
        </>
      )}
    </div>
  )
}
