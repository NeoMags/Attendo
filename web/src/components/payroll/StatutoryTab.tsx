import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { download } from '@/lib/reports'
import { Badge, Button, Card, ErrorNote, Field, Input, Skeleton, Table, Td } from '@/components/ui'
import { currentYm, inr, monthLabel, monthStart, payError } from '@/lib/payroll'
import { ecrText, esiCsv, WARNING_TEXT, type StatRow, type StatSummary } from '@/lib/statutory'

type Kind = 'pf' | 'esi'
const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function StatutoryTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYm())
  const month = monthStart(ym)
  const [kind, setKind] = useState<Kind>('pf')
  const [filedOn, setFiledOn] = useState(''); const [ref, setRef] = useState(''); const [err, setErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['payroll', 'statutory', companyId, month],
    retry: false,
    queryFn: async () => {
      const [rows, sum] = await Promise.all([
        supabase.rpc('statutory_contributions', { p_company: companyId, p_month: month }),
        supabase.rpc('statutory_summary', { p_company: companyId, p_month: month }),
      ])
      if (rows.error) throw new Error(payError(rows.error.message))
      if (sum.error) throw new Error(payError(sum.error.message))
      return { rows: rows.data as StatRow[], sum: sum.data as StatSummary }
    },
  })
  const file = useMutation({
    mutationFn: async () => {
      if (!filedOn) throw new Error('Enter the date it was paid / filed.')
      const { error } = await supabase.rpc('record_statutory_filing', { p_company: companyId, p_month: month, p_kind: kind, p_filed_on: filedOn, p_reference: ref || null })
      if (error) throw new Error(payError(error.message))
    },
    onSuccess: () => { setErr(null); setFiledOn(''); setRef(''); qc.invalidateQueries({ queryKey: ['payroll', 'statutory'] }) },
    onError: (e: Error) => setErr(e.message),
  })
  const data = q.data
  const pfRows = (data?.rows ?? []).filter((r) => r.pf_applies); const esiRows = (data?.rows ?? []).filter((r) => r.esi_applies)
  const flagged = (data?.rows ?? []).filter((r) => r.warnings.length)
  const filing = data?.sum[kind].filing

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Contributions are computed from <b>finalized</b> payslips using each employee&apos;s earned gross as wages (no basic/DA split is stored). Rates and ceilings come from the parameter table; the PF ceiling is ₹25,000 from 17 Sep 2026 (Gazette S.O. 5109(E)). Check the figures against the EPFO / ESIC portals before paying.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
        <div role="tablist" className="flex gap-1">
          {(['pf', 'esi'] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded px-3 py-1.5 text-sm ${kind === k ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{k === 'pf' ? 'PF (EPF / EPS / EDLI)' : 'ESI'}</button>)}
        </div>
      </div>
      {q.isLoading ? <Skeleton /> : q.error ? <ErrorNote error={q.error} /> : data && (
        <>
          {flagged.length > 0 && (
            <Card title="Needs attention">
              <ul className="space-y-1 text-sm">{flagged.map((r) => <li key={r.employee_id}><b>{r.full_name}</b> ({r.employee_code}): {r.warnings.map((w) => WARNING_TEXT[w] ?? w).join('; ')}</li>)}</ul>
            </Card>
          )}
          {kind === 'pf' ? (
            <>
              <Card title={`PF - ${monthLabel(month)}`} actions={<Button onClick={() => { const r = ecrText(data.rows); if (!r.included) { setErr('No members with a UAN.'); return } setErr(r.skipped.length ? `Left out (no UAN): ${r.skipped.join(', ')}` : null); download(new Blob([r.text], { type: 'text/plain' }), `ECR-${ym}.txt`) }}>Download ECR file</Button>}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <dt className="text-slate-500">Members</dt><dd>{data.sum.pf.members}</dd>
                  <dt className="text-slate-500">EPF wages</dt><dd>{fmt(data.sum.pf.epf_wages)}</dd>
                  <dt className="text-slate-500">Employee EPF (12%)</dt><dd>{fmt(data.sum.pf.ee_epf)}</dd>
                  <dt className="text-slate-500">Employer EPS</dt><dd>{fmt(data.sum.pf.er_eps)}</dd>
                  <dt className="text-slate-500">Employer EPF</dt><dd>{fmt(data.sum.pf.er_epf)}</dd>
                  <dt className="text-slate-500">EDLI</dt><dd>{fmt(data.sum.pf.edli)}</dd>
                  <dt className="text-slate-500">Admin charges</dt><dd>{fmt(data.sum.pf.admin)}</dd>
                  <dt className="font-medium">Total to pay</dt><dd className="font-medium">{fmt(data.sum.pf.total)}</dd>
                </dl>
              </Card>
              <Card>
                <Table head={['Employee', 'UAN', 'EPF wages', 'EPF (EE)', 'EPS', 'EPF (ER)', 'NCP']} empty={pfRows.length ? undefined : 'No PF-eligible employees in this month.'}>
                  {pfRows.map((r) => <tr key={r.employee_id}><Td>{r.full_name} <span className="text-xs text-slate-500">{r.employee_code}</span></Td><Td>{r.uan ?? <Badge tone="warn">missing</Badge>}</Td><Td>{fmt(r.epf_wages)}</Td><Td>{fmt(r.ee_epf)}</Td><Td>{fmt(r.er_eps)}</Td><Td>{fmt(r.er_epf)}</Td><Td>{r.ncp_days}</Td></tr>)}
                </Table>
              </Card>
            </>
          ) : (
            <>
              <Card title={`ESI - ${monthLabel(month)}`} actions={<Button onClick={() => { const r = esiCsv(data.rows); if (!r.included) { setErr('No employees with an IP number and paid days.'); return } setErr(r.skipped.length ? `Left out (no IP number or no paid days): ${r.skipped.join(', ')}` : null); download(new Blob([r.text], { type: 'text/csv' }), `ESI-${ym}.csv`) }}>Download ESI file (CSV)</Button>}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <dt className="text-slate-500">Insured persons</dt><dd>{data.sum.esi.members}</dd>
                  <dt className="text-slate-500">Wages</dt><dd>{fmt(data.sum.esi.wages)}</dd>
                  <dt className="text-slate-500">Employee (0.75%)</dt><dd>{fmt(data.sum.esi.employee)}</dd>
                  <dt className="text-slate-500">Employer (3.25%)</dt><dd>{fmt(data.sum.esi.employer)}</dd>
                  <dt className="font-medium">Total to pay</dt><dd className="font-medium">{fmt(data.sum.esi.total)}</dd>
                </dl>
                <p className="mt-2 text-xs text-slate-500">The CSV headers follow the ESIC bulk-upload sheet from memory and are not verified - compare with the template on the ESIC portal before uploading.</p>
              </Card>
              <Card>
                <Table head={['Employee', 'IP number', 'Days', 'Wages', 'Employee', 'Employer']} empty={esiRows.length ? undefined : 'No ESI-eligible employees in this month.'}>
                  {esiRows.map((r) => <tr key={r.employee_id}><Td>{r.full_name} <span className="text-xs text-slate-500">{r.employee_code}</span></Td><Td>{r.esi_ip_number ?? <Badge tone="warn">missing</Badge>}</Td><Td>{r.esi_days}</Td><Td>{inr(r.esi_wages)}</Td><Td>{fmt(r.esi_employee)}</Td><Td>{fmt(r.esi_employer)}</Td></tr>)}
                </Table>
              </Card>
            </>
          )}
          <Card title="Payment record">
            {filing ? <p className="text-sm">Recorded: {fmt(filing.amount)} on {filing.filed_on}{filing.reference ? `, ref ${filing.reference}` : ''}. Record again to correct it.</p> : <p className="text-sm text-slate-600">Not recorded yet.</p>}
            <form className="mt-2 flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); file.mutate() }}>
              <Field label="Paid / filed on"><Input type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} /></Field>
              <Field label="Challan / TRRN / reference"><Input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></Field>
              <Button type="submit" disabled={file.isPending}>Save record</Button>
            </form>
          </Card>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </>
      )}
    </div>
  )
}
