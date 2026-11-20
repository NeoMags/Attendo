// POST { company_id, email, password } (super_admin JWT) -> creates a dashboard login with role company_admin.
import { adminClient, json, preflight, requireCaller, passwordProblem } from '../_shared/common.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = adminClient()
  const caller = await requireCaller(req, admin)
  if (caller instanceof Response) return caller
  if (caller.role !== 'super_admin') return json({ error: 'FORBIDDEN' }, 403)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const companyId = String(b.company_id ?? '')
  const email = String(b.email ?? '').trim().toLowerCase()
  const problem = passwordProblem(b.password)
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'INVALID_EMAIL' }, 400)
  if (problem) return json({ error: 'WEAK_PASSWORD', message: problem }, 400)
  const { data: co } = await admin.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!co) return json({ error: 'COMPANY_NOT_FOUND' }, 404)

  const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password: String(b.password), email_confirm: true })
  if (uErr || !u.user) return json({ error: 'AUTH_USER_CREATE_FAILED', message: uErr?.message }, uErr?.status === 422 ? 409 : 400)
  const { error: rErr } = await admin.from('user_roles').insert({ user_id: u.user.id, company_id: companyId, role: 'company_admin' })
  if (rErr) {
    await admin.auth.admin.deleteUser(u.user.id)
    return json({ error: 'ROLE_ASSIGN_FAILED', message: rErr.message }, 500)
  }
  await admin.from('audit_logs').insert({ company_id: companyId, actor_user_id: caller.userId, action: 'CREATE_COMPANY_ADMIN',
    entity_type: 'user_roles', entity_id: u.user.id, details: { email } })
  return json({ user_id: u.user.id, email, role: 'company_admin' }, 201)
})
