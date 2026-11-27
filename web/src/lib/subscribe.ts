// Public subscription flow helpers: plan/payment queries (anon-safe RPCs) and pure form validation.
import { supabase } from '@/lib/supabase'

export interface PublicPlan { id: string; name: string; description: string | null; price_inr: number; max_employees: number; duration_months: number }
export interface PaymentInfo { upi_id: string | null; payee_name: string | null; qr_path: string | null }

export async function fetchPlans(): Promise<PublicPlan[]> {
  const { data, error } = await supabase.rpc('list_public_plans')
  if (error) throw error
  return ((data ?? []) as PublicPlan[]).map((p) => ({ ...p, price_inr: Number(p.price_inr) }))
}

export async function fetchPaymentInfo(): Promise<PaymentInfo> {
  const { data, error } = await supabase.rpc('get_payment_info')
  if (error) throw error
  const row = ((data ?? []) as PaymentInfo[])[0]
  return row ?? { upi_id: null, payee_name: null, qr_path: null }
}

export const qrUrl = (path: string | null): string | null =>
  path ? supabase.storage.from('platform-assets').getPublicUrl(path).data.publicUrl : null

export const formatInr = (n: number): string =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })

export const durationLabel = (months: number): string =>
  months % 12 === 0 ? (months === 12 ? '1 year' : `${months / 12} years`) : months === 1 ? '1 month' : `${months} months`

/** Monthly equivalent, shown only for multi-month plans. */
export const perMonth = (p: Pick<PublicPlan, 'price_inr' | 'duration_months'>): number | null =>
  p.duration_months > 1 ? Math.round(p.price_inr / p.duration_months) : null

/** Opens the customer's UPI app with payee and amount filled in (standard upi://pay link). */
export function upiLink(info: PaymentInfo, amount: number): string | null {
  if (!info.upi_id) return null
  const q = new URLSearchParams({ pa: info.upi_id, cu: 'INR', am: amount.toFixed(2) })
  if (info.payee_name) q.set('pn', info.payee_name)
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20')
}

export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024
const RECEIPT_EXT = /\.(jpe?g|png|webp|pdf)$/i

export const normalizeUtr = (s: string): string => s.replace(/[\s-]/g, '').toUpperCase()
export const normalizePhone = (s: string): string => s.replace(/[\s-]/g, '')

export interface SubscribeValues { name: string; company: string; email: string; phone: string; utr: string }
export type SubscribeErrors = Partial<Record<keyof SubscribeValues | 'receipt', string>>

/** Mirrors the database rules so people see problems before uploading; the server re-checks everything. */
export function validateSubscribe(v: SubscribeValues, receipt: { name: string; size: number } | null): SubscribeErrors {
  const e: SubscribeErrors = {}
  if (!v.name.trim() || v.name.trim().length > 120) e.name = 'Enter your name.'
  if (!v.company.trim() || v.company.trim().length > 200) e.company = 'Enter your company name.'
  const email = v.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) e.email = 'Enter a valid email address.'
  if (!/^\+?[0-9]{10,15}$/.test(normalizePhone(v.phone))) e.phone = 'Enter a phone number with 10 to 15 digits.'
  if (!/^[A-Z0-9]{12,22}$/.test(normalizeUtr(v.utr))) e.utr = 'Enter the UTR from your payment, 12 to 22 letters or digits.'
  if (!receipt) e.receipt = 'Attach a screenshot or PDF of your payment.'
  else if (receipt.size > MAX_RECEIPT_BYTES) e.receipt = 'The file is larger than 3 MB.'
  else if (!RECEIPT_EXT.test(receipt.name)) e.receipt = 'Use a JPG, PNG, WebP or PDF file.'
  return e
}
