import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/roles'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PersonCell, Select, Spinner, Table, Td } from '@/components/ui'

type Status = 'pending' | 'manager_approved' | 'approved' | 'rejected' | 'cancelled'
interface Req {
  id: string; employee_id: string; start_date: string; end_date: string; days: number; is_half_day: boolean; reason: string | null
  status: Status; is_paid: boolean | null; manager_note: string | null; decision_note: string | null; created_at: string
  employees: { full_name: string; employee_code: string } | null; leave_types: { name: string; is_paid: boolean } | null
}
interface LType { id: string; name: string; annual_quota_days: number | null; is_paid: boolean; is_active: boolean }

const LABEL: Record<Status, string> = { pending: 'Pending', manager_approved: 'Manager approved', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const TONE: Record<Status, 'good' | 'warn' | 'bad' | 'muted'> = { pending: 'warn', manager_approved: 'warn', approved: 'good', rejected: 'bad', cancelled: 'muted' }
const ERR: Record<string, string> = {
  FORBIDDEN: 'You cannot act on this request.', SELF_APPROVAL_NOT_ALLOWED: 'You cannot approve your own leave.',
  INVALID_STATE: 'This request was already decided or has moved on. Refresh the list.', NOTE_REQUIRED: 'Enter a reason (at least 3 characters) when rejecting.',
  LEAVE_NOT_FOUND: 'Request not found.',
}
const friendly = (m: string) => { const k = Object.keys(ERR).find((c) => m.includes(c)); return k ? ERR[k] : m }
const range = (r: Req) => (r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`)

function RequestLimit({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const [val, setVal] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['company-settings', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('company_settings').select('monthly_leave_request_limit').eq('company_id', companyId).maybeSingle()
      if (error) throw error
      return (data?.monthly_leave_request_limit ?? null) as number | null
    },
  })
  const save = useMutation({
    mutationFn: async () => {
      const t = (val ?? '').trim()
      const n = t === '' ? null : Number(t)
      if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 31)) throw new Error('Enter a whole number from 0 to 31, or leave empty for no limit.')
      const { error } = await supabase.from('company_settings').upsert({ company_id: companyId, monthly_leave_request_limit: n }, { onConflict: 'company_id' })
      if (error) throw error
    },
    onSuccess: () => { setVal(null); void qc.invalidateQueries({ queryKey: ['company-settings', companyId] }) },
  })
  if (q.isLoading) return null
  const shown = val ?? (q.data == null ? '' : String(q.data))
  return (
    <Card title="Leave request limit">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Requests per employee per month" hint="Counts pending and approved requests by start date. Empty = no limit. You can override it per employee in Employees → Details.">
          <Input inputMode="numeric" value={shown} onChange={(e) => setVal(e.target.value)} className="w-32" />
        </Field>
        <Button type="submit" disabled={save.isPending || val === null}>Save</Button>
      </form>
      <ErrorNote error={save.error} />
    </Card>
  )
}

function LeaveTypes({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', quota: '', paid: true })
  const [formErr, setFormErr] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['leave-types', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_types').select('id, name, annual_quota_days, is_paid, is_active').eq('company_id', companyId).order('name')
      if (error) throw error
      return data as LType[]
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['leave-types', companyId] })
  const add = useMutation({
    mutationFn: async () => {
      const name = f.name.trim()
      const quota = f.quota.trim() === '' ? null : Number(f.quota)
      if (!name || name.length > 60) throw new Error('Enter a name up to 60 characters.')
      if (quota !== null && (!Number.isFinite(quota) || quota < 0 || quota > 366)) throw new Error('Yearly days must be between 0 and 366, or empty for unlimited.')
      const { error } = await supabase.from('leave_types').insert({ company_id: companyId, name, annual_quota_days: quota, is_paid: f.paid })
      if (error) throw new Error(error.code === '23505' ? 'A leave type with this name already exists.' : error.message)
    },
    onSuccess: () => { setF({ name: '', quota: '', paid: true }); setFormErr(null); refresh() },
    onError: (e) => setFormErr(e.message),
  })
  const toggle = useMutation({
    mutationFn: async (t: LType) => { const { error } = await supabase.from('leave_types').update({ is_active: !t.is_active }).eq('id', t.id); if (error) throw error },
    onSuccess: refresh,
  })
  return (
    <Card title="Leave types">
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <Table head={['Name', 'Days per year', 'Paid', 'Status', '']} empty={q.data?.length ? undefined : 'No leave types yet. Add one below so employees can apply.'}>
          {q.data?.map((t) => (
            <tr key={t.id}>
              <Td>{t.name}</Td><Td>{t.annual_quota_days ?? 'Unlimited'}</Td><Td>{t.is_paid ? 'Paid' : 'Unpaid'}</Td>
              <Td><Badge tone={t.is_active ? 'good' : 'muted'}>{t.is_active ? 'Active' : 'Off'}</Badge></Td>
              <Td className="text-right"><Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(t)}>{t.is_active ? 'Turn off' : 'Turn on'}</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <ErrorNote error={toggle.error} />
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate() }} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_8rem_auto_auto] sm:items-end">
        <Field label="New leave type"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Casual leave" /></Field>
        <Field label="Days per year" hint="Empty = unlimited"><Input inputMode="decimal" value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} placeholder="12" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />Paid</label>
        <Button type="submit" disabled={add.isPending}>Add</Button>
      </form>
      {formErr && <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formErr}</p>}
      <p className="mt-3 text-xs text-slate-500">Balance = yearly days minus pending and approved days in that calendar year. No carry-forward or monthly accrual yet. Holidays are not modelled, so only the employee's shift working days count.</p>
    </Card>
  )
}

export default function Leave() {
  const { companyId, role } = useAuth()
  const admin = isAdmin(role)
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'action' | 'all' | Status>('action')
  const [rejecting, setRejecting] = useState<Req | null>(null)
  const [note, setNote] = useState('')
  const [modalErr, setModalErr] = useState<string | null>(null)

  const actionable: Status[] = admin ? ['pending', 'manager_approved'] : ['pending']
  const q = useQuery({
    queryKey: ['leave-requests', companyId, filter, admin], enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => {
      let query = supabase.from('leave_requests')
        .select('id, employee_id, start_date, end_date, days, is_half_day, reason, status, is_paid, manager_note, decision_note, created_at, employees(full_name, employee_code), leave_types(name, is_paid)')
        .eq('company_id', companyId!).order('start_date', { ascending: false }).limit(300)
      if (filter === 'action') query = query.in('status', actionable)
      else if (filter !== 'all') query = query.eq('status', filter)
      const { data, error } = await query
      if (error) throw error
      return data as unknown as Req[]
    },
  })
  const [paidFor, setPaidFor] = useState<Record<string, boolean>>({})
  const refresh = () => qc.invalidateQueries({ queryKey: ['leave-requests'] })
  const decide = useMutation({
    mutationFn: async (a: { id: string; approve: boolean; note?: string; paid?: boolean }) => {
      const { error } = await supabase.rpc('decide_leave', { p_request_id: a.id, p_approve: a.approve, p_note: a.note ?? null, p_paid: a.paid ?? null })
      if (error) throw new Error(friendly(error.message))
    },
    onSuccess: () => { setRejecting(null); setNote(''); setModalErr(null); refresh() },
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const rows = q.data ?? []
  const canAct = (r: Req) => actionable.includes(r.status)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Leave</h1>
        <Field label="Show">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="action">Waiting for my decision</option><option value="all">All requests</option>
            {(Object.keys(LABEL) as Status[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-slate-600">
        Employees apply in the mobile app. A manager approves first, then an administrator gives final approval{admin ? ' (you can approve directly)' : ''}.
      </p>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <Table head={['Employee', 'Type', 'Dates', 'Days', 'Status', 'Notes', '']} empty={rows.length ? undefined : filter === 'action' ? 'Nothing is waiting for your decision.' : 'No requests.'}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><PersonCell name={r.employees?.full_name ?? '—'} code={r.employees?.employee_code} /></Td>
                <Td>{r.leave_types?.name}</Td>
                <Td>{range(r)}{r.is_half_day ? ' (half day)' : ''}</Td>
                <Td>{r.days}</Td>
                <Td><Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>{r.status === 'approved' && <div className="mt-1 text-xs text-slate-500">{r.is_paid === false ? 'Unpaid' : 'Paid'}</div>}</Td>
                <Td className="max-w-xs text-xs text-slate-500">
                  {r.reason && <div>“{r.reason}”</div>}
                  {r.manager_note && <div>Manager: {r.manager_note}</div>}
                  {r.decision_note && <div>Decision: {r.decision_note}</div>}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {canAct(r) && (
                    <>
                      {admin && <label className="mr-2 text-xs"><input type="checkbox" className="mr-1" checked={paidFor[r.id] ?? r.leave_types?.is_paid ?? true} onChange={(e) => setPaidFor({ ...paidFor, [r.id]: e.target.checked })} />Paid</label>}
                      <Button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true, paid: admin ? paidFor[r.id] ?? r.leave_types?.is_paid ?? true : undefined })}>Approve</Button>{' '}
                      <Button variant="ghost" disabled={decide.isPending} onClick={() => { setRejecting(r); setNote(''); setModalErr(null) }}>Reject</Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <ErrorNote error={decide.error} />
        {rows.length === 300 && <p className="mt-2 text-xs text-amber-700">Showing the latest 300 requests. Use the filter to narrow.</p>}
      </Card>
      {admin && <LeaveTypes companyId={companyId} />}
      {admin && <RequestLimit companyId={companyId} />}
      {rejecting && (
        <Modal title={`Reject leave — ${rejecting.employees?.full_name ?? ''}`} onClose={() => setRejecting(null)}>
          <form onSubmit={(e) => { e.preventDefault(); if (note.trim().length < 3) { setModalErr(ERR.NOTE_REQUIRED); return } decide.mutate({ id: rejecting.id, approve: false, note: note.trim() }) }} className="space-y-3">
            <p className="text-sm text-slate-600">{range(rejecting)} · {rejecting.days} day(s). The employee sees your reason.</p>
            <Field label="Reason"><Input required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {(modalErr || decide.error) && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{modalErr ?? decide.error?.message}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" variant="danger" disabled={decide.isPending}>Reject</Button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}
