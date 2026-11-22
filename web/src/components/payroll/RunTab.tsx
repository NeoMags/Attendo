import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { download } from '@/lib/reports'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner } from '@/components/ui'
import { asLang, LANGS, type Lang } from '@/lib/payslipI18n'
import { currentYm, inr, monthLabel, monthStart, openForPrint, payError, payslipLines, payslipPdf, type Payslip, type Template } from '@/lib/payroll'

const COLS = 'id, run_id, employee_id, month, pay_type, monthly_salary, daily_wage, working_days, present_days, holiday_days, paid_leave_days, unpaid_leave_days, absent_days, gross, bonus, other_deduction, skip_advance, advance_deduction, net, adjustment_note, finalized, paid_on, payment_mode, employees(full_name, employee_code, preferred_language)'
type Run = { id: string; status: 'draft' | 'finalized' }

export default function RunTab({ companyId, companyName, onOpenEmployee }: { companyId: string; companyName: string; onOpenEmployee: (id: string, name: string) => void }) {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYm())
  const [adjust, setAdjust] = useState<Payslip | null>(null)
  const [pay, setPay] = useState<Payslip | null>(null)
  const [tplId, setTplId] = useState('')
  const [langPick, setLangPick] = useState<'' | Lang>('')
  const [err, setErr] = useState<string | null>(null)
  const month = monthStart(ym)
  const refresh = () => qc.invalidateQueries({ queryKey: ['payroll'] })

  const q = useQuery({
    queryKey: ['payroll', 'run', companyId, month],
    queryFn: async () => {
      const { data: run, error } = await supabase.from('payroll_runs').select('id, status').eq('company_id', companyId).eq('month', month).maybeSingle()
      if (error) throw error
      const slips = run ? await supabase.from('payslips').select(COLS).eq('run_id', run.id).order('created_at') : { data: [], error: null }
      if (slips.error) throw slips.error
      const [emps, infos] = await Promise.all([
        supabase.from('employees').select('id, full_name, employee_code').eq('company_id', companyId).eq('is_active', true),
        supabase.from('employee_payroll_info').select('employee_id').eq('company_id', companyId),
      ])
      if (emps.error ?? infos.error) throw (emps.error ?? infos.error)
      const have = new Set((infos.data ?? []).map((i) => i.employee_id as string))
      return { run: run as Run | null, slips: (slips.data ?? []) as unknown as Payslip[], missing: (emps.data ?? []).filter((e) => !have.has(e.id)) as { id: string; full_name: string; employee_code: string }[] }
    },
  })
  const tpls = useQuery({
    queryKey: ['payroll', 'templates', companyId],
    queryFn: async () => { const { data, error } = await supabase.from('payslip_templates').select('*').eq('company_id', companyId).order('name'); if (error) throw error; return data as Template[] },
  })
  const rpc = useMutation({
    mutationFn: async (a: { fn: string; args: Record<string, unknown> }) => { const { error } = await supabase.rpc(a.fn, a.args); if (error) throw new Error(payError(error.message)) },
    onSuccess: () => { setErr(null); setAdjust(null); setPay(null); refresh() },
    onError: (e: Error) => setErr(e.message),
  })
  const template = (tpls.data ?? []).find((t) => t.id === tplId) ?? (tpls.data ?? []).find((t) => t.is_default) ?? null
  const pdf = async (p: Payslip, print: boolean) => {
    const bank = await supabase.from('employee_payroll_info').select('bank_name, bank_account').eq('employee_id', p.employee_id).maybeSingle()
    const acct = bank.data?.bank_account as string | null
    const bankLine = bank.data?.bank_name ? `Bank: ${bank.data.bank_name}${acct ? ` · A/c ending ${acct.slice(-4)}` : ''}` : null
    const blob = await payslipPdf({ p, companyName, template, bankLine, lang: langPick || asLang(p.employees?.preferred_language) })
    if (print) openForPrint(blob); else download(blob, `payslip-${p.employees?.employee_code ?? p.employee_id}-${p.month.slice(0, 7)}.pdf`)
  }

  const d = q.data
  const draft = d?.run?.status === 'draft'
  const total = (d?.slips ?? []).reduce((s, p) => s + Number(p.net), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month"><Input type="month" value={ym} max={currentYm()} onChange={(e) => e.target.value && setYm(e.target.value)} /></Field>
        {(!d?.run || draft) && <Button disabled={rpc.isPending} onClick={() => rpc.mutate({ fn: 'generate_payroll', args: { p_company: companyId, p_month: month } })}>{d?.run ? 'Recalculate from attendance' : 'Generate payroll'}</Button>}
        {draft && d!.slips.length > 0 && <Button disabled={rpc.isPending} onClick={() => { if (window.confirm(`Finalize ${monthLabel(month)}? Advance recoveries will be recorded and payslips become visible to employees. This cannot be undone.`)) rpc.mutate({ fn: 'finalize_payroll', args: { p_run: d!.run!.id } }) }}>Finalize month</Button>}
        <Field label="Payslip language"><Select value={langPick} onChange={(e) => setLangPick(e.target.value as '' | Lang)}><option value="">Employee's language</option>{LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select></Field>
        <Field label="Payslip template"><Select value={tplId} onChange={(e) => setTplId(e.target.value)}><option value="">{template ? `Default (${template.name})` : 'Plain'}</option>{(tpls.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      </div>
      <p className="text-sm text-slate-600">
        Pay = salary ÷ working days × (days present + paid holidays + paid leave). Working days exclude each shift's weekly off. Daily-wage employees earn wage × (days present + paid leave); holidays are not paid. Attendance on a weekly off day is not counted.
      </p>
      {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {d && d.missing.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">No pay details yet for: {d.missing.map((m) => m.full_name).join(', ')}. Add them in Employees → Details.</p>}
      <Card title={d?.run ? `${monthLabel(month)} · ${draft ? 'Draft' : 'Finalized'}` : monthLabel(month)}>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : !d?.run ? <p className="p-4 text-sm text-slate-500">Not generated yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr>
                {['Employee', 'Days (paid / working)', 'Absent', 'Gross', 'Bonus', 'Advance', 'Other', 'Net', ''].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.slips.map((p) => {
                  const paidDays = Number(p.present_days) + Number(p.holiday_days) + Number(p.paid_leave_days)
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2"><button className="text-left underline-offset-2 hover:underline" onClick={() => onOpenEmployee(p.employee_id, p.employees?.full_name ?? '')}>{p.employees?.full_name}</button><div className="text-xs text-slate-500">{p.employees?.employee_code} · {p.pay_type}</div></td>
                      <td className="px-3 py-2">{paidDays} / {p.working_days}<div className="text-xs text-slate-500">P {p.present_days} · H {p.holiday_days} · L {p.paid_leave_days}{Number(p.unpaid_leave_days) ? ` · UL ${p.unpaid_leave_days}` : ''}</div></td>
                      <td className="px-3 py-2">{p.absent_days}</td>
                      <td className="px-3 py-2">{inr(p.gross)}</td>
                      <td className="px-3 py-2">{inr(p.bonus)}</td>
                      <td className="px-3 py-2">{inr(p.advance_deduction)}{p.skip_advance && <div className="text-xs text-amber-700">skipped</div>}</td>
                      <td className="px-3 py-2">{inr(p.other_deduction)}</td>
                      <td className="px-3 py-2 font-medium">{inr(p.net)}{p.paid_on && <div><Badge tone="good">Paid {p.paid_on}</Badge></div>}</td>
                      <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                        {draft && <Button variant="ghost" onClick={() => setAdjust(p)}>Adjust</Button>}
                        {!draft && !p.paid_on && <Button variant="ghost" onClick={() => setPay(p)}>Mark paid</Button>}
                        {!draft && !p.paid_on && Number(p.advance_deduction) > 0 && <Button variant="ghost" onClick={() => { const r = window.prompt(`Reverse the advance recovery of ${inr(p.advance_deduction)}? The advance balance is restored and recovered in a later month. Reason (optional):`); if (r !== null) rpc.mutate({ fn: 'reverse_advance_recovery', args: { p_payslip: p.id, p_reason: r.trim() || null } }) }}>Reverse recovery</Button>}
                        <Button variant="ghost" onClick={() => pdf(p, false)}>PDF</Button>
                        <Button variant="ghost" onClick={() => pdf(p, true)}>Print</Button>
                      </td>
                    </tr>
                  )
                })}
                {d.slips.length > 0 && <tr className="bg-slate-50 font-medium"><td className="px-3 py-2" colSpan={7}>Total net pay</td><td className="px-3 py-2">{inr(total)}</td><td /></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adjust && <AdjustModal p={adjust} busy={rpc.isPending} onClose={() => setAdjust(null)} onSave={(a) => rpc.mutate({ fn: 'set_payslip_adjustment', args: { p_payslip: adjust.id, ...a } })} />}
      {pay && <PayModal p={pay} busy={rpc.isPending} onClose={() => setPay(null)} onSave={(a) => rpc.mutate({ fn: 'mark_payslip_paid', args: { p_payslip: pay.id, ...a } })} />}
    </div>
  )
}

function AdjustModal({ p, busy, onClose, onSave }: { p: Payslip; busy: boolean; onClose: () => void; onSave: (a: { p_bonus: number; p_other: number; p_note: string | null; p_skip_advance: boolean }) => void }) {
  const [bonus, setBonus] = useState(String(p.bonus)); const [other, setOther] = useState(String(p.other_deduction)); const [note, setNote] = useState(p.adjustment_note ?? ''); const [skip, setSkip] = useState(p.skip_advance)
  const [e, setE] = useState<string | null>(null)
  const l = payslipLines({ ...p, bonus: Number(bonus) || 0, other_deduction: Number(other) || 0 })
  return (
    <Modal title={`Adjust · ${p.employees?.full_name}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(ev: FormEvent) => {
        ev.preventDefault()
        const b = Number(bonus || 0), o = Number(other || 0)
        if (!Number.isFinite(b) || !Number.isFinite(o) || b < 0 || o < 0) return setE('Enter valid amounts.')
        onSave({ p_bonus: b, p_other: o, p_note: note.trim() || null, p_skip_advance: skip })
      }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bonus / extra (₹)"><Input inputMode="decimal" value={bonus} onChange={(x) => setBonus(x.target.value)} /></Field>
          <Field label="Other deduction (₹)"><Input inputMode="decimal" value={other} onChange={(x) => setOther(x.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><Input value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skip} onChange={(x) => setSkip(x.target.checked)} /> Skip advance recovery this month</label>
        <p className="text-xs text-slate-500">Gross {inr(p.gross)}. The advance installment is recalculated by the server when you save (net shown after saving; before advance: {inr(l.earnings.reduce((s, x) => s + x[1], 0) - Number(other || 0))}).</p>
        {e && <p role="alert" className="text-sm text-red-700">{e}</p>}
        <Button type="submit" disabled={busy} className="w-full">Save</Button>
      </form>
    </Modal>
  )
}

function PayModal({ p, busy, onClose, onSave }: { p: Payslip; busy: boolean; onClose: () => void; onSave: (a: { p_paid_on: string; p_mode: string }) => void }) {
  const [on, setOn] = useState(new Date().toLocaleDateString('en-CA')); const [mode, setMode] = useState('bank')
  return (
    <Modal title={`Mark paid · ${p.employees?.full_name}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); onSave({ p_paid_on: on, p_mode: mode }) }}>
        <p className="text-sm">Net pay {inr(p.net)} for {monthLabel(p.month)}. This records a salary payment in the ledger.</p>
        <Field label="Paid on"><Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label="Paid by"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{['bank', 'cash', 'upi', 'cheque', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
        <Button type="submit" disabled={busy} className="w-full">Record payment</Button>
      </form>
    </Modal>
  )
}
