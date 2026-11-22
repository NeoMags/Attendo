import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtDuration, fmtTime, humanAge, todayIn } from '@/lib/format'
import { summarize, type TrackPoint } from '@/lib/route'
import { shiftSeconds, underOver } from '@/lib/worktime'
import { Avatar, Badge, ErrorNote, Icon, Spinner, type IconName } from '@/components/ui'

interface Emp {
  id: string; employee_code: string; full_name: string
  departments: { name: string } | null; shifts: { name: string; start_time: string; end_time: string } | null
}
interface Att { id: string; check_in_at: string; check_out_at: string | null; late_minutes: number | null; worked_seconds: number | null; status: string }
interface Live {
  is_checked_in: boolean; health_status: 'healthy' | 'degraded' | 'interrupted' | null; last_battery: number | null
  seconds_since_fix: number | null; last_lat: number | null; last_lng: number | null
}
interface Rec { latitude: number; longitude: number; accuracy: number | null; is_mock: boolean; recorded_at: string }
const PAGE = 1000, MAX_PAGES = 5

function Tile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon name={icon} className="h-4 w-4" />{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  )
}

/** Read-only summary of one employee's day. Opening it records a route-history audit entry because it reads location history. */
export default function EmployeePanel({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = useQuery({
    queryKey: ['emp-panel', companyId, employeeId, today],
    enabled: !!companyId,
    queryFn: async () => {
      const [emp, att, live] = await Promise.all([
        supabase.from('employees').select('id, employee_code, full_name, departments(name), shifts(name, start_time, end_time)').eq('id', employeeId).single(),
        supabase.from('attendance').select('id, check_in_at, check_out_at, late_minutes, worked_seconds, status').eq('company_id', companyId!).eq('employee_id', employeeId).eq('work_date', today).order('check_in_at'),
        supabase.from('employee_status_v').select('is_checked_in, health_status, last_battery, seconds_since_fix, last_lat, last_lng').eq('employee_id', employeeId).maybeSingle(),
      ])
      const err = emp.error ?? att.error ?? live.error
      if (err) throw err
      const rows = att.data as Att[]
      let distanceM: number | null = null, partial = false
      if (rows.length) {
        void supabase.rpc('log_admin_access', { p_action: 'route_history', p_employee_id: employeeId, p_details: { date: today, source: 'employee_panel' } })
          .then(({ error }) => { if (error) console.warn('audit log failed', error.message) })
        const from = rows[0].check_in_at, to = rows[rows.length - 1].check_out_at ?? new Date().toISOString()
        const recs: Rec[] = []
        for (let p = 0; p < MAX_PAGES; p++) {
          const { data, error } = await supabase.from('location_records').select('latitude, longitude, accuracy, is_mock, recorded_at')
            .eq('company_id', companyId!).eq('employee_id', employeeId).gte('recorded_at', from).lte('recorded_at', to)
            .order('recorded_at').range(p * PAGE, p * PAGE + PAGE - 1)
          if (error) throw error
          recs.push(...(data as Rec[]))
          if (data.length < PAGE) break
          if (p === MAX_PAGES - 1) partial = true
        }
        const pts: TrackPoint[] = recs.map((r) => ({ lat: r.latitude, lng: r.longitude, t: Date.parse(r.recorded_at), accuracy: r.accuracy, isMock: r.is_mock }))
        distanceM = summarize(pts).distanceM
      }
      return { emp: emp.data as unknown as Emp, att: rows, live: live.data as Live | null, distanceM, partial }
    },
  })

  const d = q.data
  const first = d?.att[0], last = d?.att[d.att.length - 1]
  const late = d?.att.reduce((m, a) => Math.max(m, a.late_minutes ?? 0), 0) ?? 0
  const worked = d && d.att.length && d.att.every((a) => a.worked_seconds != null) ? d.att.reduce((s, a) => s + (a.worked_seconds ?? 0), 0) : null
  const shiftS = d?.emp.shifts ? shiftSeconds(d.emp.shifts.start_time, d.emp.shifts.end_time) : null
  const uo = underOver(worked, shiftS)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Employee summary" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            {d && <Avatar name={d.emp.full_name} size="lg" />}
            <div>
              <h2 className="text-base font-semibold">{d?.emp.full_name ?? 'Employee'}</h2>
              {d && <p className="text-xs text-slate-500">{d.emp.employee_code}{d.emp.departments ? ` · ${d.emp.departments.name}` : ''}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : d && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={d.live?.is_checked_in ? 'good' : 'muted'}>{d.live?.is_checked_in ? 'Checked in' : d.att.length ? 'Checked out' : 'Not in today'}</Badge>
              {d.live?.is_checked_in && d.live.health_status && <Badge tone={d.live.health_status === 'healthy' ? 'good' : d.live.health_status === 'degraded' ? 'warn' : 'bad'}>{d.live.health_status}</Badge>}
              {d.emp.shifts && <span className="text-slate-500">Shift: {d.emp.shifts.name} ({d.emp.shifts.start_time.slice(0, 5)}–{d.emp.shifts.end_time.slice(0, 5)})</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile icon="check" label="Check-in" value={fmtTime(first?.check_in_at, tz)} />
              <Tile icon="clock" label="Check-out" value={last?.check_out_at ? fmtTime(last.check_out_at, tz) : '—'} />
              <Tile icon="clock" label="Worked" value={worked != null ? fmtDuration(worked) : d.att.length ? 'In progress' : '—'} />
              <Tile icon="alert" label="Late" value={late ? `${late} min` : d.att.length ? 'On time' : '—'} />
              <Tile icon="clock" label="Under (vs shift)" value={uo ? fmtDuration(uo.underS) : '—'} />
              <Tile icon="clock" label="Over (vs shift)" value={uo ? fmtDuration(uo.overS) : '—'} />
              <Tile icon="route" label="Distance today" value={d.distanceM != null ? `${(d.distanceM / 1000).toFixed(1)} km${d.partial ? '+' : ''}` : '—'} />
              <Tile icon="battery" label="Battery" value={d.live?.last_battery != null ? `${d.live.last_battery}%` : '—'} />
            </div>
            <p className="text-xs text-slate-500">
              Under/over compare worked time with the shift length and ignore unpaid breaks. Distance is filtered for GPS jumps and stops{d.partial ? '; only the first part of the day was read' : ''}.
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Icon name="pin" className="h-4 w-4" />
              Last location {humanAge(d.live?.seconds_since_fix)}
            </div>
            <Link to={`/routes?emp=${employeeId}&date=${today}`} onClick={onClose} className="inline-flex rounded-md bg-amber-400 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-amber-300">View route history</Link>
          </div>
        )}
      </aside>
    </div>
  )
}
