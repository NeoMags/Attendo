import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  durationLabel, fetchPaymentInfo, fetchPlans, formatInr, normalizePhone, normalizeUtr, validateSubscribe,
  type SubscribeErrors, type SubscribeValues,
} from '@/lib/subscribe'
import { fetchMyRequests } from '@/lib/subscription'
import { fmtDateTime } from '@/lib/subscriptions'
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Table, Td } from '@/components/ui'
import PaymentPanel, { FieldError, canPayWith } from '@/components/PaymentPanel'
import { useMySubscription } from '@/components/SubscriptionBanner'

const STATE_LABEL = { active: ['good', 'Active'], grace: ['warn', 'Expired (grace period)'], expired: ['bad', 'Expired'], none: ['muted', 'No plan'] } as const
const REQ_TONE = { pending: 'warn', approved: 'good', rejected: 'bad' } as const
const fmtDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Billing() {
  const { session, company } = useAuth()
  const qc = useQueryClient()
  const sub = useMySubscription()
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: fetchPlans, staleTime: 60_000 })
  const pay = useQuery({ queryKey: ['payment-info'], queryFn: fetchPaymentInfo, staleTime: 30_000 })
  const history = useQuery({ queryKey: ['my-requests'], queryFn: fetchMyRequests })
  const [planId, setPlanId] = useState('')
  const [v, setV] = useState({ name: '', phone: '', utr: '' })
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<SubscribeErrors>({})

  const s = sub.data
  const plan = useMemo(() => plans.data?.find((p) => p.id === planId) ?? plans.data?.find((p) => p.name === s?.plan_name) ?? plans.data?.[0], [plans.data, planId, s?.plan_name])
  const email = session?.user.email ?? ''
  const pending = history.data?.find((r) => r.status === 'pending')

  const renew = useMutation({
    mutationFn: (): Promise<{ reference: string }> => {
      const f = new FormData()
      f.set('renewal', '1')
      f.set('plan_id', plan!.id)
      f.set('applicant_name', v.name.trim())
      f.set('company_name', company?.name ?? '')
      f.set('email', email.toLowerCase())
      f.set('phone', normalizePhone(v.phone))
      f.set('utr', normalizeUtr(v.utr))
      f.set('receipt', file!)
      return callFunction('submit-subscription', f)
    },
    onSuccess: () => { setV({ name: '', phone: '', utr: '' }); setFile(null); qc.invalidateQueries({ queryKey: ['my-requests'] }) },
  })

  if (sub.isLoading || plans.isLoading || pay.isLoading) return <Skeleton />
  if (sub.isError || plans.isError || pay.isError) return <ErrorNote error={sub.error ?? plans.error ?? pay.error} />
  if (!s || !plan || !pay.data) return <Card><p className="text-sm">No subscription found for this company.</p></Card>

  const [tone, label] = STATE_LABEL[s.state]
  const pct = Math.min(100, Math.round((s.employee_count / s.max_employees) * 100))
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => { setV({ ...v, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: undefined }) }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const vals: SubscribeValues = { name: v.name, company: company?.name ?? '', email, phone: v.phone, utr: v.utr }
    const found = validateSubscribe(vals, file ? { name: file.name, size: file.size } : null)
    setErrors(found)
    if (Object.keys(found).length === 0) renew.mutate()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Plan & billing" description="Your plan, usage and renewals." />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><span className="text-lg font-semibold">{s.plan_name}</span><Badge tone={tone}>{label}</Badge></div>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {s.is_complimentary ? 'Complimentary plan. It does not expire.' : `${s.state === 'active' ? 'Renews by' : 'Ended on'} ${fmtDate(s.expires_on)}${s.state === 'active' ? ` (${s.days_left} ${s.days_left === 1 ? 'day' : 'days'} left)` : ''}.`}
            </p>
          </div>
          <div className="min-w-[14rem]">
            <div className="flex justify-between text-[13px]"><span>Employees</span><span className="font-medium">{s.employee_count} of {s.max_employees.toLocaleString('en-IN')}</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-muted)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Employee limit used">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--color-bad)' : 'var(--color-accent)' }} />
            </div>
            {pct >= 100 && <p className="mt-1 text-[12px]" style={{ color: 'var(--color-bad)' }}>Limit reached. Choose a larger plan to add more people.</p>}
          </div>
        </div>
      </Card>

      {s.is_complimentary ? null : (
        <section className="space-y-4" aria-label="Renew">
          <h2 className="text-[15px] font-semibold">{s.state === 'active' ? 'Renew or change plan' : 'Renew your plan'}</h2>
          {pending && <p className="rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--color-bg-muted)' }}>Request <span className="font-mono">{pending.reference}</span> is waiting for verification. You will be contacted once it is approved.</p>}
          {renew.isSuccess ? (
            <Card><p className="text-sm">Request <span className="font-mono font-semibold">{renew.data.reference}</span> received. Once the payment is verified, your plan is extended and everything resumes.</p></Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <PaymentPanel amount={plan.price_inr} info={pay.data} />
              <form onSubmit={onSubmit} noValidate className="card space-y-4 p-5" aria-label="Renewal details">
                <Field label="Plan">
                  <Select value={plan.id} onChange={(e) => setPlanId(e.target.value)}>
                    {plans.data!.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatInr(p.price_inr)} · {durationLabel(p.duration_months)} · {p.max_employees.toLocaleString('en-IN')} employees</option>)}
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name"><Input value={v.name} onChange={set('name')} maxLength={120} aria-invalid={!!errors.name} />{errors.name && <FieldError text={errors.name} />}</Field>
                  <Field label="Phone"><Input type="tel" value={v.phone} onChange={set('phone')} inputMode="tel" aria-invalid={!!errors.phone} />{errors.phone && <FieldError text={errors.phone} />}</Field>
                </div>
                <Field label="UTR number" hint="Shown in your UPI app under the payment details.">
                  <Input value={v.utr} onChange={set('utr')} autoCapitalize="characters" spellCheck={false} className="font-mono" maxLength={30} aria-invalid={!!errors.utr} />{errors.utr && <FieldError text={errors.utr} />}
                </Field>
                <Field label="Payment receipt" hint="Screenshot or PDF, up to 3 MB.">
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (errors.receipt) setErrors({ ...errors, receipt: undefined }) }}
                    className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--color-accent-soft)] file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-[var(--color-accent)]" aria-invalid={!!errors.receipt} />
                  {errors.receipt && <FieldError text={errors.receipt} />}
                </Field>
                {renew.isError && <ErrorNote error={renew.error} />}
                <Button type="submit" disabled={renew.isPending || !canPayWith(pay.data)} className="w-full">{renew.isPending ? 'Sending…' : 'Send for verification'}</Button>
              </form>
            </div>
          )}
        </section>
      )}

      <Card title="Payment history">
        <Table head={['Reference', 'Plan', 'Amount', 'Submitted', 'Status']} empty={history.data?.length ? undefined : 'No payments submitted yet.'}>
          {(history.data ?? []).map((r) => (
            <tr key={r.id}>
              <Td className="font-mono">{r.reference}</Td>
              <Td>{r.plan_name}</Td>
              <Td>{formatInr(r.amount_inr)}</Td>
              <Td>{fmtDateTime(r.created_at)}</Td>
              <Td><Badge tone={REQ_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>{r.reject_reason && <div className="mt-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{r.reject_reason}</div>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}
