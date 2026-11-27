import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { callFunction } from '@/lib/supabase'
import {
  durationLabel, fetchPaymentInfo, fetchPlans, formatInr, normalizePhone, normalizeUtr, validateSubscribe,
  type SubscribeErrors, type SubscribeValues,
} from '@/lib/subscribe'
import { Button, ErrorNote, Field, Input, Skeleton } from '@/components/ui'
import PaymentPanel, { FieldError, canPayWith } from '@/components/PaymentPanel'
import PublicShell from './PublicShell'

interface Submitted { reference: string; plan: string; amount_inr: number }

const EMPTY: SubscribeValues = { name: '', company: '', email: '', phone: '', utr: '' }

export default function Subscribe() {
  const [params] = useSearchParams()
  const planId = params.get('plan')
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: fetchPlans, staleTime: 60_000 })
  const pay = useQuery({ queryKey: ['payment-info'], queryFn: fetchPaymentInfo, staleTime: 30_000 })
  const [v, setV] = useState<SubscribeValues>(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<SubscribeErrors>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const plan = plans.data?.find((p) => p.id === planId)
  const submit = useMutation({
    mutationFn: (): Promise<Submitted> => {
      const f = new FormData()
      f.set('plan_id', plan!.id)
      f.set('applicant_name', v.name.trim())
      f.set('company_name', v.company.trim())
      f.set('email', v.email.trim().toLowerCase())
      f.set('phone', normalizePhone(v.phone))
      f.set('utr', normalizeUtr(v.utr))
      f.set('receipt', file!)
      return callFunction<Submitted>('submit-subscription', f)
    },
  })

  if (!planId || (plans.data && !plan)) return <Navigate to="/plans" replace />
  if (plans.isLoading || pay.isLoading) return <PublicShell><Skeleton /></PublicShell>
  if (plans.isError || pay.isError) return <PublicShell><ErrorNote error={plans.error ?? pay.error} /></PublicShell>
  if (!plan || !pay.data) return <PublicShell><Skeleton /></PublicShell>

  const info = pay.data
  const canPay = canPayWith(info)

  if (submit.isSuccess) {
    return (
      <PublicShell width="max-w-xl">
        <div className="card p-6">
          <h1 className="text-2xl font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Request received</h1>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--color-text-muted)' }}>
            We will verify your payment of {formatInr(submit.data.amount_inr)} for the {submit.data.plan} plan. Once it is approved, the Attendo team will share your login with you.
            Your username will be <strong style={{ color: 'var(--color-text-primary)' }}>{v.email.trim().toLowerCase()}</strong>, with a temporary password you change at first sign-in.
          </p>
          <div className="mt-5 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-muted)' }}>
            <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Your reference</div>
            <div className="mt-0.5 font-mono text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>{submit.data.reference}</div>
          </div>
          <p className="mt-3 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Keep this reference if you need to ask about your request.</p>
          <Link to="/plans" className="btn btn-ghost mt-5">Back to plans</Link>
        </div>
      </PublicShell>
    )
  }

  const set = (k: keyof SubscribeValues) => (e: React.ChangeEvent<HTMLInputElement>) => { setV({ ...v, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: undefined }) }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validateSubscribe(v, file ? { name: file.name, size: file.size } : null)
    setErrors(found)
    if (Object.keys(found).length === 0) submit.mutate()
  }

  return (
    <PublicShell>
      <Link to="/plans" className="text-[13px] underline" style={{ color: 'var(--color-text-muted)' }}>All plans</Link>
      <h1 className="mt-2 text-2xl font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Subscribe to {plan.name}</h1>
      <p className="mt-1 text-[14px]" style={{ color: 'var(--color-text-muted)' }}>
        {formatInr(plan.price_inr)} for {durationLabel(plan.duration_months)}, up to {plan.max_employees.toLocaleString('en-IN')} employees.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <PaymentPanel amount={plan.price_inr} info={info} />

        <form onSubmit={onSubmit} noValidate className="card space-y-4 p-5" aria-label="Payment details">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name"><Input value={v.name} onChange={set('name')} autoComplete="name" maxLength={120} aria-invalid={!!errors.name} />{errors.name && <FieldError text={errors.name} />}</Field>
            <Field label="Company name"><Input value={v.company} onChange={set('company')} autoComplete="organization" maxLength={200} aria-invalid={!!errors.company} />{errors.company && <FieldError text={errors.company} />}</Field>
          </div>
          <Field label="Email" hint="This becomes your username.">
            <Input type="email" value={v.email} onChange={set('email')} autoComplete="email" maxLength={254} aria-invalid={!!errors.email} />{errors.email && <FieldError text={errors.email} />}
          </Field>
          <Field label="Phone"><Input type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" aria-invalid={!!errors.phone} />{errors.phone && <FieldError text={errors.phone} />}</Field>
          <Field label="UTR number" hint="Shown in your UPI app under the payment details.">
            <Input value={v.utr} onChange={set('utr')} autoCapitalize="characters" spellCheck={false} className="font-mono" maxLength={30} aria-invalid={!!errors.utr} />{errors.utr && <FieldError text={errors.utr} />}
          </Field>
          <Field label="Payment receipt" hint="Screenshot or PDF, up to 3 MB.">
            <input
              ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (errors.receipt) setErrors({ ...errors, receipt: undefined }) }}
              className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--color-accent-soft)] file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-[var(--color-accent)]"
              aria-invalid={!!errors.receipt}
            />
            {errors.receipt && <FieldError text={errors.receipt} />}
          </Field>
          {submit.isError && <ErrorNote error={submit.error} />}
          <Button type="submit" disabled={submit.isPending || !canPay} className="w-full">{submit.isPending ? 'Sending…' : 'Send for verification'}</Button>
        </form>
      </div>
    </PublicShell>
  )
}
