// Company-side subscription: current plan/state for the banner and Billing page, plus pure banner/password rules.
import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/roles'

export type SubState = 'active' | 'grace' | 'expired' | 'none'

export interface MySubscription {
  state: SubState; plan_name: string; max_employees: number; employee_count: number
  expires_on: string; days_left: number; is_complimentary: boolean
}

export const WARN_DAYS = 7

export async function fetchMySubscription(): Promise<MySubscription | null> {
  const { data, error } = await supabase.rpc('my_subscription')
  if (error) throw error
  const r = ((data ?? []) as MySubscription[])[0]
  return r ? { ...r, employee_count: Number(r.employee_count) } : null
}

/** Dashboard writes are blocked by the database in these states; the UI mirrors that. */
export const isReadOnly = (s: MySubscription | null | undefined): boolean => s?.state === 'grace' || s?.state === 'expired'

export interface Banner { tone: 'warn' | 'bad'; title: string; text: string; renew: boolean }

const fmtDate = (iso: string): string => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** What to tell the signed-in admin or manager about their plan, or null when nothing needs saying. */
export function bannerFor(s: MySubscription | null | undefined, role: Role | undefined): Banner | null {
  if (!s || s.is_complimentary || (role !== 'company_admin' && role !== 'manager')) return null
  const renew = role === 'company_admin'
  const who = renew ? 'Renew' : 'Ask your administrator to renew'
  if (s.state === 'expired') {
    return { tone: 'bad', renew, title: 'Your plan has expired',
      text: `It ended on ${fmtDate(s.expires_on)}. The dashboard is read-only and the employee app has stopped. ${who} to restore access.` }
  }
  if (s.state === 'grace') {
    return { tone: 'bad', renew, title: 'Your plan has expired',
      text: `It ended on ${fmtDate(s.expires_on)}. The dashboard is read-only; the employee app still works for a few more days. ${who} to continue.` }
  }
  if (s.state === 'active' && s.days_left <= WARN_DAYS) {
    const when = s.days_left <= 0 ? 'today' : s.days_left === 1 ? 'tomorrow' : `in ${s.days_left} days`
    return { tone: 'warn', renew, title: `Your plan ends ${when}`, text: `${who} before ${fmtDate(s.expires_on)} to avoid interruption.` }
  }
  return null
}

/** Client-side mirror of the server's password rule (8-72 characters, letters and digits). */
export function newPasswordProblem(pw: string, confirm: string): string | null {
  if (pw.length < 8 || pw.length > 72) return 'Use 8 to 72 characters.'
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include both letters and digits.'
  if (pw !== confirm) return 'The two passwords do not match.'
  return null
}

export interface MyRequest {
  id: string; reference: string; status: 'pending' | 'approved' | 'rejected'; plan_name: string; amount_inr: number
  reject_reason: string | null; created_at: string
}

export async function fetchMyRequests(): Promise<MyRequest[]> {
  const { data, error } = await supabase.from('subscription_requests')
    .select('id, reference, status, plan_name, amount_inr, reject_reason, created_at').order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  return (data as MyRequest[]).map((r) => ({ ...r, amount_inr: Number(r.amount_inr) }))
}
