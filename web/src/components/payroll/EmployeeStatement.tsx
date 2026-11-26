import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Badge, ErrorNote, Modal, Skeleton, Table, Td } from '@/components/ui'
import { inr, monthLabel } from '@/lib/payroll'

/** One employee's money picture: salary history, advances, outstanding balance and the full ledger. */
export default function EmployeeStatement({ employeeId, name, onClose }: { employeeId: string; name: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['payroll', 'statement', employeeId],
    queryFn: async () => {
      const [s, a, l] = await Promise.all([
        supabase.from('payslips').select('id, month, gross, bonus, advance_deduction, other_deduction, net, finalized, paid_on, payment_mode').eq('employee_id', employeeId).order('month', { ascending: false }).limit(36),
        supabase.from('advance_balances').select('id, amount, given_on, reason, monthly_deduction, recovered, remaining, voided').eq('employee_id', employeeId).order('given_on', { ascending: false }),
        supabase.from('ledger_entries').select('id, entry_date, kind, amount, direction, note, created_at').eq('employee_id', employeeId).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      ])
      const err = s.error ?? a.error ?? l.error
      if (err) throw err
      return { slips: s.data as { id: string; month: string; gross: number; bonus: number; advance_deduction: number; other_deduction: number; net: number; finalized: boolean; paid_on: string | null; payment_mode: string | null }[],
        adv: a.data as { id: string; amount: number; given_on: string; reason: string | null; monthly_deduction: number | null; recovered: number; remaining: number; voided: boolean }[],
        ledger: l.data as { id: string; entry_date: string; kind: string; amount: number; direction: string; note: string | null }[] }
    },
  })
  const d = q.data
  const outstanding = (d?.adv ?? []).reduce((s, x) => s + Number(x.remaining), 0)
  const unpaid = (d?.slips ?? []).filter((p) => p.finalized && !p.paid_on).reduce((s, p) => s + Number(p.net), 0)
  const KIND: Record<string, string> = { advance_given: 'Advance given', advance_recovered: 'Advance recovered', salary_paid: 'Salary paid', advance_voided: 'Advance voided / written off', advance_reversed: 'Advance recovery reversed' }
  return (
    <Modal title={`Account · ${name}`} onClose={onClose} wide>
      {q.isLoading ? <Skeleton /> : q.error ? <ErrorNote error={q.error} /> : d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-amber-50 p-3"><div className="text-xs text-slate-500">Advance outstanding (employee owes company)</div><div className="text-lg font-semibold">{inr(outstanding)}</div></div>
            <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Finalized salary not yet paid (company owes employee)</div><div className="text-lg font-semibold">{inr(unpaid)}</div></div>
          </div>
          <section><h3 className="mb-1 text-sm font-semibold">Salary history</h3>
            <Table head={['Month', 'Gross', 'Bonus', 'Advance', 'Other', 'Net', 'Status']} empty={d.slips.length ? undefined : 'No payslips yet.'}>
              {d.slips.map((p) => <tr key={p.id}><Td>{monthLabel(p.month)}</Td><Td>{inr(p.gross)}</Td><Td>{inr(p.bonus)}</Td><Td>{inr(p.advance_deduction)}</Td><Td>{inr(p.other_deduction)}</Td><Td className="font-medium">{inr(p.net)}</Td>
                <Td>{!p.finalized ? <Badge tone="muted">Draft</Badge> : p.paid_on ? <Badge tone="good">Paid {p.paid_on}</Badge> : <Badge tone="warn">Unpaid</Badge>}</Td></tr>)}
            </Table></section>
          <section><h3 className="mb-1 text-sm font-semibold">Advance history</h3>
            <Table head={['Given on', 'Amount', 'Monthly deduction', 'Recovered', 'Outstanding', 'Reason']} empty={d.adv.length ? undefined : 'No advances.'}>
              {d.adv.map((x) => <tr key={x.id}><Td>{x.given_on}</Td><Td>{inr(x.amount)}</Td><Td>{x.monthly_deduction ? inr(x.monthly_deduction) : 'All at once'}</Td><Td>{inr(x.recovered)}</Td><Td className="font-medium">{inr(x.remaining)}</Td><Td className="text-xs text-slate-500">{x.reason}{x.voided && ' (voided)'}</Td></tr>)}
            </Table></section>
          <section><h3 className="mb-1 text-sm font-semibold">Transactions</h3>
            <Table head={['Date', 'Type', 'Amount', 'Direction', 'Note']} empty={d.ledger.length ? undefined : 'No transactions.'}>
              {d.ledger.map((x) => <tr key={x.id}><Td>{x.entry_date}</Td><Td>{KIND[x.kind] ?? x.kind}</Td><Td>{inr(x.amount)}</Td><Td className="text-xs">{x.direction === 'to_employee' ? 'Company → employee' : x.direction === 'waived' ? 'Waived' : 'Recovered from salary'}</Td><Td className="text-xs text-slate-500">{x.note}</Td></tr>)}
            </Table></section>
        </div>
      )}
    </Modal>
  )
}
