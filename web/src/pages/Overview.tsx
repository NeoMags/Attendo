import { lazy, Suspense } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Button, Card, ErrorNote, PersonCell, Select, Skeleton, Stat, Table, Td, type IconName } from '@/components/ui'
import { CARD_CATALOG, DEFAULT_CARDS, moveCard, normalizeLayout, replaceCard, type CardId } from '@/lib/cards'
import EmployeePanel from '@/components/EmployeePanel'
import { fmtTime, humanAge, todayIn } from '@/lib/format'

const AttendanceTrendChart = lazy(() => import('@/components/AttendanceTrendChart'))

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
  const [editing, setEditing] = useState(false)
  const { session } = useAuth()
  const uid = session?.user.id
  const qc = useQueryClient()
  const prefs = useQuery({
    queryKey: ['prefs', uid], enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_prefs').select('notif_seen_at, dashboard_cards').maybeSingle()
      if (error) throw error
      return data as { notif_seen_at: string | null; dashboard_cards: unknown } | null
    },
  })
  const saveLayout = useMutation({
    mutationFn: async (cards: CardId[]) => {
      const { error } = await supabase.from('user_prefs').upsert({ user_id: uid!, dashboard_cards: cards }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs', uid] }),
  })
  const layout = normalizeLayout(prefs.data?.dashboard_cards)

  const q = useQuery({
    queryKey: ['overview', companyId, today],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
      const from7 = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 6)).toISOString().slice(0, 10)
      const [emps, status, att, lv, pend, week, exits, recent] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId!).eq('is_active', true),
        supabase.from('employee_status_v').select('*').eq('company_id', companyId!),
        supabase.from('attendance').select('id, employee_id, late_minutes, status').eq('company_id', companyId!).eq('work_date', today),
        supabase.from('leave_requests').select('employee_id').eq('company_id', companyId!).eq('status', 'approved').lte('start_date', today).gte('end_date', today),
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId!).in('status', ['pending', 'manager_approved']),
        supabase.from('attendance').select('work_date, late_minutes').eq('company_id', companyId!).gte('work_date', from7).lte('work_date', today),
        supabase.from('geofence_events').select('occurred_at').eq('company_id', companyId!).eq('event_type', 'exit').gte('occurred_at', since),
        supabase.from('notifications').select('id, title, body, created_at').eq('company_id', companyId!).eq('kind', 'geofence_exit').order('created_at', { ascending: false }).limit(5),
      ])
      const err = emps.error ?? status.error ?? att.error ?? lv.error ?? pend.error ?? week.error ?? exits.error ?? recent.error
      if (err) throw err
      const days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) - 6 + i)).toISOString().slice(0, 10))
      const trend = days.map((d) => {
        const rows = (week.data ?? []).filter((r) => r.work_date === d)
        const late = rows.filter((r) => (r.late_minutes ?? 0) > 0).length
        return { day: d.slice(5), onTime: rows.length - late, late }
      })
      return {
        pendingLeave: pend.count ?? 0,
        exitsToday: (exits.data ?? []).filter((e) => todayIn(tz, new Date(e.occurred_at as string)) === today).length,
        trend, recent: (recent.data ?? []) as { id: string; title: string; body: string | null; created_at: string }[],
        total: emps.count ?? 0, status: (status.data ?? []) as Status[], att: att.data ?? [], leave: (lv.data ?? []).map((l) => l.employee_id as string) }
    },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company to begin.</p>
  if (q.isLoading) return <Skeleton />
  if (q.error) return <ErrorNote error={q.error} />

  const d = q.data!
  const live = d.status.filter((s) => s.is_checked_in)
  const issues = live.filter((s) => s.health_status && s.health_status !== 'healthy')
  const late = d.att.filter((a) => (a.late_minutes ?? 0) > 0).length
  const accounted = new Set([...d.att.map((a) => a.employee_id as string), ...d.leave])
  const absent = Math.max(0, d.total - accounted.size)
  const onLeave = new Set(d.leave).size
  const checkedOut = d.att.filter((a) => a.status === 'closed').length
  const present = new Set(d.att.map((a) => a.employee_id as string)).size
  const cardView: Record<CardId, { value: React.ReactNode; tone?: 'warn' | 'bad' | 'good'; icon: IconName; hint?: string }> = {
    active: { value: d.total, icon: 'users' },
    checked_in: { value: live.length, tone: 'good', icon: 'check' },
    absent: { value: absent, icon: 'userx', hint: `${onLeave} on leave` },
    on_leave: { value: onLeave, icon: 'calendar' },
    late: { value: late, tone: late ? 'warn' : undefined, icon: 'clock' },
    checked_out: { value: checkedOut, icon: 'check' },
    attendance_pct: { value: d.total ? `${Math.round((present / d.total) * 100)}%` : '—', icon: 'users', hint: `${present} of ${d.total}` },
    device_issues: { value: issues.length, tone: issues.length ? 'bad' : undefined, icon: 'alert' },
    pending_leave: { value: d.pendingLeave, tone: d.pendingLeave ? 'warn' : undefined, icon: 'calendar' },
    exits_today: { value: d.exitsToday, tone: d.exitsToday ? 'warn' : undefined, icon: 'pin' },
  }
  const label = (id: CardId) => CARD_CATALOG.find((c) => c.id === id)!.label
  const unused = CARD_CATALOG.filter((c) => !layout.includes(c.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Today · {today}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {editing && unused.length > 0 && (
            <Select aria-label="Add card" value="" onChange={(e) => e.target.value && saveLayout.mutate([...layout, e.target.value as CardId])} className="w-48">
              <option value="">+ Add a card…</option>
              {unused.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          )}
          {editing && <Button variant="ghost" onClick={() => saveLayout.mutate(DEFAULT_CARDS)}>Reset</Button>}
          <Button variant={editing ? 'primary' : 'ghost'} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Customize'}</Button>
        </div>
      </div>
      {saveLayout.error && <ErrorNote error={saveLayout.error} />}
      {layout.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">No cards selected. Use Customize to add some.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {layout.map((id) => (
          <div key={id} className="space-y-1">
            <Stat label={label(id)} {...cardView[id]} />
            {editing && (
              <div className="flex items-center gap-1 text-xs">
                <button type="button" aria-label={`Move ${label(id)} earlier`} className="rounded border px-1.5 py-0.5" onClick={() => saveLayout.mutate(moveCard(layout, id, -1))}>◀</button>
                <button type="button" aria-label={`Move ${label(id)} later`} className="rounded border px-1.5 py-0.5" onClick={() => saveLayout.mutate(moveCard(layout, id, 1))}>▶</button>
                <select aria-label={`Replace ${label(id)}`} value="" className="min-w-0 flex-1 rounded border px-1 py-0.5"
                  onChange={(e) => e.target.value && saveLayout.mutate(replaceCard(layout, id, e.target.value as CardId))}>
                  <option value="">Replace…</option>
                  {unused.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button type="button" aria-label={`Remove ${label(id)}`} className="rounded border px-1.5 py-0.5 text-red-700" onClick={() => saveLayout.mutate(layout.filter((c) => c !== id))}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Last 7 days: attendance">
            <div className="h-56">
              <Suspense fallback={<Skeleton />}><AttendanceTrendChart data={d.trend} /></Suspense>
            </div>
          </Card>
        </div>
        <Card title="Recent location exits">
          {d.recent.length === 0 ? <p className="text-sm text-slate-500">No exits recorded.</p> : (
            <ul className="space-y-2 text-sm">
              {d.recent.map((r) => (
                <li key={r.id}><div className="font-medium">{r.title}</div><div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</div></li>
              ))}
            </ul>
          )}
        </Card>
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
