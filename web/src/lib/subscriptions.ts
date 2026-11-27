// Platform-owner side of subscriptions: requests, review actions, plans and payment settings.
import { callFunction, supabase } from '@/lib/supabase'

export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface SubscriptionRequest {
  id: string; reference: string; kind: 'new' | 'renewal'; status: RequestStatus
  plan_name: string; amount_inr: number; max_employees: number; duration_months: number
  applicant_name: string; company_name: string; email: string; phone: string; utr: string; receipt_path: string
  company_id: string | null; approved_company_id: string | null
  reviewed_at: string | null; reject_reason: string | null; created_at: string
}

export interface Plan {
  id: string; name: string; description: string | null; price_inr: number; max_employees: number
  duration_months: number; is_active: boolean; sort_order: number
}

export interface PlatformSettings { upi_id: string | null; payee_name: string | null; qr_path: string | null; grace_days: number }

export interface ApprovalResult {
  kind: 'new' | 'renewal'; company_id: string; company_name: string; company_code: string | null; email: string
  temporary_password: string | null; plan: string | null; max_employees: number | null; expires_on: string | null
}

const REQUEST_COLS = 'id, reference, kind, status, plan_name, amount_inr, max_employees, duration_months, applicant_name, company_name, email, phone, utr, receipt_path, company_id, approved_company_id, reviewed_at, reject_reason, created_at'

export async function fetchRequests(): Promise<SubscriptionRequest[]> {
  const { data, error } = await supabase.from('subscription_requests').select(REQUEST_COLS).order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return (data as SubscriptionRequest[]).map((r) => ({ ...r, amount_inr: Number(r.amount_inr) }))
}

/** Other requests that share a UTR, email or phone with this one: things the reviewer should know before approving. */
export function relatedRequests(r: SubscriptionRequest, all: SubscriptionRequest[]): { request: SubscriptionRequest; why: string[] }[] {
  const out: { request: SubscriptionRequest; why: string[] }[] = []
  for (const o of all) {
    if (o.id === r.id) continue
    const why: string[] = []
    if (o.utr === r.utr) why.push('same UTR')
    if (o.email === r.email) why.push('same email')
    if (o.phone.replace(/^\+?91/, '') === r.phone.replace(/^\+?91/, '')) why.push('same phone')
    if (why.length) out.push({ request: o, why })
  }
  return out
}

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
  if (error || !data) throw new Error('Could not open the receipt.')
  return data.signedUrl
}

export const isPdf = (path: string): boolean => path.toLowerCase().endsWith('.pdf')

export const approveRequest = (requestId: string, companyCode?: string): Promise<ApprovalResult> =>
  callFunction<ApprovalResult>('approve-subscription', { request_id: requestId, company_code: companyCode?.trim() || undefined })

export async function rejectRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_subscription_request', { p_request: requestId, p_reason: reason.trim() })
  if (error) throw new Error(/INVALID_REASON/.test(error.message) ? 'Enter a reason of up to 300 characters.' : /NOT_PENDING/.test(error.message) ? 'This request was already reviewed.' : error.message)
}

/** Text the owner can paste to the customer. Contains the one-time password, so it is built only on demand. */
export function loginMessage(a: ApprovalResult, origin: string): string {
  return [
    `Your Attendo account is ready.`,
    `Sign in: ${origin}/login`,
    `Username: ${a.email}`,
    `Temporary password: ${a.temporary_password}`,
    `You will be asked to set a new password the first time you sign in.`,
  ].join('\n')
}

// ---------------------------------------------------------------- plans
export const PLAN_COLS = 'id, name, description, price_inr, max_employees, duration_months, is_active, sort_order'

export async function fetchAllPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from('plans').select(PLAN_COLS).order('sort_order').order('price_inr')
  if (error) throw error
  return (data as Plan[]).map((p) => ({ ...p, price_inr: Number(p.price_inr) }))
}

export interface PlanForm { name: string; description: string; price: string; max_employees: string; duration_months: string; sort_order: string; is_active: boolean }

