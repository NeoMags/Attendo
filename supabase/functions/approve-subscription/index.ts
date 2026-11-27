// POST { request_id, company_code? } (super_admin JWT) -> approves a subscription request.
// New customer: creates the login (email + generated temporary password, must change on first sign-in), then runs the
// atomic public.approve_subscription_request (company + role + subscription). If that fails the login is deleted again.
// Renewal: only extends the existing company's subscription. The temporary password is returned once and never stored or logged.
import { adminClient, json, preflight, requireCaller, COMPANY_RE } from '../_shared/common.ts'
import { generateTempPassword } from '../_shared/temp-password.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RPC_ERRORS: Record<string, number> = { FORBIDDEN: 403, REQUEST_NOT_FOUND: 404, NOT_PENDING: 409, ADMIN_USER_REQUIRED: 400, COMPANY_CODE_TAKEN: 409 }

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = adminClient()
  const caller = await requireCaller(req, admin)
  if (caller instanceof Response) return caller
  if (caller.role !== 'super_admin') return json({ error: 'FORBIDDEN' }, 403)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const requestId = String(b.request_id ?? '')
  const companyCode = String(b.company_code ?? '').trim().toLowerCase()
  if (!UUID_RE.test(requestId)) return json({ error: 'INVALID_REQUEST' }, 400)
  if (companyCode && !COMPANY_RE.test(companyCode)) return json({ error: 'INVALID_COMPANY_CODE', message: 'Company code: 2-32 lowercase letters, digits, dash or underscore.' }, 400)

  const { data: r } = await admin.from('subscription_requests').select('id, kind, status, email, company_name, company_id').eq('id', requestId).maybeSingle()
  if (!r) return json({ error: 'REQUEST_NOT_FOUND' }, 404)
  if (r.status !== 'pending') return json({ error: 'NOT_PENDING' }, 409)

  let userId: string | null = null
  let password: string | null = null
  if (r.kind === 'new') {
    password = generateTempPassword()
    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email: r.email, password, email_confirm: true, user_metadata: { must_change_password: true },
    })
    if (uErr || !u.user) {
      const taken = uErr?.status === 422 || /already|registered|exists/i.test(uErr?.message ?? '')
      return json(taken
        ? { error: 'EMAIL_ALREADY_REGISTERED', message: 'A login with this email already exists. Remove or rename it before approving.' }
        : { error: 'AUTH_USER_CREATE_FAILED', message: 'Could not create the login.' }, taken ? 409 : 500)
    }
    userId = u.user.id
  }

  const { data: companyId, error } = await admin.rpc('approve_subscription_request', {
    p_request: requestId, p_actor: caller.userId, p_admin_user: userId, p_company_code: companyCode || null,
  })
  if (error || !companyId) {
    if (userId) await admin.auth.admin.deleteUser(userId)          // nothing half-created
    const code = Object.keys(RPC_ERRORS).find((c) => (error?.message ?? '').includes(c))
    if (code) return json({ error: code }, RPC_ERRORS[code])
    return json({ error: 'APPROVE_FAILED', message: 'Could not approve the request.' }, 500)
  }

  const { data: sub } = await admin.from('company_subscriptions').select('plan_name, max_employees, expires_on').eq('company_id', companyId).maybeSingle()
  const { data: co } = await admin.from('companies').select('name, code').eq('id', companyId).maybeSingle()
  return json({
    kind: r.kind, company_id: companyId, company_name: co?.name ?? r.company_name, company_code: co?.code ?? null,
    email: r.email, temporary_password: password, plan: sub?.plan_name ?? null, max_employees: sub?.max_employees ?? null, expires_on: sub?.expires_on ?? null,
  }, 201)
})
