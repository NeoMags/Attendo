import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { humanAge } from '@/lib/format'
import { Badge, Card, ErrorNote, PersonCell, Skeleton, Stat, Table, Td } from '@/components/ui'
import EmployeePanel from '@/components/EmployeePanel'

interface Row {
  employee_id: string; employee_code: string; full_name: string; is_checked_in: boolean
  health_status: 'healthy' | 'degraded' | 'interrupted' | null; health_reasons: string[] | null
  last_battery: number | null; last_heartbeat_at: string | null; seconds_since_fix: number | null
}
const tone = (h: Row['health_status']) => (h === 'interrupted' ? 'bad' : h === 'degraded' ? 'warn' : h === 'healthy' ? 'good' : 'muted')
const rank = (r: Row) => (r.health_status === 'interrupted' ? 0 : r.health_status === 'degraded' ? 1 : r.health_status == null ? 2 : 3)

export default function Devices() {
  const { companyId } = useAuth()
  const [openEmp, setOpenEmp] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['devices', companyId], enabled: !!companyId, refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_status_v')
        .select('employee_id, employee_code, full_name, is_checked_in, health_status, health_reasons, last_battery, last_heartbeat_at, seconds_since_fix')
        .eq('company_id', companyId!)
      if (error) throw error
      return (data as Row[]).sort((a, b) => Number(b.is_checked_in) - Number(a.is_checked_in) || rank(a) - rank(b) || a.full_name.localeCompare(b.full_name))
    },
  })
  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  if (q.isLoading) return <Skeleton />
  if (q.error) return <ErrorNote error={q.error} />
  const live = q.data!.filter((r) => r.is_checked_in)
  const count = (h: Row['health_status']) => live.filter((r) => r.health_status === h).length

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Device health</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Checked in" value={live.length} icon="users" />
        <Stat label="Healthy" value={count('healthy')} tone="good" icon="check" />
        <Stat label="Degraded" value={count('degraded')} tone={count('degraded') ? 'warn' : undefined} icon="battery" />
        <Stat label="Interrupted" value={count('interrupted')} tone={count('interrupted') ? 'bad' : undefined} icon="alert" />
      </div>
      <Card title="Employees (checked-in first, problems first)">
        <Table head={['Employee', 'Checked in', 'Health', 'Battery', 'Last heartbeat', 'Last fix']} empty={q.data!.length ? undefined : 'No employees.'}>
          {q.data!.map((r) => (
            <tr key={r.employee_id} className="tr-hoverable">
              <Td><PersonCell name={r.full_name} code={r.employee_code} onClick={() => setOpenEmp(r.employee_id)} /></Td>
              <Td>{r.is_checked_in ? 'Yes' : 'No'}</Td>
              <Td>
                <Badge tone={tone(r.health_status)}>{r.health_status ?? 'no data'}</Badge>
                {r.health_reasons?.length ? <span className="ml-2 text-xs text-slate-500">{r.health_reasons.join(', ').replaceAll('_', ' ')}</span> : null}
              </Td>
              <Td>{r.last_battery != null ? `${r.last_battery}%` : '—'}</Td>
              <Td>{r.last_heartbeat_at ? humanAge((Date.now() - Date.parse(r.last_heartbeat_at)) / 1000) : 'never'}</Td>
              <Td>{humanAge(r.seconds_since_fix)}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-slate-500">"No data" means the device has not reported, not that anything is wrong. Reasons come from what the phone itself reports.</p>
      </Card>
      {openEmp && <EmployeePanel employeeId={openEmp} onClose={() => setOpenEmp(null)} />}
    </div>
  )
}
