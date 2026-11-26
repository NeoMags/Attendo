import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/roles'
import { Button, Card, ErrorNote, Field, Select, Skeleton, Table, Td } from '@/components/ui'

interface Emp { id: string; employee_code: string; full_name: string; user_id: string | null; is_active: boolean }
interface Link { manager_employee_id: string; employee_id: string }

export default function Team() {
  const { companyId, role } = useAuth()
  const admin = isAdmin(role)
  const qc = useQueryClient()
  const [mgr, setMgr] = useState('')
  const [pick, setPick] = useState('')

  const data = useQuery({
    queryKey: ['team', companyId], enabled: !!companyId,
    queryFn: async () => {
      const [emps, roles, links] = await Promise.all([
        supabase.from('employees').select('id, employee_code, full_name, user_id, is_active').eq('company_id', companyId!).order('full_name'),
        supabase.from('user_roles').select('user_id, role').eq('company_id', companyId!).eq('role', 'manager'),
        supabase.from('manager_assignments').select('manager_employee_id, employee_id').eq('company_id', companyId!),
      ])
      const err = emps.error ?? roles.error ?? links.error
      if (err) throw err
      return { emps: emps.data as Emp[], managerUsers: new Set((roles.data ?? []).map((r) => r.user_id as string)), links: links.data as Link[] }
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['team', companyId] })
  const assign = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('manager_assignments').insert({ company_id: companyId!, manager_employee_id: mgr, employee_id: pick }); if (error) throw new Error(error.code === '23505' ? 'Already assigned.' : error.message) },
    onSuccess: () => { setPick(''); refresh() },
  })
  const remove = useMutation({
    mutationFn: async (employeeId: string) => { const { error } = await supabase.from('manager_assignments').delete().eq('manager_employee_id', mgr).eq('employee_id', employeeId); if (error) throw error },
    onSuccess: refresh,
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  if (data.isLoading) return <Skeleton />
  if (data.error) return <ErrorNote error={data.error} />
  const { emps, managerUsers, links } = data.data!
  const managers = emps.filter((e) => e.user_id && managerUsers.has(e.user_id))
  const byId = new Map(emps.map((e) => [e.id, e]))
  const assigned = links.filter((l) => l.manager_employee_id === mgr).map((l) => byId.get(l.employee_id)).filter((e): e is Emp => !!e)
  const assignedIds = new Set(assigned.map((e) => e.id))
  const candidates = emps.filter((e) => e.is_active && e.id !== mgr && !assignedIds.has(e.id) && !(e.user_id && managerUsers.has(e.user_id)))

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Manager teams</h1>
      <p className="text-sm text-slate-600">A manager sees attendance, locations and reports only for the employees assigned to them. Create managers on the Employees page with role "Manager".</p>
      <Card>
        <Field label="Manager">
          <Select value={mgr} onChange={(e) => setMgr(e.target.value)}>
            <option value="">{managers.length ? 'Select a manager…' : 'No managers yet'}</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}
          </Select>
        </Field>
        {mgr && (
          <div className="mt-4 space-y-3">
            <Table head={['Assigned employee', '']} empty={assigned.length ? undefined : 'Nobody assigned yet.'}>
              {assigned.map((e) => <tr key={e.id} className="tr-hoverable"><Td>{e.full_name} <span className="text-slate-400">({e.employee_code})</span></Td><Td className="text-right">{admin && <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>Remove</Button>}</Td></tr>)}
            </Table>
            {admin && (
              <div className="flex items-end gap-2">
                <div className="flex-1"><Field label="Add employee"><Select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{candidates.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}</Select></Field></div>
                <Button disabled={!pick || assign.isPending} onClick={() => assign.mutate()}>Assign</Button>
              </div>
            )}
            <ErrorNote error={assign.error ?? remove.error} />
          </div>
        )}
      </Card>
    </div>
  )
}
