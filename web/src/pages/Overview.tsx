import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Card, ErrorNote, Spinner, Stat, Table, Td } from '@/components/ui'
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

  const q = useQuery({
    queryKey: ['overview', companyId, today],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [emps, status, att] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId!).eq('is_active', true),
        supabase.from('employee_status_v').select('*').eq('company_id', companyId!),
        supabase.from('attendance').select('id, late_minutes').eq('company_id', companyId!).eq('work_date', today),
      ])
      const err = emps.error ?? status.error ?? att.error
      if (err) throw err
      return { total: emps.count ?? 0, status: (status.data ?? []) as Status[], att: att.data ?? [] }
    },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company to begin.</p>
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorNote error={q.error} />

  const d = q.data!
  const live = d.status.filter((s) => s.is_checked_in)
  const issues = live.filter((s) => s.health_status && s.health_status !== 'healthy')
  const late = d.att.filter((a) => (a.late_minutes ?? 0) > 0).length

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Today · {today}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active employees" value={d.total} />
        <Stat label="Checked in now" value={live.length} tone="good" />
        <Stat label="Late today" value={late} tone={late ? 'warn' : undefined} />
        <Stat label="Device issues" value={issues.length} tone={issues.length ? 'bad' : undefined} />
      </div>
      <Card title="Checked-in employees">
        <Table head={['Employee', 'Since', 'Last location', 'Device health']} empty={live.length ? undefined : 'Nobody is checked in.'}>
          {live.map((s) => (
            <tr key={s.employee_id}>
              <Td>{s.full_name} <span className="text-slate-400">({s.employee_code})</span></Td>
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
    </div>
  )
}
