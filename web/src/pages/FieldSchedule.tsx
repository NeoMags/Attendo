import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import { isoWeekday, leadingBlanks, monthDays, shiftMonth } from '@/lib/calendar'
import { hhmm, visitStatus, type EnterEvt, type Sched, type VisitStatus } from '@/lib/schedule'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Skeleton } from '@/components/ui'

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Field schedule</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Employee" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="w-52">
            <option value="">All employees</option>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
          <Button onClick={() => setAdding(true)} disabled={!emps.length}>Add visit</Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title={month} actions={<div className="flex gap-1"><Button variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button><Button variant="ghost" onClick={() => { setMonth(today.slice(0, 7)); setSel(today) }}>Today</Button><Button variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))}>›</Button></div>}>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">{DOW.map((d) => <div key={d}>{d}</div>)}</div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlanks(month) }, (_, i) => <div key={`b${i}`} />)}
              {days.map((d) => {
                const n = byDate(d).length
                return (
                  <button key={d} type="button" onClick={() => setSel(d)} aria-label={`${d}, ${n} visits`}
                    className={`flex h-14 flex-col items-center justify-start rounded-md border p-1 text-sm ${d === sel ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'} ${d === today ? 'font-semibold' : ''} ${isoWeekday(d) === 7 ? 'text-red-600' : ''}`}>
                    {Number(d.slice(8))}
                    {n > 0 && <span className="mt-1 rounded-full bg-slate-800 px-1.5 text-[10px] text-white">{n}</span>}
                  </button>
                )
              })}
            </div>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title={sel}>
            {dayRows.length === 0 ? <p className="text-sm text-slate-500">No visits scheduled.</p> : (
              <ul className="space-y-3">
                {dayRows.map((r) => {
                  const st = visitStatus(r, data.data!.enters, today)
                  return (
                    <li key={r.id} className="rounded-md border border-slate-200 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{r.title}</div>
                          <div className="text-xs text-slate-500">{hhmm(r.start_time)}–{hhmm(r.end_time)} · {empName(r.employee_id)}</div>
                          {r.geofence_id && <div className="text-xs text-slate-500">{fences.find((f) => f.id === r.geofence_id)?.name}</div>}
                          {r.notes && <div className="mt-1 text-xs">{r.notes}</div>}
                        </div>
                        <Badge tone={TONE[st]}>{LABEL[st]}</Badge>
                      </div>
                      <button type="button" className="mt-2 text-xs text-red-700 underline" disabled={del.isPending} onClick={() => { if (confirm('Delete this visit?')) del.mutate(r.id) }}>Delete</button>
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
  return (
    <Modal title="Add field visit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Employee"><Select value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}</Select></Field>
        <Field label="Title"><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Site (optional)" hint="Pick a geofence to verify the visit automatically"><Select value={f.fence} onChange={(e) => setF({ ...f, fence: e.target.value })}><option value="">No site</option>{fences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="From"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="To"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        </div>
        {f.end <= f.start && <p className="text-xs text-red-700">End time must be after start time.</p>}
        <Field label="Notes"><Input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={bad || save.isPending}>Save</Button></div>
      </form>
    </Modal>
  )
}
