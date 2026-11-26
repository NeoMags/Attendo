import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { callFunction, supabase } from '@/lib/supabase'
import { useAuth, type Company } from '@/lib/auth'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Table, Td } from '@/components/ui'

const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/

export default function Companies() {
  const { companies, setCompanyId } = useAuth()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [adminFor, setAdminFor] = useState<Company | null>(null)

  const toggle = useMutation({
    mutationFn: async (c: Company) => {
      const { error } = await supabase.from('companies').update({ is_active: !c.is_active }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Companies</h1>
        <Button onClick={() => setAdding(true)}>Add company</Button>
      </div>
      <Card>
        <Table head={['Code', 'Name', 'Timezone', 'Status', '']} empty={companies.length ? undefined : 'No companies yet.'}>
          {companies.map((c) => (
            <tr key={c.id} className="tr-hoverable">
              <Td className="font-mono">{c.code}</Td>
              <Td>{c.name}</Td>
              <Td>{c.timezone}</Td>
              <Td><Badge tone={c.is_active ? 'good' : 'muted'}>{c.is_active ? 'Active' : 'Inactive'}</Badge></Td>
              <Td className="text-right">
                <span className="inline-flex gap-2">
                  <Button variant="ghost" onClick={() => setCompanyId(c.id)}>Open</Button>
                  <Button variant="ghost" onClick={() => setAdminFor(c)}>Add admin login</Button>
                  <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
        <ErrorNote error={toggle.error} />
      </Card>
      {adding && <AddCompany onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); qc.invalidateQueries({ queryKey: ['companies'] }).then(() => setCompanyId(id)) }} />}
      {adminFor && <AddAdmin company={adminFor} onClose={() => setAdminFor(null)} />}
    </div>
  )
}

function AddCompany({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ code: '', name: '', timezone: 'Asia/Kolkata' })
  const m = useMutation({
    mutationFn: async () => {
      if (!CODE_RE.test(f.code)) throw new Error('Company code: 2–32 lowercase letters, digits, dash or underscore.')
      const { data, error } = await supabase.from('companies').insert({ code: f.code, name: f.name.trim(), timezone: f.timezone.trim() }).select('id').single()
      if (error) throw new Error(error.code === '23505' ? 'That company code is already taken.' : error.message)
      return data.id as string
    },
    onSuccess: onDone,
  })
  return (
    <Modal title="Add company" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate() }} className="space-y-3">
        <Field label="Company code" hint="Employees type this when signing in to the app."><Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} /></Field>
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Timezone (IANA)"><Input required value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <ErrorNote error={m.error} />
        <Button type="submit" disabled={m.isPending} className="w-full">Create company</Button>
      </form>
    </Modal>
  )
}

function AddAdmin({ company, onClose }: { company: Company; onClose: () => void }) {
  const [f, setF] = useState({ email: '', password: '' })
  const m = useMutation({ mutationFn: () => callFunction('admin-create-company-admin', { company_id: company.id, ...f }) })
  return (
    <Modal title={`Admin login · ${company.name}`} onClose={onClose}>
      {m.isSuccess ? (
        <div className="space-y-3"><p className="text-sm">Created. {f.email} can now sign in to this dashboard.</p><Button onClick={onClose} className="w-full">Done</Button></div>
      ) : (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate() }} className="space-y-3">
          <Field label="Email"><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Password" hint="8–72 characters, letters and digits."><Input required autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <ErrorNote error={m.error} />
          <Button type="submit" disabled={m.isPending} className="w-full">Create admin</Button>
        </form>
      )}
    </Modal>
  )
}
