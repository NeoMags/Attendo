import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, Card, ErrorNote, Field, Input, Skeleton, Table, Td } from '@/components/ui'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Shift { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; working_days: number[]; full_day_minutes: number | null; half_day_minutes: number | null }
type Form = { name: string; start_time: string; end_time: string; grace_minutes: number; working_days: number[]; full_h: string; half_h: string }
const BLANK: Form = { name: '', start_time: '09:00', end_time: '18:00', grace_minutes: 10, working_days: [1, 2, 3, 4, 5, 6], full_h: '', half_h: '' }
const hrs = (m: number | null) => (m === null ? '' : String(m / 60))

export default function Setup() {
  const { companyId } = useAuth()
  const qc = useQueryClient()
  const [dept, setDept] = useState('')
  const [shift, setShift] = useState<Form>(BLANK)
  const [editId, setEditId] = useState<string | null>(null)

  const depts = useQuery({
    queryKey: ['departments', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('id, name').eq('company_id', companyId!).order('name')
      if (error) throw error
      return data
    },
  })
  const shifts = useQuery({
    queryKey: ['shifts', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('shifts').select('id, name, start_time, end_time, grace_minutes, working_days, full_day_minutes, half_day_minutes').eq('company_id', companyId!).order('name')
      if (error) throw error
      return data as Shift[]
    },
  })

  const addDept = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('departments').insert({ company_id: companyId!, name: dept.trim() })
      if (error) throw error
    },
    onSuccess: () => { setDept(''); qc.invalidateQueries({ queryKey: ['departments', companyId] }); qc.invalidateQueries({ queryKey: ['dept-shift', companyId] }) },
  })
  const saveShift = useMutation({
    mutationFn: async () => {
      const full = shift.full_h.trim() === '' ? null : Math.round(Number(shift.full_h) * 60)
      const half = shift.half_h.trim() === '' ? null : Math.round(Number(shift.half_h) * 60)
      if ((full === null) !== (half === null)) throw new Error('Set both the full-day and half-day hours, or leave both empty.')
      if (full !== null && (!Number.isFinite(full) || !Number.isFinite(half!) || half! <= 0 || half! >= full)) throw new Error('Half-day hours must be more than 0 and less than full-day hours.')
      const row = { name: shift.name.trim(), start_time: shift.start_time, end_time: shift.end_time, grace_minutes: shift.grace_minutes, working_days: shift.working_days, full_day_minutes: full, half_day_minutes: half }
      const { error } = editId ? await supabase.from('shifts').update(row).eq('id', editId) : await supabase.from('shifts').insert({ company_id: companyId!, ...row })
      if (error) throw new Error(error.code === '23505' ? 'A shift with that name already exists.' : error.message)
    },
    onSuccess: () => { setShift(BLANK); setEditId(null); qc.invalidateQueries({ queryKey: ['shifts', companyId] }); qc.invalidateQueries({ queryKey: ['dept-shift', companyId] }) },
  })
  const delShift = useMutation({
    mutationFn: async (s: Shift) => {
      const { error } = await supabase.from('shifts').delete().eq('id', s.id)
      if (error) throw new Error(error.code === '23503' ? `"${s.name}" is assigned to employees. Move them to another shift first.` : error.message)
    },
    onSuccess: () => { setEditId(null); setShift(BLANK); qc.invalidateQueries({ queryKey: ['shifts', companyId] }); qc.invalidateQueries({ queryKey: ['dept-shift', companyId] }) },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company first.</p>
  const toggleDay = (d: number) =>
    setShift({ ...shift, working_days: shift.working_days.includes(d) ? shift.working_days.filter((x) => x !== d) : [...shift.working_days, d].sort() })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Departments">
        {depts.isLoading ? <Skeleton /> : (
          <Table head={['Name']} empty={depts.data?.length ? undefined : 'No departments yet.'}>
            {depts.data?.map((d) => <tr key={d.id} className="tr-hoverable"><Td>{d.name}</Td></tr>)}
          </Table>
        )}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); addDept.mutate() }} className="mt-3 flex gap-2">
          <Input required placeholder="New department" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="New department" />
          <Button type="submit" disabled={addDept.isPending}>Add</Button>
        </form>
        <div className="mt-2"><ErrorNote error={addDept.error} /></div>
      </Card>

      <Card title="Shifts">
        {shifts.isLoading ? <Skeleton /> : (
          <Table head={['Name', 'Hours', 'Grace', 'Days', 'Full / half day', '']} empty={shifts.data?.length ? undefined : 'No shifts yet. Late minutes are only calculated for employees with a shift.'}>
            {shifts.data?.map((s) => (
              <tr key={s.id} className="tr-hoverable">
                <Td>{s.name}</Td>
                <Td>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</Td>
                <Td>{s.grace_minutes} min</Td>
                <Td>{s.working_days.map((d) => DAYS[d - 1]).join(' ')}</Td>
                <Td>{s.full_day_minutes === null ? 'Any attendance = full day' : `${hrs(s.full_day_minutes)}h / ${hrs(s.half_day_minutes)}h`}</Td>
                <Td className="space-x-1 whitespace-nowrap text-right">
                  <Button variant="ghost" onClick={() => { setEditId(s.id); setShift({ name: s.name, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5), grace_minutes: s.grace_minutes, working_days: s.working_days, full_h: hrs(s.full_day_minutes), half_h: hrs(s.half_day_minutes) }) }}>Edit</Button>
                  <Button variant="ghost" onClick={() => { if (window.confirm(`Delete shift "${s.name}"?`)) delShift.mutate(s) }}>Delete</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveShift.mutate() }} className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Name"><Input required value={shift.name} onChange={(e) => setShift({ ...shift, name: e.target.value })} /></Field>
            <Field label="Start"><Input required type="time" value={shift.start_time} onChange={(e) => setShift({ ...shift, start_time: e.target.value })} /></Field>
            <Field label="End"><Input required type="time" value={shift.end_time} onChange={(e) => setShift({ ...shift, end_time: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Grace (minutes)"><Input type="number" min={0} max={180} value={shift.grace_minutes} onChange={(e) => setShift({ ...shift, grace_minutes: Math.min(180, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
            <Field label="Full day (hours)" hint="Optional"><Input inputMode="decimal" value={shift.full_h} onChange={(e) => setShift({ ...shift, full_h: e.target.value })} placeholder="e.g. 8" /></Field>
            <Field label="Half day (hours)" hint="Optional"><Input inputMode="decimal" value={shift.half_h} onChange={(e) => setShift({ ...shift, half_h: e.target.value })} placeholder="e.g. 4" /></Field>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Working days (untick a day for the weekly off)">
            {DAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={shift.working_days.includes(i + 1)} onClick={() => toggleDay(i + 1)}
                className={`rounded-md border px-2 py-1 text-xs ${shift.working_days.includes(i + 1) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>{d}</button>
            ))}
          </div>
          <p className="text-xs text-slate-500">Worked at least the full-day hours = 1 day, at least the half-day hours = ½ day, less = not counted. Leave empty to count any attendance as a full day. Changes apply to future payroll runs and re-generated drafts.</p>
          <ErrorNote error={saveShift.error ?? delShift.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={saveShift.isPending || shift.working_days.length === 0}>{editId ? 'Save shift' : 'Add shift'}</Button>
            {editId && <Button type="button" variant="ghost" onClick={() => { setEditId(null); setShift(BLANK) }}>Cancel edit</Button>}
          </div>
        </form>
      </Card>
    </div>
  )
}
