import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button, Card, ErrorNote, Field, Input, Spinner, Table, Td } from '@/components/ui'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Shift { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; working_days: number[] }

export default function Setup() {
  const { companyId } = useAuth()
  const qc = useQueryClient()
  const [dept, setDept] = useState('')
  const [shift, setShift] = useState({ name: '', start_time: '09:00', end_time: '18:00', grace_minutes: 10, working_days: [1, 2, 3, 4, 5, 6] })

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
      const { data, error } = await supabase.from('shifts').select('id, name, start_time, end_time, grace_minutes, working_days').eq('company_id', companyId!).order('name')
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
  const addShift = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('shifts').insert({ company_id: companyId!, ...shift, name: shift.name.trim() })
      if (error) throw error
    },
    onSuccess: () => { setShift({ ...shift, name: '' }); qc.invalidateQueries({ queryKey: ['shifts', companyId] }); qc.invalidateQueries({ queryKey: ['dept-shift', companyId] }) },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company first.</p>
  const toggleDay = (d: number) =>
    setShift({ ...shift, working_days: shift.working_days.includes(d) ? shift.working_days.filter((x) => x !== d) : [...shift.working_days, d].sort() })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Departments">
        {depts.isLoading ? <Spinner /> : (
          <Table head={['Name']} empty={depts.data?.length ? undefined : 'No departments yet.'}>
            {depts.data?.map((d) => <tr key={d.id}><Td>{d.name}</Td></tr>)}
          </Table>
        )}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); addDept.mutate() }} className="mt-3 flex gap-2">
          <Input required placeholder="New department" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="New department" />
          <Button type="submit" disabled={addDept.isPending}>Add</Button>
        </form>
        <div className="mt-2"><ErrorNote error={addDept.error} /></div>
      </Card>

      <Card title="Shifts">
        {shifts.isLoading ? <Spinner /> : (
          <Table head={['Name', 'Hours', 'Grace', 'Days']} empty={shifts.data?.length ? undefined : 'No shifts yet. Late minutes are only calculated for employees with a shift.'}>
            {shifts.data?.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</Td>
                <Td>{s.grace_minutes} min</Td>
                <Td>{s.working_days.map((d) => DAYS[d - 1]).join(' ')}</Td>
              </tr>
            ))}
          </Table>
        )}
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); addShift.mutate() }} className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Name"><Input required value={shift.name} onChange={(e) => setShift({ ...shift, name: e.target.value })} /></Field>
            <Field label="Start"><Input required type="time" value={shift.start_time} onChange={(e) => setShift({ ...shift, start_time: e.target.value })} /></Field>
            <Field label="End"><Input required type="time" value={shift.end_time} onChange={(e) => setShift({ ...shift, end_time: e.target.value })} /></Field>
          </div>
          <Field label="Grace (minutes)"><Input type="number" min={0} max={180} value={shift.grace_minutes} onChange={(e) => setShift({ ...shift, grace_minutes: Math.min(180, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Working days">
            {DAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={shift.working_days.includes(i + 1)} onClick={() => toggleDay(i + 1)}
                className={`rounded-md border px-2 py-1 text-xs ${shift.working_days.includes(i + 1) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>{d}</button>
            ))}
          </div>
          <ErrorNote error={addShift.error} />
          <Button type="submit" disabled={addShift.isPending || shift.working_days.length === 0}>Add shift</Button>
        </form>
      </Card>
    </div>
  )
}
