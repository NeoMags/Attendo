import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/roles'
import EmployeeDetails from '@/components/EmployeeDetails'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Skeleton, Table, Td } from '@/components/ui'

interface Emp {
  id: string; employee_code: string; full_name: string; is_active: boolean; preferred_language: string
  departments: { name: string } | null; shifts: { name: string } | null
}

export default function Employees() {
  const { companyId, role } = useAuth()
  const admin = isAdmin(role)
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [resetFor, setResetFor] = useState<Emp | null>(null)
  const [detailsFor, setDetailsFor] = useState<{ id: string; name: string } | null>(null)
  const [search, setSearch] = useState('')

  const list = useQuery({
    queryKey: ['employees', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_code, full_name, is_active, preferred_language, departments(name), shifts(name)')
        .eq('company_id', companyId!)
        .order('employee_code')
      if (error) throw error
      return data as unknown as Emp[]
    },
  })

  const toggle = useMutation({
    mutationFn: async (e: Emp) => {
      const { error } = await supabase.from('employees').update({ is_active: !e.is_active }).eq('id', e.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees', companyId] }),
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select or create a company first.</p>
  const rows = (list.data ?? []).filter((e) => `${e.employee_code} ${e.full_name}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Employees</h1>
        <div className="flex gap-2">
          <Input placeholder="Search ID or name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" aria-label="Search employees" />
          {admin && <Button onClick={() => setAdding(true)}>Add employee</Button>}
        </div>
      </div>
      <Card>
        {list.isLoading ? <Skeleton /> : list.error ? <ErrorNote error={list.error} /> : (
          <Table head={['ID', 'Name', 'Department', 'Shift', 'Status', '']} empty={rows.length ? undefined : 'No employees found.'}>
            {rows.map((e) => (
              <tr key={e.id} className="tr-hoverable">
                <Td className="font-mono">{e.employee_code}</Td>
                <Td>{e.full_name}</Td>
                <Td>{e.departments?.name ?? '—'}</Td>
                <Td>{e.shifts?.name ?? '—'}</Td>
                <Td><Badge tone={e.is_active ? 'good' : 'muted'}>{e.is_active ? 'Active' : 'Inactive'}</Badge></Td>
                <Td className="text-right">
                  {admin && (
                    <span className="inline-flex gap-2">
                      <Button variant="ghost" onClick={() => setDetailsFor({ id: e.id, name: e.full_name })}>Details</Button>
                      <Button variant="ghost" onClick={() => setResetFor(e)}>Reset password</Button>
                      <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(e)}>{e.is_active ? 'Deactivate' : 'Activate'}</Button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={toggle.error} />
      </Card>
      {adding && <AddEmployee companyId={companyId} onClose={() => setAdding(false)} onDone={(created) => { setAdding(false); qc.invalidateQueries({ queryKey: ['employees', companyId] }); setDetailsFor({ id: created.employee_id, name: created.full_name }) }} />}
      {detailsFor && <EmployeeDetails companyId={companyId} employeeId={detailsFor.id} name={detailsFor.name} onClose={() => setDetailsFor(null)} />}
      {resetFor && <ResetPassword emp={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  )
}

function AddEmployee({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: (c: { employee_id: string; full_name: string }) => void }) {
  const [f, setF] = useState({ employee_code: '', full_name: '', password: '', role: 'employee', department_id: '', shift_id: '', preferred_language: 'en' })
  const opts = useQuery({
    queryKey: ['dept-shift', companyId],
    queryFn: async () => {
      const [d, s] = await Promise.all([
        supabase.from('departments').select('id, name').eq('company_id', companyId).order('name'),
        supabase.from('shifts').select('id, name').eq('company_id', companyId).order('name'),
      ])
      if (d.error ?? s.error) throw d.error ?? s.error
      return { depts: d.data ?? [], shifts: s.data ?? [] }
    },
  })
  const m = useMutation({
    mutationFn: () => callFunction<{ employee_id: string }>('admin-create-employee', {
      company_id: companyId, employee_code: f.employee_code.trim(), full_name: f.full_name.trim(), password: f.password,
      role: f.role, department_id: f.department_id || null, shift_id: f.shift_id || null, preferred_language: f.preferred_language,
    }),
    onSuccess: (r) => onDone({ employee_id: r.employee_id, full_name: f.full_name.trim() }),
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="Add employee" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate() }} className="space-y-3">
        <Field label="Employee ID" hint="Used to sign in to the app."><Input required value={f.employee_code} onChange={set('employee_code')} /></Field>
        <Field label="Full name"><Input required value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Temporary password" hint="8–72 characters, letters and digits. The employee must change it at first sign-in."><Input required type="text" autoComplete="off" value={f.password} onChange={set('password')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role"><Select value={f.role} onChange={set('role')}><option value="employee">Employee</option><option value="manager">Manager</option></Select></Field>
          <Field label="Language"><Select value={f.preferred_language} onChange={set('preferred_language')}><option value="en">English</option><option value="kn">ಕನ್ನಡ</option><option value="hi">हिन्दी</option></Select></Field>
          <Field label="Department"><Select value={f.department_id} onChange={set('department_id')}><option value="">—</option>{opts.data?.depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Shift"><Select value={f.shift_id} onChange={set('shift_id')}><option value="">—</option>{opts.data?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <ErrorNote error={m.error} />
        <Button type="submit" disabled={m.isPending} className="w-full">{m.isPending ? 'Creating…' : 'Create employee'}</Button>
      </form>
    </Modal>
  )
}

function ResetPassword({ emp, onClose }: { emp: Emp; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const m = useMutation({ mutationFn: () => callFunction('admin-reset-password', { employee_id: emp.id, new_password: pw }) })
  return (
    <Modal title={`Reset password · ${emp.employee_code}`} onClose={onClose}>
      {m.isSuccess ? (
        <div className="space-y-3"><p className="text-sm">Password reset. {emp.full_name} must choose a new one at next sign-in.</p><Button onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate() }} className="space-y-3">
          <Field label="New temporary password" hint="8–72 characters, letters and digits."><Input required autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <ErrorNote error={m.error} />
          <Button type="submit" disabled={m.isPending} className="w-full">{m.isPending ? 'Resetting…' : 'Reset password'}</Button>
        </form>
      )}
    </Modal>
  )
}
