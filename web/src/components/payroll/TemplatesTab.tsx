import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Spinner, Table, Td } from '@/components/ui'
import type { Template } from '@/lib/payroll'

type Draft = Omit<Template, 'id'> & { id?: string }
const BLANK: Draft = { name: '', header_text: '', footer_text: '', show_attendance: true, show_bank: false, accent: '#0f172a', is_default: false }

export default function TemplatesTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Draft | null>(null)
  const q = useQuery({
    queryKey: ['payroll', 'templates', companyId],
    queryFn: async () => { const { data, error } = await supabase.from('payslip_templates').select('*').eq('company_id', companyId).order('name'); if (error) throw error; return data as Template[] },
  })
  const done = () => { setEdit(null); qc.invalidateQueries({ queryKey: ['payroll'] }) }
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('payslip_templates').delete().eq('id', id); if (error) throw error },
    onSuccess: done,
  })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Templates control the header, footer, accent colour and optional sections on payslip PDFs. The default is used unless you pick another when downloading.</p>
        <Button onClick={() => setEdit({ ...BLANK })}>New template</Button>
      </div>
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <Table head={['Name', 'Header', 'Sections', '']} empty={q.data?.length ? undefined : 'No templates — payslips use a plain layout.'}>
            {(q.data ?? []).map((t) => (
              <tr key={t.id}>
                <Td><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: t.accent }} />{t.name} {t.is_default && <Badge tone="good">Default</Badge>}</Td>
                <Td className="text-xs text-slate-500">{t.header_text}</Td>
                <Td className="text-xs">{[t.show_attendance && 'Attendance', t.show_bank && 'Bank'].filter(Boolean).join(', ') || '—'}</Td>
                <Td className="space-x-1 text-right"><Button variant="ghost" onClick={() => setEdit(t)}>Edit</Button><Button variant="ghost" onClick={() => { if (window.confirm(`Delete ${t.name}?`)) del.mutate(t.id) }}>Delete</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {edit && <TemplateForm companyId={companyId} t={edit} onClose={() => setEdit(null)} onDone={done} />}
    </div>
  )
}

function TemplateForm({ companyId, t, onClose, onDone }: { companyId: string; t: Draft; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Draft>(t); const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      if (!d.name.trim()) throw new Error('Give the template a name.')
      const row = { name: d.name.trim(), header_text: d.header_text?.trim() || null, footer_text: d.footer_text?.trim() || null, show_attendance: d.show_attendance, show_bank: d.show_bank, accent: d.accent, is_default: d.is_default }
      // Only one default per company: clear the old one first so the partial unique index is not violated.
      if (d.is_default) { const r = await supabase.from('payslip_templates').update({ is_default: false }).eq('company_id', companyId).eq('is_default', true).neq('id', d.id ?? '00000000-0000-0000-0000-000000000000'); if (r.error) throw r.error }
      const { error } = d.id ? await supabase.from('payslip_templates').update(row).eq('id', d.id) : await supabase.from('payslip_templates').insert({ ...row, company_id: companyId })
      if (error) throw new Error(error.code === '23505' ? 'A template with that name already exists.' : error.message)
    },
    onSuccess: onDone, onError: (e: Error) => setErr(e.message),
  })
  return (
    <Modal title={d.id ? 'Edit template' : 'New template'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate() }}>
        <Field label="Template name"><Input value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Header (defaults to company name)"><Input value={d.header_text ?? ''} maxLength={200} onChange={(e) => setD({ ...d, header_text: e.target.value })} /></Field>
        <Field label="Footer note"><Input value={d.footer_text ?? ''} maxLength={500} onChange={(e) => setD({ ...d, footer_text: e.target.value })} /></Field>
        <Field label="Accent colour"><Input type="color" value={d.accent} onChange={(e) => setD({ ...d, accent: e.target.value })} className="h-10 w-20 p-1" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.show_attendance} onChange={(e) => setD({ ...d, show_attendance: e.target.checked })} /> Show attendance summary</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.show_bank} onChange={(e) => setD({ ...d, show_bank: e.target.checked })} /> Show bank name and last 4 digits of account</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.is_default} onChange={(e) => setD({ ...d, is_default: e.target.checked })} /> Use as default</label>
        {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button type="submit" disabled={save.isPending} className="w-full">Save template</Button>
      </form>
    </Modal>
  )
}
