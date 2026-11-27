import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import { isoWeekday, leadingBlanks, monthDays, shiftMonth } from '@/lib/calendar'
import { hhmm, visitStatus, type EnterEvt, type Sched, type VisitStatus } from '@/lib/schedule'
import { Badge, Button, Card, ErrorNote, Field, Icon, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '@/components/ui'

interface Emp { id: string; full_name: string; employee_code: string }
interface Fence { id: string; name: string }
interface Row extends Sched { notes: string | null }

const TONE: Record<VisitStatus, 'good' | 'warn' | 'bad' | 'muted'> = { visited: 'good', missed: 'bad', pending: 'warn', no_site: 'muted' }
const LABEL: Record<VisitStatus, string> = { visited: 'Visited', missed: 'Missed', pending: 'Upcoming', no_site: 'No site set' }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function FieldSchedule() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const today = todayIn(tz)
  const qc = useQueryClient()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [sel, setSel] = useState(today)
  const [empFilter, setEmpFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const days = monthDays(month)

  const base = useQuery({
    queryKey: ['sched-base', companyId], enabled: !!companyId,
    queryFn: async () => {
      const [e, g] = await Promise.all([
        supabase.from('employees').select('id, full_name, employee_code').eq('company_id', companyId!).eq('is_active', true).order('full_name'),
        supabase.from('geofences').select('id, name').eq('company_id', companyId!).eq('is_active', true).order('name'),
      ])
      if (e.error ?? g.error) throw (e.error ?? g.error)
      return { emps: (e.data ?? []) as Emp[], fences: (g.data ?? []) as Fence[] }
    },
  })

  const data = useQuery({
    queryKey: ['sched', companyId, month], enabled: !!companyId,
    queryFn: async () => {
      const first = days[0], last = days[days.length - 1]
      // events are fetched with a one-day margin either side because the company-local date is resolved client-side
      const lo = new Date(Date.parse(`${first}T00:00:00Z`) - 86400000).toISOString()
      const hi = new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86400000).toISOString()
      const [s, ev] = await Promise.all([
        supabase.from('field_schedules').select('id, employee_id, geofence_id, title, schedule_date, start_time, end_time, notes')
          .eq('company_id', companyId!).gte('schedule_date', first).lte('schedule_date', last).order('start_time'),
        supabase.from('geofence_events').select('employee_id, geofence_id, confirmed_at').eq('company_id', companyId!).eq('event_type', 'enter').gte('confirmed_at', lo).lte('confirmed_at', hi),
      ])
      if (s.error ?? ev.error) throw (s.error ?? ev.error)
      const enters: EnterEvt[] = (ev.data ?? []).map((e) => ({ employee_id: e.employee_id as string, geofence_id: e.geofence_id as string, date: todayIn(tz, new Date(e.confirmed_at as string)) }))
      return { rows: (s.data ?? []) as Row[], enters }
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('field_schedules').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sched', companyId, month] }),
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  if (base.isLoading || data.isLoading) return <Skeleton />
  if (base.error || data.error) return <ErrorNote error={base.error ?? data.error} />

  const emps = base.data!.emps, fences = base.data!.fences
  const empName = (id: string) => emps.find((e) => e.id === id)?.full_name ?? 'Unknown'
  const rows = data.data!.rows.filter((r) => !empFilter || r.employee_id === empFilter)
  const byDate = (d: string) => rows.filter((r) => r.schedule_date === d)
  const dayRows = byDate(sel)

  const selLabel = new Date(`${sel}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div>
      <PageHeader
        title="Field schedule"
        description="Plan site visits for your field team. Visits tied to a geofence are marked visited automatically when the employee arrives."
        actions={
          <>
            <Select aria-label="Filter by employee" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="!w-52">
              <option value="">All employees</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
            <Button onClick={() => setAdding(true)} disabled={!emps.length}>
              <Icon name="calendar-clock" size={16} /> Add visit
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card
            title={monthLabel}
            actions={
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
                <Button variant="ghost" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setSel(today) }}>Today</Button>
                <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
              </div>
            }
          >
            <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {DOW.map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: leadingBlanks(month) }, (_, i) => <div key={`b${i}`} />)}
              {days.map((d) => {
                const n = byDate(d).length
                const isSel = d === sel
                const isToday = d === today
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSel(d)}
                    aria-label={`${d}, ${n} visits`}
                    aria-pressed={isSel}
                    className="relative flex h-16 flex-col items-start justify-between rounded-lg border p-2 text-left text-sm transition-colors"
                    style={{
                      background: isSel ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                      borderColor: isSel ? 'var(--color-accent)' : 'var(--color-border)',
                      color: isSel ? '#fff' : isoWeekday(d) === 7 ? 'var(--color-bad)' : 'var(--color-text-primary)',
                    }}
                  >
                    <span className={isToday ? 'font-bold' : 'font-medium'}>{Number(d.slice(8))}</span>
                    {isToday && !isSel && <span aria-hidden className="absolute right-2 top-2.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-signal)' }} />}
                    {n > 0 && (
                      <span className="text-[11px] font-semibold" style={{ color: isSel ? 'rgba(255,255,255,0.9)' : 'var(--color-accent)' }}>
                        {n} {n === 1 ? 'visit' : 'visits'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card title={selLabel}>
            {dayRows.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium">Nothing scheduled</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Add a visit to plan this day.</p>
                <Button variant="ghost" size="sm" className="mt-4" onClick={() => setAdding(true)} disabled={!emps.length}>Add visit</Button>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {dayRows.map((r) => {
                  const st = visitStatus(r, data.data!.enters, today)
                  return (
                    <li key={r.id} className="rounded-lg border p-3.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold leading-snug">{r.title}</div>
                          <div className="mt-0.5 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                            {hhmm(r.start_time)} – {hhmm(r.end_time)} · {empName(r.employee_id)}
                          </div>
                          {r.geofence_id && (
                            <div className="mt-1 inline-flex items-center gap-1 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                              <Icon name="map-pin" size={13} /> {fences.find((f) => f.id === r.geofence_id)?.name}
                            </div>
                          )}
                          {r.notes && <p className="mt-1.5 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>{r.notes}</p>}
                        </div>
                        <Badge tone={TONE[st]}>{LABEL[st]}</Badge>
                      </div>
                      <button
                        type="button"
                        className="mt-2.5 text-[13px] font-medium hover:underline disabled:opacity-50"
                        style={{ color: 'var(--color-bad)' }}
                        disabled={del.isPending}
                        onClick={() => { if (confirm('Delete this visit?')) del.mutate(r.id) }}
                      >
                        Delete visit
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {del.error && <ErrorNote error={del.error} />}
          </Card>
        </div>
      </div>
      {adding && <AddVisit companyId={companyId} date={sel} emps={emps} fences={fences} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ['sched', companyId, month] }) }} />}
    </div>
  )
}

function AddVisit({ companyId, date, emps, fences, onClose, onSaved }: { companyId: string; date: string; emps: Emp[]; fences: Fence[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ employee: emps[0]?.id ?? '', fence: '', title: '', date, start: '09:00', end: '10:00', notes: '' })
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('field_schedules').insert({
        company_id: companyId, employee_id: f.employee, geofence_id: f.fence || null, title: f.title.trim(),
        schedule_date: f.date, start_time: f.start, end_time: f.end, notes: f.notes.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: onSaved,
  })
  const bad = !f.title.trim() || !f.employee || f.end <= f.start
  const submit = (e: FormEvent) => { e.preventDefault(); if (!bad) save.mutate() }
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const dur = mins(f.end) - mins(f.start)
  const durLabel = dur > 0 ? `${dur >= 60 ? `${Math.floor(dur / 60)} h ` : ''}${dur % 60 ? `${dur % 60} min` : ''}`.trim() : ''
  return (
    <Modal
      title="Add field visit"
      description="Schedule a site visit for an employee."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-visit-form" loading={save.isPending} disabled={bad}>Save visit</Button>
        </>
      }
    >
      <form id="add-visit-form" onSubmit={submit}>
        <div className="form-group">
          <Field label="Employee">
            <Select value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </Select>
          </Field>
          <Field label="Visit title">
            <Input value={f.title} maxLength={120} placeholder="e.g. Client site inspection" onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        </div>

        <div className="form-group">
          <div className="form-group-title">Where</div>
          <Field label="Site" hint="Optional. Choose a geofence and the visit is marked visited when the employee arrives.">
            <Select value={f.fence} onChange={(e) => setF({ ...f, fence: e.target.value })}>
              <option value="">No site</option>
              {fences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="form-group">
          <div className="form-group-title">When</div>
          <Field label="Date">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <div className="time-range">
            <Field label="Start"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <span aria-hidden className="time-range-sep">→</span>
            <Field label="End"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
          {f.end <= f.start
            ? <p role="alert" className="field-hint" style={{ color: 'var(--color-bad)' }}>End time must be after the start time.</p>
            : <p className="field-hint">Duration: {durLabel}</p>}
        </div>

        <div className="form-group">
          <Field label="Notes" hint="Optional.">
            <Textarea value={f.notes} maxLength={500} rows={3} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        {save.error && <ErrorNote error={save.error} />}
      </form>
    </Modal>
  )
}
