import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, Table, Td } from '@/components/ui'
import { inr, payError } from '@/lib/payroll'

interface Bal { id: string; employee_id: string; amount: number; given_on: string; reason: string | null; monthly_deduction: number | null; recovered: number; remaining: number; voided: boolean; void_reason: string | null; employees: { full_name: string; employee_code: string } | null }

export default function AdvancesTab({ companyId, onOpenEmployee }: { companyId: string; onOpenEmployee: (id: string, name: string) => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const q = useQuery({
    queryKey: ['payroll', 'advances', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('advance_balances').select('id, employee_id, amount, given_on, reason, monthly_deduction, recovered, remaining, voided, void_reason, employees(full_name, employee_code)').eq('company_id', companyId).order('given_on', { ascending: false })
      if (error) throw error
      return data as unknown as Bal[]
    },
  })
  const [voiding, setVoiding] = useState<Bal | null>(null)
  const rows = q.data ?? []
  const outstanding = rows.reduce((s, r) => s + Number(r.remaining), 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Advances are recovered from monthly salary, oldest first, up to the monthly deduction you set. Outstanding: <strong>{inr(outstanding)}</strong></p>
        <Button onClick={() => setOpen(true)}>Give advance</Button>
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <Table head={['Employee', 'Given on', 'Amount', 'Monthly deduction', 'Recovered', 'Outstanding', 'Reason', '']} empty={rows.length ? undefined : 'No advances.'}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><button className="underline-offset-2 hover:underline" onClick={() => onOpenEmployee(r.employee_id, r.employees?.full_name ?? '')}>{r.employees?.full_name}</button></Td>
                <Td>{r.given_on}</Td><Td>{inr(r.amount)}</Td><Td>{r.monthly_deduction ? inr(r.monthly_deduction) : 'All at once'}</Td>
                <Td>{inr(r.recovered)}</Td><Td className="font-medium">{inr(r.remaining)}</Td><Td className="text-xs text-slate-500">{r.reason}{r.voided && <div className="text-amber-700">Voided{r.void_reason ? `: ${r.void_reason}` : ''}</div>}</Td>
                <Td className="text-right">{Number(r.remaining) > 0 && <Button variant="ghost" onClick={() => setVoiding(r)}>{Number(r.recovered) > 0 ? 'Write off balance' : 'Void'}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {voiding && <VoidForm adv={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); qc.invalidateQueries({ queryKey: ['payroll'] }) }} />}
      {open && <AdvanceForm companyId={companyId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['payroll'] }) }} />}
    </div>
  )
}

function AdvanceForm({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [emp, setEmp] = useState(''); const [amount, setAmount] = useState(''); const [inst, setInst] = useState(''); const [on, setOn] = useState(new Date().toLocaleDateString('en-CA')); const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const emps = useQuery({ queryKey: ['payroll', 'emps', companyId], queryFn: async () => { const { data, error } = await supabase.from('employees').select('id, full_name, employee_code').eq('company_id', companyId).eq('is_active', true).order('full_name'); if (error) throw error; return data as { id: string; full_name: string; employee_code: string }[] } })
  const save = useMutation({
    mutationFn: async () => {
      const a = Number(amount), i = inst.trim() ? Number(inst) : null
      if (!emp) throw new Error('Choose an employee.')
      if (!Number.isFinite(a) || a <= 0) throw new Error('Enter the advance amount.')
      if (i !== null && (!Number.isFinite(i) || i <= 0 || i > a)) throw new Error('Monthly deduction must be more than 0 and not more than the advance.')
      const { error } = await supabase.rpc('give_advance', { p_company: companyId, p_employee: emp, p_amount: a, p_given_on: on, p_reason: reason.trim() || null, p_monthly_deduction: i })
      if (error) throw new Error(payError(error.message))
    },
    onSuccess: onDone, onError: (e: Error) => setErr(e.message),
  })
  return (
    <Modal title="Give advance" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate() }}>
        <Field label="Employee"><Select value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Choose…</option>{(emps.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Monthly deduction (₹)" hint="Empty = recover all from the next salary"><Input inputMode="decimal" value={inst} onChange={(e) => setInst(e.target.value)} /></Field>
        </div>
        <Field label="Given on"><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label="Reason (optional)"><Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
        {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button type="submit" disabled={save.isPending} className="w-full">Record advance</Button>
      </form>
    </Modal>
  )
}

function VoidForm({ adv, onClose, onDone }: { adv: Bal; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState(''); const [err, setErr] = useState<string | null>(null)
  const partly = Number(adv.recovered) > 0
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('void_advance', { p_advance: adv.id, p_reason: why.trim() || null }); if (error) throw new Error(payError(error.message)) },
    onSuccess: onDone, onError: (e: Error) => setErr(e.message),
  })
  return (
    <Modal title={partly ? 'Write off advance balance' : 'Void advance'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate() }}>
        <p className="text-sm">{partly
          ? `${inr(adv.recovered)} was already recovered from salary and stays in the history. The remaining ${inr(adv.remaining)} will be written off and no longer deducted.`
          : `This ${inr(adv.amount)} advance will be cancelled and nothing will be deducted. Use this for an entry made by mistake.`} Finalized payslips are not changed; draft payslips update automatically.</p>
        <Field label="Reason (optional)"><Input value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <Button type="submit" disabled={save.isPending} className="w-full">{partly ? 'Write off' : 'Void advance'}</Button>
      </form>
    </Modal>
  )
}
