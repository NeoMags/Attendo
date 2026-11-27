import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { bannerFor, fetchMySubscription } from '@/lib/subscription'

export function useMySubscription() {
  const { role, session } = useAuth()
  return useQuery({
    queryKey: ['my-subscription', session?.user.id],
    enabled: role === 'company_admin' || role === 'manager',
    queryFn: fetchMySubscription,
    staleTime: 60_000,
  })
}

/** Plan warning above every page: 7 days before expiry, then while read-only. */
export default function SubscriptionBanner() {
  const { role } = useAuth()
  const q = useMySubscription()
  const b = bannerFor(q.data, role)
  if (!b) return null
  const color = b.tone === 'bad' ? 'var(--color-bad)' : 'var(--color-warn, #b45309)'
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] md:px-8"
      style={{ background: `color-mix(in srgb, ${color} 12%, var(--color-bg-base))`, borderBottom: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}>
      <span><strong style={{ color }}>{b.title}.</strong> <span style={{ color: 'var(--color-text-secondary)' }}>{b.text}</span></span>
      {b.renew && <Link to="/billing" className="btn btn-primary btn-sm ml-auto">Renew plan</Link>}
    </div>
  )
}
