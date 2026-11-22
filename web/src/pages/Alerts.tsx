import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import { Badge, Card, ErrorNote, Field, Icon, Input, Select, Spinner, Table, Td } from '@/components/ui'

interface Ev {
  id: string; event_type: 'enter' | 'exit'; occurred_at: string; confirmed_at: string
  employees: { full_name: string; employee_code: string } | null; geofences: { name: string; type: string } | null
}
const LIMIT = 500

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export default function Alerts() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)
  const [from, setFrom] = useState(() => addDays(today, -6))
  const [to, setTo] = useState(today)
  const [type, setType] = useState<'all' | 'enter' | 'exit'>('all')
  const bad = from > to

  const q = useQuery({
    queryKey: ['geo-events', companyId, from, to, type], enabled: !!companyId && !bad, refetchInterval: 60_000,
    queryFn: async () => {
      // Inclusive local-day window. Offsets are approximated by +/-1 day padding then filtered by local date below.
      let query = supabase.from('geofence_events')
        .select('id, event_type, occurred_at, confirmed_at, employees(full_name, employee_code), geofences(name, type)')
        .eq('company_id', companyId!)
        .gte('occurred_at', `${addDays(from, -1)}T00:00:00Z`).lte('occurred_at', `${addDays(to, 1)}T23:59:59Z`)
        .order('occurred_at', { ascending: false }).limit(LIMIT)
      if (type !== 'all') query = query.eq('event_type', type)
      const { data, error } = await query
      if (error) throw error
      return (data as unknown as Ev[]).filter((e) => { const d = todayIn(tz, new Date(e.occurred_at)); return d >= from && d <= to })
    },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const rows = q.data ?? []
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: tz })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Icon name="bell" /> Geofence alerts</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="all">Entries and exits</option><option value="enter">Entries</option><option value="exit">Exits</option>
            </Select>
          </Field>
        </div>
      </div>
      {bad && <ErrorNote error={new Error('The start date must not be after the end date.')} />}
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <>
            <Table head={['When', 'Employee', 'Event', 'Place']} empty={rows.length ? undefined : 'No geofence events in this period.'}>
              {rows.map((e) => (
                <tr key={e.id}>
                  <Td>{fmt(e.occurred_at)}</Td>
                  <Td>{e.employees?.full_name} <span className="text-slate-400">({e.employees?.employee_code})</span></Td>
                  <Td><Badge tone={e.event_type === 'enter' ? 'good' : 'warn'}>{e.event_type === 'enter' ? 'Entered' : 'Exited'}</Badge></Td>
                  <Td>{e.geofences?.name} <span className="text-xs text-slate-400">{e.geofences?.type.replace('_', ' ')}</span></Td>
                </tr>
              ))}
            </Table>
            {q.data && q.data.length >= LIMIT && <p className="mt-2 text-xs text-amber-700">Showing the latest {LIMIT} events. Narrow the dates to see the rest.</p>}
          </>
        )}
        <p className="mt-3 text-xs text-slate-500">Events are confirmed on the server from several accurate location fixes, so brief GPS drift is not reported. Times show when the confirming streak began. Push notifications are not enabled yet.</p>
      </Card>
    </div>
  )
}
