import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Card, ErrorNote, PersonCell, Spinner, Stat, Table, Td } from '@/components/ui'
import EmployeePanel from '@/components/EmployeePanel'
import { fmtTime, humanAge, todayIn } from '@/lib/format'

interface Status {
  employee_id: string; employee_code: string; full_name: string; is_checked_in: boolean; checked_in_at: string | null
  health_status: 'healthy' | 'degraded' | 'interrupted' | null; health_reasons: string[] | null
  seconds_since_fix: number | null; freshness: string | null
}

const tone = (h: Status['health_status']) => (h === 'interrupted' ? 'bad' : h === 'degraded' ? 'warn' : h === 'healthy' ? 'good' : 'muted')

export default function Overview() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)
  const [openEmp, setOpenEmp] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['overview', companyId, today],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [emps, status, att, lv] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId!).eq('is_active', true),
        supabase.from('employee_status_v').select('*').eq('company_id', companyId!),
        supabase.from('attendance').select('id, employee_id, late_minutes').eq('company_id', companyId!).eq('work_date', today),
        supabase.from('leave_requests').select('employee_id').eq('company_id', companyId!).eq('status', 'approved').lte('start_date', today).gte('end_date', today),
      ])
      const err = emps.error ?? status.error ?? att.error ?? lv.error
      if (err) throw err
      return { total: emps.count ?? 0, status: (status.data ?? []) as Status[], att: att.data ?? [], leave: (lv.data ?? []).map((l) => l.employee_id as string) }
    },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company to begin.</p>
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorNote error={q.error} />

  const d = q.data!
  const live = d.status.filter((s) => s.is_checked_in)
  const issues = live.filter((s) => s.health_status && s.health_status !== 'healthy')
  const late = d.att.filter((a) => (a.late_minutes ?? 0) > 0).length
  const accounted = new Set([...d.att.map((a) => a.employee_id as string), ...d.leave])
  const notIn = Math.max(0, d.total - accounted.size)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Today · {today}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active employees" value={d.total} icon="users" />
        <Stat label="Checked in now" value={live.length} tone="good" icon="check" />
        <Stat label="Not in yet" value={notIn} icon="userx" hint={`${new Set(d.leave).size} on leave`} />
        <Stat label="Late today" value={late} tone={late ? 'warn' : undefined} icon="clock" />
        <Stat label="Device issues" value={issues.length} tone={issues.length ? 'bad' : undefined} icon="alert" />
      </div>
      <Card title="Checked-in employees">
        <Table head={['Employee', 'Since', 'Last location', 'Device health']} empty={live.length ? undefined : 'Nobody is checked in.'}>
          {live.map((s) => (
            <tr key={s.employee_id}>
              <Td><PersonCell name={s.full_name} code={s.employee_code} onClick={() => setOpenEmp(s.employee_id)} /></Td>
              <Td>{fmtTime(s.checked_in_at, tz)}</Td>
              <Td>{humanAge(s.seconds_since_fix)}</Td>
              <Td>
                <Badge tone={tone(s.health_status)}>{s.health_status ?? 'no data'}</Badge>
                {s.health_reasons?.length ? <span className="ml-2 text-xs text-slate-500">{s.health_reasons.join(', ').replaceAll('_', ' ')}</span> : null}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {openEmp && <EmployeePanel employeeId={openEmp} onClose={() => setOpenEmp(null)} />}
    </div>
  )
}