export const emptyPlanForm = (): PlanForm => ({ name: '', description: '', price: '', max_employees: '', duration_months: '1', sort_order: '100', is_active: true })
export const planToForm = (p: Plan): PlanForm => ({
  name: p.name, description: p.description ?? '', price: String(p.price_inr), max_employees: String(p.max_employees),
  duration_months: String(p.duration_months), sort_order: String(p.sort_order), is_active: p.is_active,
})

/** Returns a message for the first problem, or the row to save. Mirrors the table's CHECK constraints. */
export function parsePlanForm(f: PlanForm): { error: string } | { row: Omit<Plan, 'id'> } {
  const name = f.name.trim()
  if (!name || name.length > 60) return { error: 'Name must be 1 to 60 characters.' }
  if (f.description.length > 300) return { error: 'Description can be at most 300 characters.' }
  const price = Number(f.price)
  if (f.price.trim() === '' || !Number.isFinite(price) || price < 0 || price > 99_999_999) return { error: 'Enter a price of 0 or more.' }
  if (Math.round(price * 100) !== price * 100 && Math.abs(Math.round(price * 100) - price * 100) > 1e-6) return { error: 'Price can have at most 2 decimals.' }
  const max = Number(f.max_employees)
  if (!Number.isInteger(max) || max < 1 || max > 100000) return { error: 'Employee limit must be a whole number from 1 to 100,000.' }
  const months = Number(f.duration_months)
  if (!Number.isInteger(months) || months < 1 || months > 36) return { error: 'Duration must be 1 to 36 months.' }
  const order = Number(f.sort_order)
  if (!Number.isInteger(order) || order < -100000 || order > 100000) return { error: 'Sort order must be a whole number.' }
  return { row: { name, description: f.description.trim() || null, price_inr: price, max_employees: max, duration_months: months, is_active: f.is_active, sort_order: order } }
}

export async function savePlan(id: string | null, row: Omit<Plan, 'id'>): Promise<void> {
  const q = id ? supabase.from('plans').update(row).eq('id', id) : supabase.from('plans').insert(row)
  const { error } = await q
  if (error) throw new Error(error.code === '23505' ? 'A plan with this name already exists.' : error.message)
}

// ---------------------------------------------------------------- payment settings
export async function fetchSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings').select('upi_id, payee_name, qr_path, grace_days').maybeSingle()
  if (error) throw error
  return (data as PlatformSettings | null) ?? { upi_id: null, payee_name: null, qr_path: null, grace_days: 3 }
}

export const UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$/

export async function savePayment(v: { upi_id: string; payee_name: string }): Promise<void> {
  const upi = v.upi_id.trim()
  const name = v.payee_name.trim()
  if (upi && !UPI_RE.test(upi)) throw new Error('UPI ID looks wrong. It should look like name@bank.')
  if (name.length > 100) throw new Error('Payee name can be at most 100 characters.')
  const { error } = await supabase.from('platform_settings').update({ upi_id: upi || null, payee_name: name || null }).eq('id', true)
  if (error) throw new Error(error.message)
}

export async function saveGraceDays(days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new Error('Grace period must be a whole number from 0 to 30 days.')
  const { error } = await supabase.from('platform_settings').update({ grace_days: days }).eq('id', true)
  if (error) throw new Error(error.message)
}

const QR_TYPES: Record<string, 'png' | 'jpg' | 'webp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Uploads a new QR image, points the settings at it, then deletes the previous image. */
export async function uploadQr(file: File, previousPath: string | null): Promise<string> {
  const ext = QR_TYPES[file.type]
  if (!ext) throw new Error('Use a PNG, JPG or WebP image.')
  if (file.size > 1024 * 1024) throw new Error('The image must be 1 MB or smaller.')
  const path = `qr/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('platform-assets').upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw new Error('Could not upload the image. ' + up.error.message)
  const { error } = await supabase.from('platform_settings').update({ qr_path: path }).eq('id', true)
  if (error) {
    await supabase.storage.from('platform-assets').remove([path])
    throw new Error(error.message)
  }
  if (previousPath) await supabase.storage.from('platform-assets').remove([previousPath])
  return path
}

export async function removeQr(path: string): Promise<void> {
  const { error } = await supabase.from('platform_settings').update({ qr_path: null }).eq('id', true)
  if (error) throw new Error(error.message)
  await supabase.storage.from('platform-assets').remove([path])
}
