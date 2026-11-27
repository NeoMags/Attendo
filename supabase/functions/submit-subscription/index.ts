// Public endpoint (no login): POST multipart/form-data { plan_id, applicant_name, company_name, email, phone, utr, receipt(file) }.
// Validates the receipt by magic bytes, stores it in the private `receipts` bucket, then creates the request through
// public.submit_subscription_request (which re-validates every field). Throttled per IP. Returns only { reference, plan, amount }.
import { adminClient, json, preflight, requireCaller } from '../_shared/common.ts'
import { MAX_RECEIPT_BYTES, SUBMIT_ERRORS, sniffReceipt, submitErrorCode } from '../_shared/receipt.ts'

const MAX_PER_IP = 5      // submissions per IP per window
const MAX_PER_UNKNOWN = 30  // shared ceiling when no client IP is visible
const WINDOW_MIN = 60
const MAX_BODY = MAX_RECEIPT_BYTES + 64 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const field = (f: FormData, k: string, max: number) => { const v = f.get(k); return typeof v === 'string' ? v.slice(0, max) : '' }

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > MAX_BODY) return json({ error: 'RECEIPT_TOO_LARGE', message: 'Receipt must be 3 MB or smaller.' }, 413)

  let form: FormData
  try { form = await req.formData() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }

  const planId = field(form, 'plan_id', 40)
  const file = form.get('receipt')
  if (!UUID_RE.test(planId)) return json({ error: 'PLAN_NOT_AVAILABLE' }, 400)
  if (!(file instanceof File) || file.size === 0) return json({ error: 'RECEIPT_REQUIRED', message: 'Attach your payment receipt.' }, 400)
  if (file.size > MAX_RECEIPT_BYTES) return json({ error: 'RECEIPT_TOO_LARGE', message: 'Receipt must be 3 MB or smaller.' }, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniffReceipt(bytes)
  if (!kind) return json({ error: 'RECEIPT_TYPE', message: 'Receipt must be a JPG, PNG, WebP or PDF file.' }, 400)

  const admin = adminClient()
  // Renewal: only a signed-in company admin can renew, and only their own company.
  let renewCompany: string | null = null
  if (field(form, 'renewal', 5) === '1') {
    const caller = await requireCaller(req, admin)
    if (caller instanceof Response) return caller
    if (caller.role !== 'company_admin' || !caller.companyId) return json({ error: 'FORBIDDEN' }, 403)
    renewCompany = caller.companyId
  }
  // Never skip the throttle: if no client IP is visible, all such requests share one bucket with a higher ceiling.
  const h = req.headers
  const clientIp = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('cf-connecting-ip') || h.get('x-real-ip') || ''
  const ip = clientIp || 'unknown'
  const limit = clientIp ? MAX_PER_IP : MAX_PER_UNKNOWN
  // Rows are written with succeeded=true so they never count toward the employee-login lockout.
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString()
  const { count } = await admin.from('login_attempts').select('id', { count: 'exact', head: true })
    .eq('identifier', 'subscribe').eq('ip', ip).gte('attempted_at', since)
  if ((count ?? 0) >= limit) return json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many requests. Try again in an hour.', retry_after_minutes: WINDOW_MIN }, 429)
  await admin.from('login_attempts').insert({ identifier: 'subscribe', ip, succeeded: true })

  const path = `${crypto.randomUUID()}/receipt.${kind.ext}`
  const up = await admin.storage.from('receipts').upload(path, bytes, { contentType: kind.mime, upsert: false })
  if (up.error) return json({ error: 'UPLOAD_FAILED', message: 'Could not store the receipt. Please try again.' }, 500)

  const { data, error } = await admin.rpc('submit_subscription_request', {
    p_plan: planId, p_applicant: field(form, 'applicant_name', 200), p_company: field(form, 'company_name', 300),
    p_email: field(form, 'email', 300), p_phone: field(form, 'phone', 40), p_utr: field(form, 'utr', 60), p_receipt_path: path, p_company_id: renewCompany,
  })
  if (error || !data) {
    await admin.storage.from('receipts').remove([path])        // no orphaned receipts for rejected submissions
    const code = submitErrorCode(error?.message)
    if (code) return json({ error: code }, SUBMIT_ERRORS[code])
    return json({ error: 'SUBMIT_FAILED', message: 'Could not submit your request. Please try again.' }, 500)
  }
  const r = data as { reference: string; plan_name: string; amount_inr: number }
  return json({ reference: r.reference, plan: r.plan_name, amount_inr: r.amount_inr }, 201)
})
