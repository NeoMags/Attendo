import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { durationLabel, fetchPlans, formatInr, perMonth } from '@/lib/subscribe'
import { ErrorNote, Skeleton } from '@/components/ui'
import PublicShell from './PublicShell'

const STEPS = ['Choose a plan', 'Pay by UPI', 'Send your UTR and receipt', 'Get your login']

export default function Plans() {
  const q = useQuery({ queryKey: ['public-plans'], queryFn: fetchPlans, staleTime: 60_000 })
  return (
    <PublicShell>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Attendance and field tracking for your team
        </h1>
        <p className="mt-3 text-[15px]" style={{ color: 'var(--color-text-muted)' }}>
          Pick the plan that fits your headcount. You pay by UPI, send us the payment details, and we set up your account once the payment is verified.
        </p>
      </div>

      <ol className="mt-8 grid gap-3 sm:grid-cols-4" aria-label="How it works">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text-primary)' }}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white" style={{ background: 'var(--color-accent)' }}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <section className="mt-10" aria-label="Plans">
        {q.isLoading && <Skeleton />}
        {q.isError && <ErrorNote error={q.error} />}
        {q.data && q.data.length === 0 && (
          <div className="card p-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>No plans are available right now. Please check back soon.</div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {q.data?.map((p) => {
            const pm = perMonth(p)
            return (
              <article key={p.id} className="card flex flex-col p-5">
                <h2 className="text-[17px] font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{p.name}</h2>
                <p className="mt-1 min-h-[2.5rem] text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{p.description}</p>
                <div className="mt-4">
                  <span className="text-3xl font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{formatInr(p.price_inr)}</span>
                  <span className="ml-1.5 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>for {durationLabel(p.duration_months)}</span>
                  {pm !== null && <div className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>about {formatInr(pm)} a month</div>}
                </div>
                <ul className="mt-4 space-y-1.5 text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
                  <li>Up to {p.max_employees.toLocaleString('en-IN')} employees</li>
                  <li>Valid for {durationLabel(p.duration_months)} from approval</li>
                </ul>
                <Link to={`/subscribe?plan=${p.id}`} className="btn btn-primary mt-5 w-full justify-center">Choose {p.name}</Link>
              </article>
            )
          })}
        </div>
      </section>

      <p className="mt-8 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
        Already a customer? <Link to="/login" className="underline">Sign in</Link>
      </p>
    </PublicShell>
  )
}
