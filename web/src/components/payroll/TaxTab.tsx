import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, Table, Td } from '@/components/ui'
import { AMOUNT_FIELDS, EMPTY_DECL, TAX_WARNING, taxError, taxYearLabel, taxYearOf, type Declaration, type Projection } from '@/lib/tax'

type Row = { employee_id: string; employee_code: string; full_name: string; projection: Projection }
const inr0 = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function TaxTab({ companyId }: { companyId: string }) {
  const [year, setYear] = useState(taxYearOf(new Date()))
  const [edit, setEdit] = useState<Row | null>(null)
  const q = useQuery({
    queryKey: ['payroll', 'tax', companyId, year], retry: false,
    queryFn: async () => { const { data, error } = await supabase.rpc('tax_projection_all', { p_company: companyId, p_tax_year: year }); if (error) throw new Error(taxError(error.message)); return data as Row[] },
  })
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Projected annual income tax and the monthly TDS needed, from each employee&apos;s salary and investment declaration. This is a <b>projection only</b>: payslips do not deduct TDS yet. Slabs, rebate and standard deduction come from the Income-tax Act 2025 pages; the old-regime slabs and several deduction limits are flagged unverified in the parameter table.</p>
      <Field label="Tax year"><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].filter((y) => y >= 2026).map((y) => <option key={y} value={y}>{taxYearLabel(y)}</option>)}</Select></Field>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <Table head={['Employee', 'Regime', 'Annual income', 'Taxable', 'Annual tax', 'Monthly TDS', '']} empty={q.data?.length ? undefined : 'No employees with salary details.'}>
            {(q.data ?? []).map((r) => (
              <tr key={r.employee_id}>
                <Td>{r.full_name} <span className="text-xs text-slate-500">{r.employee_code}</span>{r.projection.warnings.length > 0 && <div className="text-xs text-amber-700">{r.projection.warnings.map((w) => TAX_WARNING[w] ?? w).join('; ')}</div>}</Td>
                <Td><Badge tone={r.projection.regime === 'new' ? 'good' : 'muted'}>{r.projection.regime}</Badge></Td>
                <Td>{inr0(r.projection.annual_gross)}</Td><Td>{inr0(r.projection.selected.taxable)}</Td><Td>{inr0(r.projection.selected.total)}</Td><Td>{inr0(r.projection.monthly_tds)}</Td>
                <Td className="text-right"><Button variant="ghost" onClick={() => setEdit(r)}>Declaration</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {edit && <DeclarationModal row={edit} year={year} onClose={() => setEdit(null)} />}
    </div>
  )
}

function DeclarationModal({ row, year, onClose }: { row: Row; year: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<Declaration | null>(null); const [err, setErr] = useState<string | null>(null)
  const load = useQuery({
    queryKey: ['payroll', 'tax-decl', row.employee_id, year],
    queryFn: async () => { const { data, error } = await supabase.from('tax_declarations').select('*').eq('employee_id', row.employee_id).eq('tax_year', year).maybeSingle(); if (error) throw error; const v = { ...EMPTY_DECL, ...(data ?? {}) } as Declaration; setD(v); return v },
  })
  const save = useMutation({
    mutationFn: async () => {
      if (!d) return
      const { regime, parents_senior, ...amounts } = d
      const { error } = await supabase.rpc('save_tax_declaration', { p_employee: row.employee_id, p_tax_year: year, p_regime: regime, p_values: { ...amounts, parents_senior } })
      if (error) throw new Error(taxError(error.message))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll', 'tax'] }); onClose() },
    onError: (e: Error) => setErr(e.message),
  })
  const p = row.projection
  return (
    <Modal title={`Tax declaration - ${row.full_name}`} onClose={onClose} wide>
      {load.isLoading || !d ? <Spinner /> : (
        <div className="space-y-3">
          <Field label="Regime"><Select value={d.regime} onChange={(e) => setD({ ...d, regime: e.target.value as 'old' | 'new' })}><option value="new">New regime (default)</option><option value="old">Old regime (with deductions)</option></Select></Field>
          {AMOUNT_FIELDS.filter((f) => !f.oldOnly || d.regime === 'old').map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}><Input inputMode="decimal" value={String(d[f.key] ?? 0)} onChange={(e) => setD({ ...d, [f.key]: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} /></Field>
          ))}
          {d.regime === 'old' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.parents_senior} onChange={(e) => setD({ ...d, parents_senior: e.target.checked })} /> A parent is a senior citizen</label>}
          <div className="rounded bg-slate-50 p-3 text-sm">
            <p className="font-medium">Current projection (saved declaration)</p>
            <p>New regime: tax {inr0(p.new.total)} on {inr0(p.new.taxable)} · Old regime: tax {inr0(p.old.total)} on {inr0(p.old.taxable)}</p>
            <p className="text-xs text-slate-500">Save to refresh. Surcharge, senior-citizen slabs and PAN-missing higher rates are not modelled.</p>
          </div>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
        </div>
      )}
    </Modal>
  )
}
