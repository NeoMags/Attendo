import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  emptyPlanForm, fetchAllPlans, fetchSettings, parsePlanForm, planToForm, removeQr, saveGraceDays, savePayment, savePlan, uploadQr,
  type Plan, type PlanForm, type PlatformSettings,
} from '@/lib/subscriptions'
import { durationLabel, formatInr, qrUrl } from '@/lib/subscribe'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Skeleton, Table, Td, Textarea } from '@/components/ui'

type Tab = 'plans' | 'payment' | 'rules'
const TABS: { id: Tab; label: string }[] = [{ id: 'plans', label: 'Plans' }, { id: 'payment', label: 'Payment details' }, { id: 'rules', label: 'Expiry rules' }]

export default function PlatformSettings() {
  const [tab, setTab] = useState<Tab>('plans')
  return (
    <div>
      <PageHeader title="Platform settings" description="What customers see when they subscribe, and how expiry works." />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'plans' && <PlansTab />}
      {tab === 'payment' && <PaymentTab />}
      {tab === 'rules' && <RulesTab />}
    </div>
  )
}

// ---------------------------------------------------------------- plans
function PlansTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['all-plans'], queryFn: fetchAllPlans })
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (p: Plan) => { const { id, ...row } = p; return savePlan(id, { ...row, is_active: !p.is_active }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-plans'] }); qc.invalidateQueries({ queryKey: ['public-plans'] }) },
  })
  return (
    <Card title="Plans" actions={<Button size="sm" onClick={() => setEditing('new')}>Add plan</Button>}>
      <p className="mb-3 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
        Changes apply to new requests only. Requests already submitted keep the plan and price the customer saw. Deactivate a plan to hide it from customers instead of deleting it.
      </p>
      {q.isLoading && <Skeleton />}
      <ErrorNote error={q.error ?? toggle.error} />
      {q.data && (
        <Table head={['Plan', 'Price', 'Employees', 'Duration', 'Order', 'Status', '']} empty={q.data.length ? undefined : 'No plans yet. Add one so customers can subscribe.'}>
          {q.data.map((p) => (
            <tr key={p.id} className="tr-hoverable">
              <Td><div className="font-medium">{p.name}</div>{p.description && <div className="max-w-xs truncate text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{p.description}</div>}</Td>
              <Td>{formatInr(p.price_inr)}</Td>
              <Td>Up to {p.max_employees.toLocaleString('en-IN')}</Td>
              <Td>{durationLabel(p.duration_months)}</Td>
              <Td>{p.sort_order}</Td>
              <Td><Badge tone={p.is_active ? 'good' : 'muted'}>{p.is_active ? 'Visible' : 'Hidden'}</Badge></Td>
              <Td className="text-right"><span className="inline-flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>{p.is_active ? 'Hide' : 'Show'}</Button>
              </span></Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <PlanModal plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function PlanModal({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<PlanForm>(plan ? planToForm(plan) : emptyPlanForm())
  const [problem, setProblem] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      const parsed = parsePlanForm(f)
      if ('error' in parsed) throw new Error(parsed.error)
      await savePlan(plan?.id ?? null, parsed.row)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-plans'] }); qc.invalidateQueries({ queryKey: ['public-plans'] }); onClose() },
    onError: (e) => setProblem(e.message),
  })
  const set = (k: keyof PlanForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : 'Add plan'} onClose={save.isPending ? () => {} : onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button form="plan-form" type="submit" loading={save.isPending}>{plan ? 'Save changes' : 'Add plan'}</Button></>}
    >
      <form id="plan-form" className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setProblem(null); save.mutate() }}>
        <Field label="Name"><Input value={f.name} onChange={set('name')} maxLength={60} required /></Field>
        <Field label="Description" hint="One or two lines shown on the plan card."><Textarea value={f.description} onChange={set('description')} maxLength={300} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (₹)"><Input inputMode="decimal" value={f.price} onChange={set('price')} required /></Field>
          <Field label="Employee limit"><Input inputMode="numeric" value={f.max_employees} onChange={set('max_employees')} required /></Field>
          <Field label="Duration (months)" hint="1 to 36."><Input inputMode="numeric" value={f.duration_months} onChange={set('duration_months')} required /></Field>
          <Field label="Display order" hint="Lower numbers show first."><Input inputMode="numeric" value={f.sort_order} onChange={set('sort_order')} required /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Visible to customers</label>
        {problem && <ErrorNote error={new Error(problem)} />}
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- payment
function PaymentTab() {
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: fetchSettings })
  if (q.isLoading) return <Card><Skeleton /></Card>
  if (q.isError || !q.data) return <Card><ErrorNote error={q.error} /></Card>
  return <PaymentForm settings={q.data} />
}

function PaymentForm({ settings }: { settings: PlatformSettings }) {
  const qc = useQueryClient()
  const [upi, setUpi] = useState(settings.upi_id ?? '')
  const [payee, setPayee] = useState(settings.payee_name ?? '')
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['platform-settings'] }); qc.invalidateQueries({ queryKey: ['payment-info'] }) }
  const save = useMutation({ mutationFn: () => savePayment({ upi_id: upi, payee_name: payee }), onSuccess: () => { setSaved(true); refresh(); setTimeout(() => setSaved(false), 2500) } })
  const upload = useMutation({ mutationFn: (file: File) => uploadQr(file, settings.qr_path), onSuccess: refresh, onSettled: () => { if (fileRef.current) fileRef.current.value = '' } })
  const remove = useMutation({ mutationFn: () => removeQr(settings.qr_path!), onSuccess: refresh })
  const qr = qrUrl(settings.qr_path)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="UPI details">
        <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate() }}>
          <Field label="UPI ID" hint="Customers copy this to pay you. Example: name@bank"><Input value={upi} onChange={(e) => setUpi(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
          <Field label="Payee name" hint="The name customers should see when they pay."><Input value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={100} /></Field>
          <ErrorNote error={save.error} />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>Save payment details</Button>
            {saved && <span role="status" className="text-sm" style={{ color: 'var(--color-good)' }}>Saved</span>}
          </div>
        </form>
      </Card>
      <Card title="UPI QR code">
        {qr ? <img src={qr} alt="Current UPI QR code" className="mx-auto h-52 w-52 rounded-lg border object-contain p-2" style={{ borderColor: 'var(--color-border)', background: '#fff' }} />
          : <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No QR image yet. Customers will see only the UPI ID.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f) }} />
          <Button variant="ghost" loading={upload.isPending} onClick={() => fileRef.current?.click()}>{qr ? 'Replace image' : 'Upload image'}</Button>
          {qr && <Button variant="ghost" disabled={remove.isPending || upload.isPending} onClick={() => remove.mutate()}>Remove</Button>}
        </div>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>PNG, JPG or WebP, up to 1 MB. The image is public so customers can see it.</p>
        <div className="mt-3"><ErrorNote error={upload.error ?? remove.error} /></div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- expiry rules
function RulesTab() {
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: fetchSettings })
  if (q.isLoading) return <Card><Skeleton /></Card>
  if (q.isError || !q.data) return <Card><ErrorNote error={q.error} /></Card>
  return <GraceForm days={q.data.grace_days} />
}

function GraceForm({ days }: { days: number }) {
  const qc = useQueryClient()
  const [v, setV] = useState(String(days))
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: () => saveGraceDays(Number(v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-settings'] }); setSaved(true); setTimeout(() => setSaved(false), 2500) },
  })
  return (
    <Card title="Grace period" className="max-w-xl">
      <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate() }}>
        <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          After a subscription expires, the employee app keeps working for this many days while the dashboard is read-only.
          Enforcement of expiry is added in the next phase; this value is already stored.
        </p>
        <Field label="Grace period (days)" hint="0 to 30."><Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} className="max-w-[8rem]" /></Field>
        <ErrorNote error={save.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending}>Save</Button>
          {saved && <span role="status" className="text-sm" style={{ color: 'var(--color-good)' }}>Saved</span>}
        </div>
      </form>
    </Card>
  )
}
